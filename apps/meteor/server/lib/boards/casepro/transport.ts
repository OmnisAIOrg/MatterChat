import type { SettingValue } from '@rocket.chat/core-typings';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { settings } from '../../../../app/settings/server';
import { SystemLogger } from '../../logger/system';

/**
 * CasePro transport (M2 read client + live wire).
 *
 * The transport is the ONLY thing that touches the wire. Everything above it
 * (mapping.ts, client.ts) is pure and never knows whether the rows came from a
 * stub or the live CasePro MCP gateway. Two implementations ship:
 *
 *  - {@link StubTransport}       — representative mock rows so a MatterSnapshot fully
 *    renders with zero network/config. This is the DEFAULT.
 *  - {@link McpGatewayTransport} — the LIVE transport: JSON-RPC `tools/call` against the
 *    deployed casepro-mcp-v2 gateway (verified: POST {base}/mcp/v2, X-MCP-API-Key auth).
 *    It refuses to exist without a key — no request ever leaves unauthenticated.
 *
 * Auth (route A — MCP gateway; `CasePro_Auth_Mode` = 'mcp-key'):
 *  - `X-MCP-API-Key`     — shared secret from env `CASEPRO_MCP_API_KEY` ONLY. Secrets
 *    are NEVER stored in Mongo settings; the key lives in the deploy env/sealed secret,
 *    and must also be provisioned on the CasePro side (its auth service validates the
 *    key via `${AUTH_SERVICE_URL}/api/mcp/keys/validate` — see casepro-mcp-v2/src/auth).
 *  - `X-Organization-ID` — org scope, env `CASEPRO_ORG_ID` or setting `CasePro_Org_ID`
 *    (carepro-mcp pattern: the header selects the org per request).
 *  - `X-Acting-User`     — advisory writer-identity seam: the MatterChat user id that
 *    triggered a write. The gateway's identity is the MCP key (service context); this
 *    header is forward-compat for per-user attribution and is safe to ignore upstream.
 *  - 'keygate' auth mode is a declared stub (route B) — selecting it falls back to the
 *    stub transport with a warning until the KeyGate handshake lands.
 *
 * IMPORTANT (carried from every CasePro discovery doc): `aggregate_data` GROUP BY
 * is broken server-side. The transport NEVER aggregates — it returns raw rows and
 * mapping.ts sums in JS. The transport's only job is "give me the rows for this
 * entity + filter".
 */

/** A raw CasePro row. Columns are dynamic (real schema), money arrives as strings. */
export type CaseProRow = Record<string, unknown>;

export type CaseProQuery = {
	/** Equality filter, ANDed. `{ $in: [...] }` is supported for one-hop joins (e.g. bills by provider ids). */
	filter?: Record<string, unknown>;
	/** Column allow-list (diagnostics / payload trimming only — transport may ignore). */
	select?: string[];
	limit?: number;
	offset?: number;
};

export type CaseProQueryResult = {
	data: CaseProRow[];
	/** Total matching rows (may exceed `data.length` when paged/capped). */
	total: number;
};

/**
 * Per-call acting context for writes. The live gateway authenticates as a service
 * (the MCP key); this carries the MatterChat user who triggered the write so the
 * transport can attach it as an advisory `X-Acting-User` header (writer-identity
 * seam — CasePro-side created_by/updated_by stamping is a follow-up on their end).
 */
export type CaseProCallContext = { actingUserId?: string };

/**
 * The transport contract. Five verbs: three reads, two writes. Reads mirror the
 * CasePro connector's `query_entities` / `get_entity` / `list_schema`; writes
 * mirror `create_entity` / `update_entity`. Intake sync (M3 leads) is the first
 * consumer of the writes — capture creates a party + intake_questionnaires row,
 * drag/qualify/convert patch one.
 */
export interface ICaseProTransport {
	/** Page rows for an entity+filter. NEVER groups/aggregates (aggregate_data is broken). */
	query(entity: string, query?: CaseProQuery): Promise<CaseProQueryResult>;
	/** Single row by id, or null. */
	get(entity: string, id: string): Promise<CaseProRow | null>;
	/** Schema/diagnostics for an entity (admin "test connection"). */
	listSchema(entity: string): Promise<unknown>;
	/** Create a row for an entity; returns the created row WITH its server-assigned `id`. */
	create(entity: string, data: CaseProRow, ctx?: CaseProCallContext): Promise<CaseProRow>;
	/** Patch a row by id; returns the full updated row. */
	update(entity: string, id: string, patch: CaseProRow, ctx?: CaseProCallContext): Promise<CaseProRow>;
	/**
	 * Narrow custom-path POST for CasePro CRM endpoints that are plain REST
	 * controllers, NOT MCP entity tools (first consumer: `matterchat-messages/ingest`,
	 * the comms-log digest filing — CasePro PR #1234 exposes it as a REST controller,
	 * so it does NOT go through the JSON-RPC `tools/call` transport). `path` may be
	 * relative to the configured base host, or an absolute https URL when the CRM
	 * backend lives on a different host than the MCP gateway.
	 *
	 * RECONCILED onto live-wire: the live implementation ({@link McpGatewayTransport})
	 * issues a direct authenticated POST reusing the SAME auth headers the entity
	 * verbs build (X-MCP-API-Key + X-Organization-ID) and the SAME egress posture
	 * (https-only, refuse-without-key). It never rides `tools/call`.
	 */
	ingest(path: string, payload: Record<string, unknown>, ctx?: CaseProCallContext): Promise<unknown>;
	/**
	 * Generic authenticated request to a plain CasePro CRM REST controller for the verbs `ingest`
	 * (POST-only) does not cover — GET (reads) / PATCH / DELETE (mutations by row id). First consumer:
	 * the calendar-reuse bridge (`casepro/calendarBridge.ts`), which routes a MatterChat user's
	 * due-card → calendar event through CasePro's OWN calendar controller
	 * (`POST /calendar/create`, `PATCH /calendar/update/:id`, `DELETE /calendar/:id`,
	 * `GET /calendar/all-events`) instead of MatterChat holding a second Google/Outlook OAuth token.
	 *
	 * Same auth + egress posture as {@link ICaseProTransport.ingest}: reuses the entity verbs' headers
	 * (X-MCP-API-Key + X-Organization-ID + advisory X-Acting-User), https-only, single-host SSRF
	 * allow-list, never follows redirects, refuses without a key. `path` is relative to the configured
	 * base host or an absolute https URL. `query` is appended as the search string (GET reads). Returns
	 * the parsed JSON body (or `undefined` for an empty 2xx, e.g. a 204 DELETE).
	 */
	request(
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		options?: { query?: Record<string, string | undefined>; body?: Record<string, unknown>; ctx?: CaseProCallContext },
	): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Stub transport — representative mock rows for a fully-rendered snapshot.
// ---------------------------------------------------------------------------

const STUB_MATTER_ID = 'stub-matter-0001';
const STUB_CLIENT_ID = 'stub-party-client';
const STUB_DEFENDANT_ID = 'stub-party-defendant';
const STUB_INSURER_ID = 'stub-party-insurer';
const STUB_PROVIDER_PARTY_ID = 'stub-party-provider';
const STUB_PROVIDER_ID_A = 'stub-medprov-a';
const STUB_PROVIDER_ID_B = 'stub-medprov-b';
const STUB_LIEN_ID = 'stub-lien-1';

/** Lookup tables (small, org-stable in real CasePro). */
const STUB_CASE_TYPES: CaseProRow[] = [
	{ id: 'stub-casetype-mva', case_type_name: 'Motor Vehicle Accident' },
	{ id: 'stub-casetype-pi', case_type_name: 'Personal Injury' },
	{ id: 'stub-casetype-slipfall', case_type_name: 'Slip and Fall' },
	{ id: 'stub-casetype-premises', case_type_name: 'Premises Liability' },
];
const STUB_MATTER_STAGES: CaseProRow[] = [
	{ id: 'stub-stage-prelit', matter_stage_name: 'Pre-Litigation', order_index: 4 },
	{ id: 'stub-stage-intake', matter_stage_name: 'Intake', order_index: 1 },
];
const STUB_MATTER_SUB_STAGES: CaseProRow[] = [{ id: 'stub-substage-demanded', sub_stage_name: 'Demanded' }];
const STUB_SETTLEMENT_TYPES: CaseProRow[] = [{ id: 'stub-settype-prelit', settlement_type_name: 'Pre-Litigation' }];

/** Entity tables, all keyed/filterable as the real connector would return them. */
const STUB_MATTERS: CaseProRow[] = [
	{
		id: STUB_MATTER_ID,
		matter_name: 'Doe v. Roe',
		matter_number: '2025-00042',
		cause_number: '2025-27753',
		description: 'Rear-end collision on I-45.',
		status: 'active',
		archived: false,
		case_type: 'stub-casetype-mva',
		stage_id: 'stub-stage-prelit',
		sub_stage: 'stub-substage-demanded',
		liability_status: 'Accepted',
		client_id: STUB_CLIENT_ID,
		plaintiff: [STUB_CLIENT_ID],
		defendant: [STUB_DEFENDANT_ID],
		incident_date: '2024-11-03',
		statute_of_limitations: '2026-11-03',
		statute_of_limitations_manual: false,
		close_date: null,
		litbox_workspace_id: 'stub-litbox-ws-1',
		medchron_matter_id: 'stub-medchron-1',
		principal_attorney: 'stub-user-attorney',
		case_manager: 'stub-user-casemgr',
		paralegal: 'stub-user-paralegal',
	},
];

const STUB_PARTIES: CaseProRow[] = [
	{ id: STUB_CLIENT_ID, record_type: 'Individual', full_name: 'Jane Doe', first_name: 'Jane', last_name: 'Doe', email: 'jane.doe@example.com', telephone_number: '555-0100' },
	{ id: STUB_DEFENDANT_ID, record_type: 'Individual', full_name: 'Richard Roe', first_name: 'Richard', last_name: 'Roe' },
	{ id: STUB_INSURER_ID, record_type: 'Business', party_name: 'Third Party - Progressive' },
	{ id: STUB_PROVIDER_PARTY_ID, record_type: 'Business', party_name: 'St. Joseph Medical Center', provider_type: 'Hospital' },
];

const STUB_MEDICAL_PROVIDERS: CaseProRow[] = [
	{ id: STUB_PROVIDER_ID_A, matter_id: STUB_MATTER_ID, party_id: STUB_PROVIDER_PARTY_ID, status: 'active', deleted_at: null },
	{ id: STUB_PROVIDER_ID_B, matter_id: STUB_MATTER_ID, party_id: STUB_PROVIDER_PARTY_ID, status: 'active', deleted_at: null },
];

// bills carry NO matter_id and NO organization_id — reached only via medical_provider_id.
const STUB_BILLS: CaseProRow[] = [
	{ id: 'stub-bill-1', medical_provider_id: STUB_PROVIDER_ID_A, total_amount: '42000.00', amount_due: '38000.00', deleted_at: null },
	{ id: 'stub-bill-2', medical_provider_id: STUB_PROVIDER_ID_A, total_amount: '8500.50', amount_due: '8500.50', deleted_at: null },
	{ id: 'stub-bill-3', medical_provider_id: STUB_PROVIDER_ID_B, total_amount: '15000.00', amount_due: '0.00', deleted_at: null },
];

const STUB_INSURANCES: CaseProRow[] = [
	{
		id: 'stub-ins-1',
		matter_id: STUB_MATTER_ID,
		party_id: STUB_INSURER_ID,
		insurance_name: 'Third Party - Progressive',
		insurance_type: 'Third Party',
		policy_limit_per_person: '30000',
		policy_limit_per_occurrence: '60000',
		pl_status: true,
		status: 'active',
	},
];

// DEMAND and OFFER are BOTH negotiations rows, discriminated by `type`.
const STUB_NEGOTIATIONS: CaseProRow[] = [
	{ id: 'stub-neg-1', matter_id: STUB_MATTER_ID, type: 'Initial Completed Demand', amount: '125000.00', date: '2026-02-01', expiration_date: '2026-03-15', status: 'active' },
	{ id: 'stub-neg-2', matter_id: STUB_MATTER_ID, type: '1st Counter Demand', amount: '95000.00', date: '2026-03-20', expiration_date: '2026-04-30', status: 'active' },
	{ id: 'stub-neg-3', matter_id: STUB_MATTER_ID, type: 'Initial Offer', amount: '18000.00', date: '2026-03-05', status: 'active' },
	{ id: 'stub-neg-4', matter_id: STUB_MATTER_ID, type: '1st Counter Offer', amount: '30000.00', date: '2026-04-10', status: 'active' },
];

const STUB_RESOLUTIONS: CaseProRow[] = [
	{
		id: 'stub-res-1',
		matter_id: STUB_MATTER_ID,
		settlement_type_id: 'stub-settype-prelit',
		settlement_amount: '60000.00',
		attorney_fees_amount: '21000.00',
		resolution_date: '2026-05-01',
		status: 'inProgress',
	},
];

const STUB_LIENS: CaseProRow[] = [
	{ id: STUB_LIEN_ID, matter_id: STUB_MATTER_ID, lien_name: 'Medical Providers', amount: '12000.00', status: 'active' },
	// placeholder/"no lien" row — null amount, must be ignored by the money math.
	{ id: 'stub-lien-2', matter_id: STUB_MATTER_ID, lien_name: 'Medicare', amount: null, status: 'active' },
];

const STUB_REDUCTIONS: CaseProRow[] = [
	{ id: 'stub-red-1', reducible_type: 'Lien', reducible_id: STUB_LIEN_ID, reduction_amount: '2000.00', deleted_at: null },
];

const STUB_EXPENSES: CaseProRow[] = [
	{ id: 'stub-exp-1', matter_id: STUB_MATTER_ID, amount: '1500.00', status: 'active' },
	{ id: 'stub-exp-2', matter_id: STUB_MATTER_ID, amount: '850.25', status: 'active' },
];

// litigations: one scheduling-order row per matter once in suit (39 cols in real
// CasePro). Only the docket date columns the board mirrors are seeded here; the rest
// are null. `discovery`/`mediation_date` and the filing-class dates feed board deadlines.
const STUB_LITIGATIONS: CaseProRow[] = [
	{
		id: 'stub-litigation-1',
		matter_id: STUB_MATTER_ID,
		litigation_name: 'Doe v. Roe — Cause 2025-27753',
		cause_number: '2025-27753',
		status: 'active',
		deleted_at: null,
		discovery: '2026-09-15',
		mediation_date: '2026-10-01',
		pleadings: '2026-08-15',
		dispositive_motion: '2026-11-01',
		no_evidence_msj: null,
		docket_call: '2026-12-10',
		trial_date: '2027-01-15',
	},
];

// ---------------------------------------------------------------------------
// Intake (Leads/Intake pillar — M3) stub data.
// The lead/intake entity is `intake_questionnaires`; the 8 pipeline stages are
// `intake_stages` (board columns). A read-through pull returns the seeded rows
// across several stages; writes (capture/qualify/drag/convert) mutate the live map.
// ---------------------------------------------------------------------------

/** The 8 real intake pipeline stages, by order_index (= the Leads board columns). */
const STUB_INTAKE_STAGES: CaseProRow[] = [
	{ id: 'stub-intakestage-new', intake_stage_name: 'New Lead / Initial Contact', order_index: 1 },
	{ id: 'stub-intakestage-pending', intake_stage_name: 'Pending Intake Completion', order_index: 2 },
	{ id: 'stub-intakestage-eval', intake_stage_name: 'Further Evaluation', order_index: 3 },
	{ id: 'stub-intakestage-poasent', intake_stage_name: 'POA Sent', order_index: 4 },
	{ id: 'stub-intakestage-poarecv', intake_stage_name: 'POA Received', order_index: 5 },
	{ id: 'stub-intakestage-declined-unq', intake_stage_name: 'Declined-Unqualified', order_index: 6 },
	{ id: 'stub-intakestage-declined-lost', intake_stage_name: 'Declined-Lost Lead', order_index: 7 },
	{ id: 'stub-intakestage-noresponse', intake_stage_name: 'No Response', order_index: 8 },
];

/** Prospective-client parties referenced by the seeded intakes (the global parties pool). */
const STUB_INTAKE_PARTIES: CaseProRow[] = [
	{ id: 'stub-party-lead-1', record_type: 'Individual', full_name: 'Maria Gomez', first_name: 'Maria', last_name: 'Gomez', email: 'maria.gomez@example.com', telephone_number: '555-0201' },
	{ id: 'stub-party-lead-2', record_type: 'Individual', full_name: 'Andre Wilson', first_name: 'Andre', last_name: 'Wilson', email: 'andre.wilson@example.com', telephone_number: '555-0202' },
	{ id: 'stub-party-lead-3', record_type: 'Individual', full_name: 'Priya Patel', first_name: 'Priya', last_name: 'Patel', email: 'priya.patel@example.com', telephone_number: '555-0203' },
	{ id: 'stub-party-lead-4', record_type: 'Individual', full_name: 'Tom Becker', first_name: 'Tom', last_name: 'Becker', email: 'tom.becker@example.com', telephone_number: '555-0204' },
];

/** Representative existing intakes spread across stages so a read-through pull renders. */
const STUB_INTAKE_QUESTIONNAIRES: CaseProRow[] = [
	{
		id: 'stub-intake-1',
		intake_id: 'INT-1001',
		intake_stage_id: 'stub-intakestage-new',
		party_id: 'stub-party-lead-1',
		case_type_id: 'stub-casetype-mva',
		status: 'open',
		intake_status: 'New',
		source: 'Web Form',
		incident_date: '2026-05-20',
		form_data: { howHeard: 'Google', hasAttorney: false },
		form_schema: null,
		template_id: 'stub-intaketmpl-mva',
		matter_id: null,
		litbox_workspace_id: null,
		custom_fields: {},
	},
	{
		id: 'stub-intake-2',
		intake_id: 'INT-1002',
		intake_stage_id: 'stub-intakestage-pending',
		party_id: 'stub-party-lead-2',
		case_type_id: 'stub-casetype-slipfall',
		status: 'open',
		intake_status: 'Awaiting Forms',
		source: 'Referral',
		incident_date: '2026-04-11',
		form_data: { howHeard: 'Friend', injuries: ['ankle'] },
		form_schema: null,
		template_id: 'stub-intaketmpl-pi',
		matter_id: null,
		litbox_workspace_id: null,
		custom_fields: {},
	},
	{
		id: 'stub-intake-3',
		intake_id: 'INT-1003',
		intake_stage_id: 'stub-intakestage-eval',
		party_id: 'stub-party-lead-3',
		case_type_id: 'stub-casetype-pi',
		status: 'open',
		intake_status: 'Under Review',
		source: 'Phone',
		incident_date: '2026-03-02',
		form_data: { howHeard: 'TV Ad', priorClaims: false },
		form_schema: null,
		template_id: 'stub-intaketmpl-pi',
		matter_id: null,
		litbox_workspace_id: null,
		custom_fields: {},
	},
	{
		id: 'stub-intake-4',
		intake_id: 'INT-1004',
		intake_stage_id: 'stub-intakestage-poasent',
		party_id: 'stub-party-lead-4',
		case_type_id: 'stub-casetype-premises',
		status: 'open',
		intake_status: 'Retainer Sent',
		source: 'Web Form',
		incident_date: '2026-02-18',
		form_data: { howHeard: 'Billboard' },
		form_schema: null,
		template_id: 'stub-intaketmpl-pi',
		matter_id: null,
		litbox_workspace_id: null,
		custom_fields: {},
	},
];

/** entity -> seed rows. Anything not listed returns []. */
const STUB_TABLES: Record<string, CaseProRow[]> = {
	matters: STUB_MATTERS,
	parties: [...STUB_PARTIES, ...STUB_INTAKE_PARTIES],
	case_types: STUB_CASE_TYPES,
	matter_stages: STUB_MATTER_STAGES,
	matter_sub_stages: STUB_MATTER_SUB_STAGES,
	settlement_types: STUB_SETTLEMENT_TYPES,
	medical_providers: STUB_MEDICAL_PROVIDERS,
	bills: STUB_BILLS,
	insurances: STUB_INSURANCES,
	negotiations: STUB_NEGOTIATIONS,
	resolutions: STUB_RESOLUTIONS,
	liens: STUB_LIENS,
	reductions: STUB_REDUCTIONS,
	expenses: STUB_EXPENSES,
	litigations: STUB_LITIGATIONS,
	intake_stages: STUB_INTAKE_STAGES,
	intake_questionnaires: STUB_INTAKE_QUESTIONNAIRES,
};

/** Narrow an unknown to a non-empty string, else undefined. */
function str(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Local, in-memory equality matcher supporting the `{ $in: [...] }` one-hop join. */
function rowMatches(row: CaseProRow, filter?: Record<string, unknown>): boolean {
	if (!filter) {
		return true;
	}
	return Object.entries(filter).every(([key, cond]) => {
		const value = row[key];
		if (cond !== null && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
			const list = (cond as { $in: unknown[] }).$in;
			return Array.isArray(list) && list.includes(value as never);
		}
		return value === cond;
	});
}

export class StubTransport implements ICaseProTransport {
	/**
	 * Per-instance live store seeded from the module tables. Created/updated rows
	 * land here so subsequent get/query reflect them — that's what makes the
	 * capture → drag → qualify → convert intake flow testable with no credentials.
	 * Each instance gets its own deep-ish copy so tests don't bleed into each other.
	 */
	private readonly store: Record<string, CaseProRow[]> = Object.fromEntries(
		Object.entries(STUB_TABLES).map(([entity, rows]) => [entity, rows.map((row) => ({ ...row }))]),
	);

	private seq = 0;

	private table(entity: string): CaseProRow[] {
		if (!this.store[entity]) {
			this.store[entity] = [];
		}
		return this.store[entity];
	}

	/** Deterministic-ish stub id (no uuid dep): entity-prefixed + monotonic + time. */
	private nextId(entity: string): string {
		this.seq += 1;
		return `stub-${entity}-${Date.now().toString(36)}-${this.seq}`;
	}

	async query(entity: string, query: CaseProQuery = {}): Promise<CaseProQueryResult> {
		const all = this.table(entity).filter((row) => rowMatches(row, query.filter));
		const offset = query.offset ?? 0;
		const limit = query.limit ?? all.length;
		return { data: all.slice(offset, offset + limit).map((row) => ({ ...row })), total: all.length };
	}

	async get(entity: string, id: string): Promise<CaseProRow | null> {
		const row = this.table(entity).find((r) => r.id === id);
		return row ? { ...row } : null;
	}

	async listSchema(entity: string): Promise<unknown> {
		const sample = this.table(entity)[0] ?? {};
		return { entity, columns: Object.keys(sample), stub: true };
	}

	async create(entity: string, data: CaseProRow, _ctx?: CaseProCallContext): Promise<CaseProRow> {
		const id = str(data.id) ?? this.nextId(entity);
		const row: CaseProRow = { ...data, id };
		this.table(entity).push(row);
		return { ...row };
	}

	async update(entity: string, id: string, patch: CaseProRow, _ctx?: CaseProCallContext): Promise<CaseProRow> {
		const rows = this.table(entity);
		const idx = rows.findIndex((r) => r.id === id);
		if (idx === -1) {
			throw new Error(`CasePro stub update(${entity}, ${id}): row not found`);
		}
		const next: CaseProRow = { ...rows[idx], ...patch, id };
		rows[idx] = next;
		return { ...next };
	}

	/** Stub ingest: record the payload (tests inspect it) and pretend CasePro accepted everything. */
	public readonly ingested: { path: string; payload: Record<string, unknown> }[] = [];

	async ingest(path: string, payload: Record<string, unknown>, _ctx?: CaseProCallContext): Promise<unknown> {
		this.ingested.push({ path, payload });
		return { ok: true, stub: true };
	}

	/** Records of every generic request (tests inspect them). Reads return an empty CasePro-shaped payload. */
	public readonly requests: {
		method: string;
		path: string;
		query?: Record<string, string | undefined>;
		body?: Record<string, unknown>;
	}[] = [];

	async request(
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		options?: { query?: Record<string, string | undefined>; body?: Record<string, unknown>; ctx?: CaseProCallContext },
	): Promise<unknown> {
		this.requests.push({ method, path, query: options?.query, body: options?.body });
		// Shape stub replies like the CasePro calendar controller so the bridge composes without network:
		//  - all-events read  → { data: [], total: 0 }
		//  - create/update     → echo the body with a synthetic id so correlation is recorded
		//  - delete            → { success: true }
		if (method === 'GET') {
			// sync-status probe → "not connected" (the stub isn't a real calendar); all-events → empty feed.
			if (/calendar\/sync-status/.test(path)) {
				return { connected: false, provider: null };
			}
			return { data: [], total: 0 };
		}
		if (method === 'DELETE') {
			return { success: true };
		}
		return { id: `stub-calendar-${Date.now().toString(36)}-${(this.seq += 1)}`, ...(options?.body || {}) };
	}
}

// ---------------------------------------------------------------------------
// Live transport — JSON-RPC `tools/call` against the casepro-mcp-v2 gateway.
// ---------------------------------------------------------------------------

/**
 * Derive the JSON-RPC endpoint + pinned host from the configured base URL.
 * Egress policy (enforced here, once): https ONLY, no credentials in the URL,
 * and the returned `host` is the SSRF allow-list — requests may reach that host
 * and nothing else. A base URL already ending in `/mcp` or `/mcp/v2` is used
 * as-is; a bare origin gets `/mcp/v2` appended (both paths verified live on
 * casepro-mcp-v2.stg-omnisai.io — each answers 401 without a key).
 */
export function deriveMcpEndpoint(baseUrl: string): { endpoint: string; host: string } {
	const url = new URL(baseUrl); // throws on garbage — caller treats that as "not configured"
	if (url.protocol !== 'https:') {
		throw new Error(`CasePro transport: base URL must be https (got ${url.protocol}//)`);
	}
	if (url.username || url.password) {
		throw new Error('CasePro transport: base URL must not embed credentials');
	}
	const path = url.pathname.replace(/\/+$/, '');
	const endpointPath = /\/mcp(\/v2)?$/.test(path) ? path : `${path}/mcp/v2`;
	return { endpoint: `${url.origin}${endpointPath}`, host: url.hostname };
}

type McpFilter = { field: string; operator: '=' | 'in'; value: unknown };

/** Map the transport's equality/`$in` filter map onto the gateway's `filters` array. */
export function buildMcpFilters(filter?: Record<string, unknown>): McpFilter[] {
	if (!filter) {
		return [];
	}
	return Object.entries(filter).map(([field, cond]) => {
		if (cond !== null && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
			return { field, operator: 'in' as const, value: (cond as { $in: unknown[] }).$in };
		}
		return { field, operator: '=' as const, value: cond };
	});
}

/** The gateway's tool payload envelope (parsed from the MCP content block). */
type McpToolPayload = {
	success?: boolean;
	error?: unknown;
	records?: unknown;
	record?: unknown;
	created?: unknown;
	updated?: unknown;
	found?: boolean;
} & Record<string, unknown>;

export type McpGatewayTransportConfig = {
	/** Gateway base URL (https). `/mcp/v2` is appended unless the path already targets `/mcp[/v2]`. */
	baseUrl: string;
	/** The X-MCP-API-Key shared secret — REQUIRED; construction refuses without it. */
	apiKey: string;
	/** The X-Organization-ID scope sent on every call (env CASEPRO_ORG_ID / setting CasePro_Org_ID). */
	orgId?: string;
	/** Injectable fetch (tests). Defaults to @rocket.chat/server-fetch. */
	fetchFn?: typeof fetch;
};

/**
 * Live CasePro transport speaking the deployed casepro-mcp-v2 gateway protocol:
 * JSON-RPC 2.0 `tools/call` over POST, five meta-verbs (query_entities / get_entity /
 * list_schema / create_entity / update_entity). Every request carries the auth headers
 * (see the module docblock) and is pinned to the configured host — SSRF validation is
 * ON with a single-host allow-list, and redirects are never followed (a redirect would
 * re-send the key elsewhere).
 *
 * Pagination note: the gateway's `query_entities` supports `limit` but NOT `offset`,
 * and reports `count` = returned rows (no true total). `query()` emulates offset by
 * over-fetching (`offset + limit`) and slicing, and signals "maybe more" through the
 * returned `total` so the client's accumulate loop pages correctly.
 */
export class McpGatewayTransport implements ICaseProTransport {
	private readonly endpoint: string;

	private readonly host: string;

	private readonly apiKey: string;

	private readonly orgId?: string;

	private readonly fetchFn: typeof fetch;

	private seq = 0;

	constructor(config: McpGatewayTransportConfig) {
		if (!config.apiKey) {
			// hard refusal — this transport NEVER sends an unauthenticated request.
			throw new Error('CasePro transport: refusing to start without CASEPRO_MCP_API_KEY');
		}
		const { endpoint, host } = deriveMcpEndpoint(config.baseUrl);
		this.endpoint = endpoint;
		this.host = host;
		this.apiKey = config.apiKey;
		this.orgId = config.orgId;
		this.fetchFn = config.fetchFn ?? fetch;
	}

	/** One JSON-RPC `tools/call` round-trip; returns the parsed tool payload. */
	private async callTool(tool: string, args: Record<string, unknown>, ctx?: CaseProCallContext): Promise<McpToolPayload> {
		this.seq += 1;
		const res = await this.fetchFn(this.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-MCP-API-Key': this.apiKey,
				...(this.orgId ? { 'X-Organization-ID': this.orgId } : {}),
				...(ctx?.actingUserId ? { 'X-Acting-User': ctx.actingUserId } : {}),
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: this.seq,
				method: 'tools/call',
				params: { name: tool, arguments: args },
			}),
			// strict egress: SSRF checks ON, allow-list = the configured host only, and
			// 3xx responses are returned as-is (never re-send the key to a Location).
			ignoreSsrfValidation: false,
			allowList: this.host,
			followRedirects: false,
		});
		if (res.status >= 300 && res.status < 400) {
			throw new Error(`CasePro ${tool}: gateway redirected (${res.status}) — refusing to follow`);
		}
		if (!res.ok) {
			throw new Error(`CasePro ${tool} failed: HTTP ${res.status}`);
		}
		const rpc = (await res.json()) as {
			error?: { code?: number; message?: string };
			result?: { isError?: boolean; content?: { type?: string; text?: string }[] };
		};
		if (rpc.error) {
			throw new Error(`CasePro ${tool} failed: ${rpc.error.message ?? `JSON-RPC ${rpc.error.code ?? 'error'}`}`);
		}
		const text = rpc.result?.content?.[0]?.text;
		if (typeof text !== 'string') {
			throw new Error(`CasePro ${tool} failed: gateway returned no content block`);
		}
		try {
			return JSON.parse(text) as McpToolPayload;
		} catch {
			throw new Error(`CasePro ${tool} failed: gateway content is not JSON`);
		}
	}

	/** Throw the payload's error unless it reports success. */
	private assertOk(payload: McpToolPayload, label: string): void {
		if (payload.success === false || payload.error !== undefined) {
			const detail = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error ?? 'unknown error');
			throw new Error(`CasePro ${label} failed: ${detail.slice(0, 500)}`);
		}
	}

	private asRow(value: unknown): CaseProRow | null {
		return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as CaseProRow) : null;
	}

	async query(entity: string, query: CaseProQuery = {}): Promise<CaseProQueryResult> {
		const offset = query.offset ?? 0;
		const limit = query.limit ?? 50;
		// the gateway has no offset — over-fetch and slice (see class docblock).
		const wireLimit = offset + limit;
		const filters = buildMcpFilters(query.filter);
		const payload = await this.callTool('query_entities', {
			entity,
			...(filters.length ? { filters } : {}),
			...(query.select?.length ? { select: query.select } : {}),
			limit: wireLimit,
		});
		this.assertOk(payload, `query(${entity})`);
		const records = Array.isArray(payload.records) ? (payload.records as CaseProRow[]) : [];
		const data = records.slice(offset, offset + limit);
		// No true total from the gateway: report an exact total when the page came back
		// short, or `+1` past what we returned while full pages keep coming so the
		// client's `out.length >= total` accumulate loop knows to fetch the next page.
		const mayHaveMore = records.length >= wireLimit;
		return { data, total: offset + data.length + (mayHaveMore ? 1 : 0) };
	}

	async get(entity: string, id: string): Promise<CaseProRow | null> {
		const payload = await this.callTool('get_entity', { entity, id });
		const record = this.asRow(payload.record);
		if (record) {
			return record;
		}
		// not-found comes back as success:false + "<entity> with id <id> not found".
		const errText = typeof payload.error === 'string' ? payload.error : '';
		if (payload.found === false || /not found/i.test(errText)) {
			return null;
		}
		this.assertOk(payload, `get(${entity}, ${id})`);
		return null;
	}

	async listSchema(entity: string): Promise<unknown> {
		const payload = await this.callTool('list_schema', { entity });
		this.assertOk(payload, `listSchema(${entity})`);
		return payload;
	}

	async create(entity: string, data: CaseProRow, ctx?: CaseProCallContext): Promise<CaseProRow> {
		const payload = await this.callTool('create_entity', { entity, data }, ctx);
		this.assertOk(payload, `create(${entity})`);
		const row = this.asRow(payload.created) ?? this.asRow(payload.record);
		if (!row || !str(row.id)) {
			throw new Error(`CasePro create(${entity}) returned no created row`);
		}
		return row;
	}

	async update(entity: string, id: string, patch: CaseProRow, ctx?: CaseProCallContext): Promise<CaseProRow> {
		const payload = await this.callTool('update_entity', { entity, id, data: patch }, ctx);
		this.assertOk(payload, `update(${entity}, ${id})`);
		const row = this.asRow(payload.updated) ?? this.asRow(payload.record);
		if (!row) {
			throw new Error(`CasePro update(${entity}, ${id}) returned no updated row`);
		}
		return row;
	}

	/**
	 * Direct authenticated POST to a plain CasePro CRM REST controller (comms-log
	 * ingest — `POST /matterchat-messages/ingest`, CasePro PR #1234). This is NOT
	 * an MCP entity tool, so it deliberately does NOT ride `tools/call`. It reuses
	 * the SAME auth headers the entity verbs build (X-MCP-API-Key + X-Organization-ID,
	 * plus the advisory X-Acting-User) and the SAME strict egress posture: https-only,
	 * a single-host SSRF allow-list, and no redirect-following (a redirect would
	 * re-send the key elsewhere). Refuses without a key by construction (the whole
	 * transport does).
	 *
	 * `path` resolution:
	 *  - absolute https URL  → used as-is; the allow-list is pinned to that URL's host
	 *    (the CRM backend may live on a different host than the MCP gateway).
	 *  - relative path       → resolved against the gateway origin; allow-list = gateway host.
	 * A non-https absolute URL is refused (never send the key over http).
	 */
	async ingest(path: string, payload: Record<string, unknown>, ctx?: CaseProCallContext): Promise<unknown> {
		let target: string;
		let allowHost: string;
		if (/^https?:\/\//i.test(path)) {
			const url = new URL(path);
			if (url.protocol !== 'https:') {
				throw new Error(`CasePro ingest: endpoint must be https (got ${url.protocol}//)`);
			}
			if (url.username || url.password) {
				throw new Error('CasePro ingest: endpoint must not embed credentials');
			}
			target = url.toString();
			allowHost = url.hostname;
		} else {
			// Resolve a relative ingest path against the gateway origin (strip the
			// JSON-RPC path segment). Same host ⇒ same allow-list entry.
			const origin = new URL(this.endpoint).origin;
			target = `${origin}/${path.replace(/^\/+/, '')}`;
			allowHost = this.host;
		}
		const res = await this.fetchFn(target, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-MCP-API-Key': this.apiKey,
				...(this.orgId ? { 'X-Organization-ID': this.orgId } : {}),
				...(ctx?.actingUserId ? { 'X-Acting-User': ctx.actingUserId } : {}),
			},
			body: JSON.stringify(payload),
			ignoreSsrfValidation: false,
			allowList: allowHost,
			followRedirects: false,
		});
		if (res.status >= 300 && res.status < 400) {
			throw new Error(`CasePro ingest(${path}): gateway redirected (${res.status}) — refusing to follow`);
		}
		if (!res.ok) {
			throw new Error(`CasePro ingest(${path}) failed: HTTP ${res.status}`);
		}
		return res.json();
	}

	/**
	 * Generic authenticated CRM REST call (GET/POST/PATCH/DELETE) — see the interface docblock. Reuses
	 * the EXACT same auth headers + strict egress posture as {@link McpGatewayTransport.ingest} (the
	 * only additions are the method + optional query string). Refuses without a key by construction.
	 */
	async request(
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		options?: { query?: Record<string, string | undefined>; body?: Record<string, unknown>; ctx?: CaseProCallContext },
	): Promise<unknown> {
		let target: string;
		let allowHost: string;
		if (/^https?:\/\//i.test(path)) {
			const url = new URL(path);
			if (url.protocol !== 'https:') {
				throw new Error(`CasePro request: endpoint must be https (got ${url.protocol}//)`);
			}
			if (url.username || url.password) {
				throw new Error('CasePro request: endpoint must not embed credentials');
			}
			target = url.toString();
			allowHost = url.hostname;
		} else {
			const origin = new URL(this.endpoint).origin;
			target = `${origin}/${path.replace(/^\/+/, '')}`;
			allowHost = this.host;
		}

		// Append the query string (skip undefined values) without mangling an existing one.
		if (options?.query) {
			const url = new URL(target);
			for (const [key, value] of Object.entries(options.query)) {
				if (value !== undefined && value !== '') {
					url.searchParams.set(key, value);
				}
			}
			target = url.toString();
		}

		const ctx = options?.ctx;
		const res = await this.fetchFn(target, {
			method,
			headers: {
				'Content-Type': 'application/json',
				'X-MCP-API-Key': this.apiKey,
				...(this.orgId ? { 'X-Organization-ID': this.orgId } : {}),
				...(ctx?.actingUserId ? { 'X-Acting-User': ctx.actingUserId } : {}),
			},
			...(options?.body ? { body: JSON.stringify(options.body) } : {}),
			ignoreSsrfValidation: false,
			allowList: allowHost,
			followRedirects: false,
		});
		if (res.status >= 300 && res.status < 400) {
			throw new Error(`CasePro request ${method} ${path}: gateway redirected (${res.status}) — refusing to follow`);
		}
		if (!res.ok) {
			throw new Error(`CasePro request ${method} ${path} failed: HTTP ${res.status}`);
		}
		// A 204 (or any empty 2xx) has no JSON body — return undefined rather than throwing.
		if (res.status === 204) {
			return undefined;
		}
		return res.json().catch(() => undefined);
	}
}

// ---------------------------------------------------------------------------
// Selection — default to the stub, override by setting or env flag.
// ---------------------------------------------------------------------------

export type CaseProTransportDiagnostics = {
	/** what the config asked for. */
	requested: 'stub' | 'rest';
	/** what actually resolves (rest only when the live wire is fully configured). */
	effective: 'stub' | 'rest';
	authMode: string;
	/** the configured gateway host (never the key). */
	host?: string;
	keyConfigured: boolean;
	orgConfigured: boolean;
	/** why a requested live transport degraded to the stub. */
	reason?: string;
};

/**
 * Inspect the live-wire config WITHOUT constructing a transport. Shared by
 * {@link resolveTransportFromConfig}, the boot warning, the `boards.casepro.status`
 * admin endpoint, and the leads-pull cron ("is the transport live?"). Never
 * returns or logs the key itself.
 */
export function caseProTransportDiagnostics(): CaseProTransportDiagnostics {
	const requested = (process.env.CASEPRO_TRANSPORT || safeGetSetting<string>('CasePro_Transport') || 'stub').toLowerCase() as
		| 'stub'
		| 'rest';
	const authMode = (process.env.CASEPRO_AUTH_MODE || safeGetSetting<string>('CasePro_Auth_Mode') || 'mcp-key').toLowerCase();
	const baseUrl = process.env.CASEPRO_BASE_URL || safeGetSetting<string>('CasePro_Base_URL') || '';
	const apiKey = process.env.CASEPRO_MCP_API_KEY || '';
	const orgId = process.env.CASEPRO_ORG_ID || safeGetSetting<string>('CasePro_Org_ID') || '';

	const base: Omit<CaseProTransportDiagnostics, 'effective' | 'reason'> = {
		requested: requested === 'rest' ? 'rest' : 'stub',
		authMode,
		keyConfigured: Boolean(apiKey),
		orgConfigured: Boolean(orgId),
	};

	if (requested !== 'rest') {
		return { ...base, effective: 'stub' };
	}
	if (authMode === 'keygate') {
		// route B stub — declared but not implemented; never silently sends the wrong auth.
		return { ...base, effective: 'stub', reason: 'auth mode "keygate" is not implemented yet (use "mcp-key")' };
	}
	if (authMode !== 'mcp-key') {
		return { ...base, effective: 'stub', reason: `unknown CasePro_Auth_Mode "${authMode}"` };
	}
	if (!baseUrl) {
		return { ...base, effective: 'stub', reason: 'no base URL configured (CASEPRO_BASE_URL / CasePro_Base_URL)' };
	}
	let host: string;
	try {
		({ host } = deriveMcpEndpoint(baseUrl));
	} catch (err) {
		return { ...base, effective: 'stub', reason: err instanceof Error ? err.message : 'invalid base URL' };
	}
	if (!apiKey) {
		// the loud refusal: live requested, no key — we NEVER send unauthenticated.
		return { ...base, host, effective: 'stub', reason: 'CASEPRO_MCP_API_KEY is not set — refusing unauthenticated live calls' };
	}
	return { ...base, host, effective: 'rest' };
}

/**
 * Resolve the configured transport. Default is the stub. The live MCP-gateway
 * transport is selected only when explicitly chosen AND fully configured
 * (https base URL + env `CASEPRO_MCP_API_KEY`); anything less degrades to the
 * stub with a LOUD warning — never an unauthenticated live call.
 *
 * Selection order:
 *   1. env CASEPRO_TRANSPORT = 'stub' | 'rest'   (test / local override)
 *   2. setting CasePro_Transport (select, default 'stub')
 */
export function resolveTransportFromConfig(): ICaseProTransport {
	const diag = caseProTransportDiagnostics();
	if (diag.effective === 'rest') {
		return new McpGatewayTransport({
			baseUrl: process.env.CASEPRO_BASE_URL || safeGetSetting<string>('CasePro_Base_URL') || '',
			apiKey: process.env.CASEPRO_MCP_API_KEY || '',
			orgId: process.env.CASEPRO_ORG_ID || safeGetSetting<string>('CasePro_Org_ID') || undefined,
		});
	}
	if (diag.requested === 'rest') {
		SystemLogger.warn({
			msg: 'CasePro LIVE transport requested but not usable — serving STUB data instead',
			reason: diag.reason,
			authMode: diag.authMode,
			keyConfigured: diag.keyConfigured,
			orgConfigured: diag.orgConfigured,
		});
	}
	return new StubTransport();
}

/** settings.get throws if the setting is not yet registered (e.g. very early boot / tests). */
function safeGetSetting<T extends SettingValue>(id: string): T | undefined {
	try {
		return settings.get<T>(id);
	} catch {
		return undefined;
	}
}
