import { serverFetch } from '@rocket.chat/server-fetch';

import { SystemLogger } from '../../logger/system';
import type { CaseProConfig } from './config';
import { caseProConfigFingerprint, resolveCaseProConfig, safeGetSetting, warnOnce } from './config';

/**
 * CasePro read/write transport (M2 — CasePro CLIENT wire layer).
 *
 * The transport is the ONLY thing that touches the wire. Everything above it
 * (mapping.ts, client.ts) is pure and never knows whether the rows came from a
 * stub, the Crm-Backend native REST API, or the hosted MCP connector. Three
 * implementations ship:
 *
 *  - {@link StubTransport}       — representative mock rows so a MatterSnapshot
 *    fully renders with zero network/config. This is the DEFAULT and the demo mode.
 *  - {@link NativeRestTransport} — adapts the generic entity verbs onto
 *    Crm-Backend's NATIVE NestJS REST routes (`POST /api/v1/matters/list`,
 *    `PATCH /api/v1/matters/update/:id`, …). Auth: `X-API-Key` +
 *    `X-Organization-ID` headers (the backend's internal service path) or a
 *    bearer key. Rows come back as flat DB-column-named objects — exactly what
 *    mapping.ts / mapping-intake.ts expect.
 *  - {@link McpTransport}        — JSON-RPC 2.0 `tools/call` against the hosted
 *    casepro-mcp connector (tools query_entities / get_entity / list_schema /
 *    create_entity / update_entity — the verbs the old RestTransport skeleton
 *    POSTed as bare routes).
 *
 * IMPORTANT (carried from every CasePro discovery doc): `aggregate_data` GROUP BY
 * is broken server-side. The transport NEVER aggregates — it returns raw rows and
 * mapping.ts sums in JS. The transport's only job is "give me the rows for this
 * entity + filter".
 *
 * Reads DEGRADE GRACEFULLY: an entity with no live endpoint yields
 * `{ data: [], total: 0 }` plus one warn per entity per process — a report never
 * throws because one rollup source is missing. Writes DO throw (a swallowed
 * write-through is silent data loss).
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
 * Per-call acting context for writes (staging live-wire seam). The live wire
 * authenticates as a service; this carries the MatterChat user who triggered the
 * write so transports can attach it as an advisory `X-Acting-User` header
 * (writer-identity seam — CasePro-side created_by/updated_by stamping is a
 * follow-up on their end). Transports may ignore it.
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
	 * controllers, NOT entity verbs (first consumer: `matterchat-messages/ingest`,
	 * the comms-log digest filing). `path` may be relative to the configured base,
	 * or an absolute https URL when the CRM backend lives on a different host.
	 * Reuses the SAME auth headers the entity verbs build and the SAME egress
	 * posture (host-pinned SSRF allow-list, no redirect-follow via serverFetch).
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

// Org users referenced by the matter's team-role columns (principal_attorney /
// case_manager / paralegal above). Real CasePro reads these from the CRM's
// read-only user directory (GET /api/v1/auth/users[/:id]); CentralizedAuth stores
// a single `name` display column. Seeded so demo mode shows names, not raw UUIDs.
const STUB_USERS: CaseProRow[] = [
	{ id: 'stub-user-attorney', name: 'Alex Marshall', email: 'alex.marshall@example.com', status: 'active' },
	{ id: 'stub-user-casemgr', name: 'Bianca Torres', email: 'bianca.torres@example.com', status: 'active' },
	{ id: 'stub-user-paralegal', name: 'Chris Nguyen', email: 'chris.nguyen@example.com', status: 'active' },
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

/** Intake form templates referenced by the seeded intakes (`template_id`). CasePro
 * requires one on every intake create, so the client's default-template fallback
 * must find rows in stub mode too. */
const STUB_INTAKE_FORM_TEMPLATES: CaseProRow[] = [
	{ id: 'stub-intaketmpl-pi', name: 'Standard PI Intake', description: 'Stub personal-injury intake form' },
	{ id: 'stub-intaketmpl-mva', name: 'MVA Intake', description: 'Stub motor-vehicle-accident intake form' },
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
	users: STUB_USERS,
	litigations: STUB_LITIGATIONS,
	intake_stages: STUB_INTAKE_STAGES,
	intake_questionnaires: STUB_INTAKE_QUESTIONNAIRES,
	intake_form_templates: STUB_INTAKE_FORM_TEMPLATES,
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
// Shared wire helpers (native + MCP).
// ---------------------------------------------------------------------------

/** Wire timeout for regular calls; the status probe overrides with 2.5s. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** HTTP error carrying the status + a body snippet so callers can branch on 404. */
export class CaseProHttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly bodySnippet: string,
	) {
		super(message);
		this.name = 'CaseProHttpError';
	}
}

/** First ~300 chars of a response body, single-line, for error surfacing. */
function snippet(text: string): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * SSRF allow-list for the configured base URL: exactly its host (and host:port).
 * Private/localhost hosts are permitted ONLY because the admin explicitly
 * configured them (that IS the local Crm-Backend use case); every redirect hop is
 * re-validated against the same list by `serverFetch`, so a redirect to any other
 * private host is refused. URLs are only ever built from the configured base —
 * no caller-supplied URL reaches the wire.
 */
function ssrfAllowListFor(baseUrl: string): string[] {
	try {
		const url = new URL(baseUrl);
		return url.port ? [url.hostname, `${url.hostname}:${url.port}`] : [url.hostname];
	} catch {
		return [];
	}
}

/**
 * Loopback normalization for the wire: `serverFetch`'s SSRF gate rejects
 * single-label hostnames (no dot ⇒ fails its domain pattern) BEFORE it ever
 * consults the allow-list, so a configured `http://localhost:…` base — the
 * standard local Crm-Backend rig — can never pass validation even though we
 * allow-list exactly the configured host (error-ssrf-validation-failed on every
 * call). IP literals take the IP path through the gate and match the allow-list
 * fine, so pin a `localhost` hostname to `127.0.0.1` for URL building and the
 * allow-list. Config/status keep displaying whatever the admin typed.
 */
function normalizeLoopbackBase(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		if (url.hostname.toLowerCase() === 'localhost') {
			url.hostname = '127.0.0.1';
			return url.toString().replace(/\/+$/, '');
		}
	} catch {
		// malformed base URLs fall through to the transport's own error paths
	}
	return baseUrl;
}

type WireRequest = {
	method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	url: string;
	params?: Record<string, string>;
	body?: Record<string, unknown>;
	headers: Record<string, string>;
	timeoutMs: number;
	allowList: string[];
};

/** One guarded HTTP call: allow-listed host, timeout, JSON errors with status + body snippet. */
async function wireFetch(req: WireRequest): Promise<{ status: number; json: unknown }> {
	let res;
	try {
		res = await serverFetch(req.url, {
			method: req.method,
			headers: { 'Content-Type': 'application/json', ...req.headers },
			...(req.params ? { params: req.params } : {}),
			...(req.body !== undefined ? { body: req.body } : {}),
			timeout: req.timeoutMs,
			ignoreSsrfValidation: false,
			allowList: req.allowList,
		});
	} catch (err) {
		throw new CaseProHttpError(0, `CasePro request ${req.method} ${req.url} failed: ${err instanceof Error ? err.message : String(err)}`, '');
	}
	const text = await res.text().catch(() => '');
	if (!res.ok) {
		throw new CaseProHttpError(res.status, `CasePro request ${req.method} ${req.url} failed: HTTP ${res.status} — ${snippet(text) || '(empty body)'}`, snippet(text));
	}
	if (!text) {
		return { status: res.status, json: undefined };
	}
	try {
		return { status: res.status, json: JSON.parse(text) };
	} catch {
		// Non-JSON 2xx (e.g. SSE from an MCP server) — hand the raw text back.
		return { status: res.status, json: text };
	}
}

function isObj(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Unwrap `{ data: row }` / bare-row response shapes to the row. */
function unwrapRow(json: unknown): CaseProRow | null {
	if (Array.isArray(json)) {
		return isObj(json[0]) ? (json[0] as CaseProRow) : null;
	}
	if (!isObj(json)) {
		return null;
	}
	if (isObj(json.data)) {
		return json.data as CaseProRow;
	}
	return json as CaseProRow;
}

// ---------------------------------------------------------------------------
// Native REST transport — Crm-Backend's real NestJS routes (global prefix /api/v1).
// ---------------------------------------------------------------------------

/** Crm-Backend caps list page size at 100. */
const NATIVE_PAGE_LIMIT = 100;
/** Hard cap: never pull more than 10 pages (1000 rows) for one query. */
const NATIVE_MAX_PAGES = 10;
/** Lookup tables (stages/case types/…) are org-stable — micro-cached per instance. */
const LOOKUP_TTL_MS = 60_000;

type NativePlan = {
	rows: CaseProRow[];
	/** Server-reported total when the WHOLE filter was pushed down; else undefined. */
	serverTotal?: number;
	/** Filter keys already applied natively (excluded from the residual JS filter). */
	pushed: string[];
	/** True when the page cap truncated the fetch (totals may undercount). */
	truncated: boolean;
};

const str2 = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** filter value → list of ids (plain string or `{ $in: [...] }`). */
function filterIds(value: unknown): string[] {
	if (typeof value === 'string' && value) {
		return [value];
	}
	if (isObj(value) && Array.isArray((value as { $in?: unknown[] }).$in)) {
		return ((value as { $in: unknown[] }).$in).filter((v): v is string => typeof v === 'string' && v !== '');
	}
	return [];
}

/**
 * Crm-Backend hydrates relations alongside the flat FK columns (`stage`,
 * `case_type_data`, `sub_stage_data`, `client`). mapping.ts reads the flat
 * DB-column names — backfill them from the nested objects when absent and
 * normalize `archived` (null → false) so the boards' `archived: false` filter
 * doesn't drop legacy rows.
 */
function flattenMatterRow(row: CaseProRow): CaseProRow {
	const out: CaseProRow = { ...row };
	if (!str2(out.stage_id) && isObj(out.stage)) {
		out.stage_id = (out.stage as CaseProRow).id;
	}
	if (!str2(out.case_type) && isObj(out.case_type_data)) {
		out.case_type = (out.case_type_data as CaseProRow).id;
	}
	if (!str2(out.sub_stage) && isObj(out.sub_stage_data)) {
		out.sub_stage = (out.sub_stage_data as CaseProRow).id;
	}
	if (!str2(out.client_id) && isObj(out.client)) {
		out.client_id = (out.client as CaseProRow).id;
	}
	if (out.archived === null || out.archived === undefined) {
		out.archived = false;
	}
	return out;
}

/**
 * The REAL `intake_stages` name column is `stage_name` (matter_stages uses
 * `matter_stage_name`, matter_sub_stages `sub_stage_name` — those match the
 * mappers, this one doesn't). mapping-intake.ts resolves board columns via
 * `intake_stage_name`, so alias it onto every intake_stages row.
 */
function normalizeIntakeStageRow(row: CaseProRow): CaseProRow {
	if (str2(row.intake_stage_name) || !str2(row.stage_name)) {
		return row;
	}
	return { ...row, intake_stage_name: row.stage_name };
}

/** Same backfill for intake rows (party / intake_stage / case_type relations may be hydrated). */
function flattenIntakeRow(row: CaseProRow): CaseProRow {
	const out: CaseProRow = { ...row };
	if (!str2(out.party_id) && isObj(out.party)) {
		out.party_id = (out.party as CaseProRow).id;
	}
	if (!str2(out.intake_stage_id) && isObj(out.intake_stage)) {
		out.intake_stage_id = (out.intake_stage as CaseProRow).id;
	}
	if (!str2(out.case_type_id) && isObj(out.case_type)) {
		out.case_type_id = (out.case_type as CaseProRow).id;
	}
	return out;
}

/**
 * Crm-Backend's `intake_questionnaires.source` column is validated as an enum
 * (AutoDoc | CasePro | MedChron) even though the board captures free-text lead
 * sources ('Web Form', 'Referral', …). A non-enum source would 400 the whole
 * write — preserve it under `form_data.lead_source` instead and drop the column.
 */
function sanitizeIntakeWrite(data: CaseProRow): CaseProRow {
	const out: CaseProRow = { ...data };
	const source = str2(out.source);
	if (source && !['AutoDoc', 'CasePro', 'MedChron'].includes(source)) {
		delete out.source;
		const formData = isObj(out.form_data) ? { ...(out.form_data as Record<string, unknown>) } : {};
		if (formData.lead_source === undefined) {
			formData.lead_source = source;
		}
		out.form_data = formData;
	}
	return out;
}

/**
 * Live transport against Crm-Backend's native REST API.
 *
 * Entity routing (all under the backend's `/api/v1` global prefix):
 *
 *   matters               query  POST matters/list                     (status pushed; archived/stage_id/case_type filtered in JS)
 *                         get    POST matters/find-one/:id
 *                         create POST matters/create                  (organization_id ALWAYS injected — CasePro doesn't enforce org on create)
 *                         update PATCH matters/update/:id
 *   matter_stages         query  POST matter-stages/list → EMPTY under service auth (backend reads req.organization, which
 *                                service-key auth leaves null) → fallback: derive stage ids from recent matters, hydrate each
 *                                via GET matter-stages/find-one/:id (org-agnostic)
 *   matter_sub_stages     query  POST matter-sub-stages/list → 500 under service auth → fallback: fan out
 *                                GET matter-sub-stages/by-matter-stage/:stageId over the resolved stages
 *   intake_stages         query  GET intake-stages/list-all?orgId=…    (plain array; org via query param works under service auth)
 *   case_types            query  POST case-types/list                  get POST case-types/find-one/:id
 *   settlement_types      query  POST settlement-types/list
 *   parties               query  POST parties/list                     get POST parties/find-one/:id   create POST parties/create
 *   intake_questionnaires query  POST intake-questionnaires/list       (matterId / intakeStageIds / caseTypeIds pushed)
 *                         get    POST intake-questionnaires/find-one/:id
 *                         create POST intake-questionnaires/create     update PATCH intake-questionnaires/update/:id
 *   medical_providers     query  POST medical-providers/matter/:matterId/list (requires filter.matter_id)
 *   bills                 query  POST medical-providers/providers/:providerId/bills/list per provider id (requires filter.medical_provider_id)
 *   negotiations          query  POST negotiations/list                (matterId pushed; NO update endpoint upstream)
 *   resolutions           query  POST resolutions/list                 update PATCH resolutions/update/:id
 *   liens                 query  POST liens/list                       update PATCH liens/update/:id
 *   reductions            query  GET liens/details/:lienId → `.reductions` per lien (requires reducible_type 'Lien' + reducible_id)
 *   expenses / litigations / insurances — POST {entity}/list (matterId pushed), POST {entity}/find-one/:id, create/update
 *   users                 query  GET auth/users?organizationId=…       get GET auth/users/:id   (CRM read-only user directory;
 *                                CentralizedAuth-session-guarded → may reject service auth; callers degrade to raw ids)
 *
 * Anything else → `{ data: [], total: 0 }` + ONE warn per entity per process.
 */
export class NativeRestTransport implements ICaseProTransport {
	private readonly apiBase: string;

	private readonly timeoutMs: number;

	private readonly allowList: string[];

	private readonly lookupCache = new Map<string, { at: number; rows: CaseProRow[] }>();

	constructor(
		private readonly cfg: CaseProConfig,
		opts: { timeoutMs?: number } = {},
	) {
		// The backend serves everything under a global /api/v1 prefix; accept base
		// URLs configured with or without it. `localhost` is pinned to 127.0.0.1
		// so the SSRF gate's allow-list can actually match (see normalizeLoopbackBase).
		const wireBase = normalizeLoopbackBase(cfg.baseUrl);
		this.apiBase = /\/api\/v\d+\/?$/.test(wireBase) ? wireBase.replace(/\/+$/, '') : joinUrl(wireBase, 'api/v1');
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.allowList = ssrfAllowListFor(wireBase);
	}

	/** internal-key → X-API-Key + X-Organization-ID (Crm-Backend's service path); bearer → Authorization. */
	private headers(): Record<string, string> {
		if (this.cfg.authMode === 'bearer') {
			return { Authorization: `Bearer ${this.cfg.apiKey}` };
		}
		return { 'X-API-Key': this.cfg.apiKey, 'X-Organization-ID': this.cfg.orgId };
	}

	private async wire(
		method: WireRequest['method'],
		path: string,
		opts: { params?: Record<string, string>; body?: Record<string, unknown>; headers?: Record<string, string> } = {},
	): Promise<{ status: number; json: unknown }> {
		return wireFetch({
			method,
			url: joinUrl(this.apiBase, path),
			params: opts.params,
			body: opts.body,
			headers: { ...this.headers(), ...(opts.headers ?? {}) },
			timeoutMs: this.timeoutMs,
			allowList: this.allowList,
		});
	}

	/**
	 * Generic authenticated CRM REST call (GET/POST/PATCH/DELETE) — the interface verb the boards
	 * calendar/email sync reuses (see {@link ICaseProTransport.request}). Same auth headers + egress
	 * posture as the entity verbs; `query` is appended as the search string (undefined/empty skipped)
	 * and `ctx.actingUserId` rides as the advisory `X-Acting-User` header. Returns the parsed JSON
	 * body (or `undefined` for an empty 2xx, e.g. a 204 DELETE).
	 */
	async request(
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		options?: { query?: Record<string, string | undefined>; body?: Record<string, unknown>; ctx?: CaseProCallContext },
	): Promise<unknown> {
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(options?.query ?? {})) {
			if (value !== undefined && value !== '') {
				params[key] = value;
			}
		}
		const { json } = await this.wire(method, path, {
			...(Object.keys(params).length ? { params } : {}),
			...(options?.body ? { body: options.body } : {}),
			...(options?.ctx?.actingUserId ? { headers: { 'X-Acting-User': options.ctx.actingUserId } } : {}),
		});
		return json;
	}

	/** request() but 404 → null instead of throwing (get-by-id semantics). */
	private async requestOr404(
		method: WireRequest['method'],
		path: string,
		opts: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
	): Promise<unknown | null> {
		try {
			return (await this.wire(method, path, opts)).json;
		} catch (err) {
			if (err instanceof CaseProHttpError && err.status === 404) {
				return null;
			}
			throw err;
		}
	}

	/**
	 * Page a native `POST {path}` list endpoint (envelope `{ data, total, currentPage,
	 * totalPages, limit }`; some list-all endpoints return a bare array or `{ data }`).
	 * Fetches until `maxRows` rows, the server total, or the page cap is reached.
	 */
	private async fetchPaged(
		path: string,
		params: Record<string, string>,
		maxRows: number,
		method: 'GET' | 'POST' = 'POST',
	): Promise<{ rows: CaseProRow[]; total: number; truncated: boolean }> {
		const rows: CaseProRow[] = [];
		let total = 0;
		for (let page = 1; page <= NATIVE_MAX_PAGES; page++) {
			const { json } = await this.wire(method, path, {
				params: { ...params, page: String(page), limit: String(NATIVE_PAGE_LIMIT), orgId: this.cfg.orgId },
				// list routes are POST with an optional body; send an empty object.
				...(method === 'POST' ? { body: {} } : {}),
			});
			if (Array.isArray(json)) {
				// bare-array (list-all style) responses are never paginated.
				const all = json.filter(isObj) as CaseProRow[];
				return { rows: all, total: all.length, truncated: false };
			}
			const envelope = isObj(json) ? json : {};
			const data = Array.isArray(envelope.data) ? (envelope.data.filter(isObj) as CaseProRow[]) : [];
			total = typeof envelope.total === 'number' ? envelope.total : rows.length + data.length;
			rows.push(...data);
			if (data.length < NATIVE_PAGE_LIMIT || rows.length >= total || rows.length >= maxRows) {
				break;
			}
		}
		return { rows, total: Math.max(total, rows.length), truncated: rows.length < total && rows.length >= NATIVE_PAGE_LIMIT * NATIVE_MAX_PAGES };
	}

	private cachedLookup(entity: string): CaseProRow[] | undefined {
		const hit = this.lookupCache.get(entity);
		return hit && Date.now() - hit.at < LOOKUP_TTL_MS ? hit.rows : undefined;
	}

	private setLookup(entity: string, rows: CaseProRow[]): CaseProRow[] {
		this.lookupCache.set(entity, { at: Date.now(), rows });
		return rows;
	}

	/**
	 * matter_stages: the native list route resolves the org from `req.organization`,
	 * which BOTH service-auth paths leave null → empty result. Try it anyway (fixed
	 * backends / session-auth futures), then fall back to deriving the stage ids
	 * from the most recent matters page and hydrating each via the org-agnostic
	 * GET matter-stages/find-one/:id (real names + order_index).
	 */
	private async fetchMatterStages(): Promise<CaseProRow[]> {
		const cached = this.cachedLookup('matter_stages');
		if (cached) {
			return cached;
		}
		try {
			const { rows } = await this.fetchPaged('matter-stages/list', { sortBy: 'order_index', sortOrder: 'ASC' }, NATIVE_PAGE_LIMIT);
			if (rows.length) {
				return this.setLookup('matter_stages', rows);
			}
		} catch (err) {
			warnOnce('native-matter-stages-list', 'CasePro native: matter-stages/list failed — deriving stages from recent matters', { err });
		}
		warnOnce(
			'native-matter-stages-derived',
			'CasePro native: matter-stages/list returned nothing under service auth — deriving the stage list from the most recent matters page (stages with no recent matters will be missing)',
		);
		const { rows: matters } = await this.fetchPaged('matters/list', {}, NATIVE_PAGE_LIMIT);
		const byId = new Map<string, CaseProRow>();
		for (const m of matters.map(flattenMatterRow)) {
			const id = str2(m.stage_id);
			if (id && !byId.has(id)) {
				const nested = isObj(m.stage) ? (m.stage as CaseProRow) : {};
				byId.set(id, { id, matter_stage_name: nested.matter_stage_name, order_index: byId.size + 1 });
			}
		}
		const hydrated = await Promise.all(
			[...byId.entries()].map(async ([id, fallback]) => {
				try {
					const row = unwrapRow(await this.requestOr404('GET', `matter-stages/find-one/${encodeURIComponent(id)}`));
					return row && str2(row.id) ? row : fallback;
				} catch {
					return fallback;
				}
			}),
		);
		return this.setLookup('matter_stages', hydrated);
	}

	/** matter_sub_stages: native list 500s under service auth → fan out by-matter-stage/:stageId. */
	private async fetchMatterSubStages(): Promise<CaseProRow[]> {
		const cached = this.cachedLookup('matter_sub_stages');
		if (cached) {
			return cached;
		}
		try {
			const { rows } = await this.fetchPaged('matter-sub-stages/list', { sortBy: 'order_index', sortOrder: 'ASC' }, NATIVE_PAGE_LIMIT);
			if (rows.length) {
				return this.setLookup('matter_sub_stages', rows);
			}
		} catch {
			// expected under service auth (route requires req.organization) — fan out below.
		}
		const stages = await this.fetchMatterStages();
		const perStage = await Promise.all(
			stages.map(async (stage) => {
				const id = str2(stage.id);
				if (!id) {
					return [];
				}
				try {
					const json = await this.requestOr404('GET', `matter-sub-stages/by-matter-stage/${encodeURIComponent(id)}`);
					const arr = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.data) ? json.data : [];
					return (arr.filter(isObj) as CaseProRow[]).map((row) => ({ matter_stage_id: id, ...row }));
				} catch (err) {
					warnOnce(`native-sub-stages-${id}`, 'CasePro native: matter-sub-stages/by-matter-stage failed for a stage', { stageId: id, err });
					return [];
				}
			}),
		);
		return this.setLookup('matter_sub_stages', perStage.flat());
	}

	/** Build the raw row set for one query — the shared epilogue in query() filters/pages it. */
	private async plan(entity: string, q: CaseProQuery): Promise<NativePlan | undefined> {
		const filter = q.filter ?? {};
		const wanted = (q.offset ?? 0) + (q.limit ?? NATIVE_PAGE_LIMIT * NATIVE_MAX_PAGES);
		const maxRows = NATIVE_PAGE_LIMIT * NATIVE_MAX_PAGES;

		switch (entity) {
			case 'matters': {
				const params: Record<string, string> = {};
				const pushed: string[] = [];
				const status = str2(filter.status);
				if (status) {
					params.status = status;
					pushed.push('status');
				}
				const residualKeys = Object.keys(filter).filter((k) => !pushed.includes(k));
				const { rows, total, truncated } = await this.fetchPaged('matters/list', params, residualKeys.length ? maxRows : Math.min(wanted, maxRows));
				return {
					rows: rows.map(flattenMatterRow),
					...(residualKeys.length ? {} : { serverTotal: total }),
					pushed,
					truncated,
				};
			}
			case 'matter_stages':
				return { rows: await this.fetchMatterStages(), pushed: [], truncated: false };
			case 'matter_sub_stages':
				return { rows: await this.fetchMatterSubStages(), pushed: [], truncated: false };
			case 'intake_stages': {
				const cached = this.cachedLookup('intake_stages');
				if (cached) {
					return { rows: cached, pushed: [], truncated: false };
				}
				// list-all takes the org as a query param, so it works under service auth
				// (the paginated POST list route reads req.organization and 500s).
				const { rows } = await this.fetchPaged('intake-stages/list-all', {}, maxRows, 'GET');
				return { rows: this.setLookup('intake_stages', rows.map(normalizeIntakeStageRow)), pushed: [], truncated: false };
			}
			case 'intake_form_templates': {
				// Needed for intake create: CasePro REQUIRES template_id (law-firm orgs
				// have no server-side fallback). GET /intake-form-templates scopes to the
				// auth org and returns the standard { data, total } envelope.
				const cached = this.cachedLookup('intake_form_templates');
				if (cached) {
					return { rows: cached, pushed: [], truncated: false };
				}
				const { rows } = await this.fetchPaged('intake-form-templates', {}, maxRows, 'GET');
				return { rows: this.setLookup('intake_form_templates', rows), pushed: [], truncated: false };
			}
			case 'users': {
				// CRM read-only user directory (team-role name resolution): GET /api/v1/auth/users
				// ?organizationId=… — paginated { data, total } envelope. Org-stable enough to
				// micro-cache. NOTE: this route is CentralizedAuth-session-guarded, so it can reject
				// service-key/MCP auth — callers degrade to raw ids (see client.resolveTeamNames).
				const cached = this.cachedLookup('users');
				if (cached) {
					return { rows: cached, pushed: [], truncated: false };
				}
				const { rows } = await this.fetchPaged('auth/users', { organizationId: this.cfg.orgId }, maxRows, 'GET');
				return { rows: this.setLookup('users', rows), pushed: [], truncated: false };
			}
			case 'case_types':
			case 'settlement_types': {
				const cached = this.cachedLookup(entity);
				if (cached) {
					return { rows: cached, pushed: [], truncated: false };
				}
				const { rows } = await this.fetchPaged(`${entity.replace('_', '-')}/list`, {}, maxRows);
				return { rows: this.setLookup(entity, rows), pushed: [], truncated: false };
			}
			case 'parties': {
				const residualKeys = Object.keys(filter);
				const { rows, total, truncated } = await this.fetchPaged('parties/list', {}, residualKeys.length ? maxRows : Math.min(wanted, maxRows));
				return { rows, ...(residualKeys.length ? {} : { serverTotal: total }), pushed: [], truncated };
			}
			case 'intake_questionnaires': {
				const params: Record<string, string> = {};
				const pushed: string[] = [];
				const matterId = str2(filter.matter_id);
				if (matterId) {
					params.matterId = matterId;
					pushed.push('matter_id');
				}
				const stageIds = filterIds(filter.intake_stage_id);
				if (stageIds.length) {
					params.intakeStageIds = stageIds.join(',');
					pushed.push('intake_stage_id');
				}
				const caseTypeIds = filterIds(filter.case_type_id);
				if (caseTypeIds.length) {
					params.caseTypeIds = caseTypeIds.join(',');
					pushed.push('case_type_id');
				}
				const residualKeys = Object.keys(filter).filter((k) => !pushed.includes(k));
				const { rows, total, truncated } = await this.fetchPaged('intake-questionnaires/list', params, residualKeys.length ? maxRows : Math.min(wanted, maxRows));
				return { rows: rows.map(flattenIntakeRow), ...(residualKeys.length ? {} : { serverTotal: total }), pushed, truncated };
			}
			case 'medical_providers': {
				const matterId = str2(filter.matter_id);
				if (!matterId) {
					warnOnce('native-medical-providers-no-matter', 'CasePro native: medical_providers can only be listed per matter (filter.matter_id) — returning empty');
					return { rows: [], serverTotal: 0, pushed: Object.keys(filter), truncated: false };
				}
				const { rows, total, truncated } = await this.fetchPaged(`medical-providers/matter/${encodeURIComponent(matterId)}/list`, {}, maxRows);
				const stamped = rows.map((row) => ({ matter_id: matterId, ...row }));
				const residualKeys = Object.keys(filter).filter((k) => k !== 'matter_id');
				return { rows: stamped, ...(residualKeys.length ? {} : { serverTotal: total }), pushed: ['matter_id'], truncated };
			}
			case 'bills': {
				const providerIds = filterIds(filter.medical_provider_id);
				if (!providerIds.length) {
					warnOnce('native-bills-no-provider', 'CasePro native: bills can only be listed per medical provider (filter.medical_provider_id) — returning empty');
					return { rows: [], serverTotal: 0, pushed: Object.keys(filter), truncated: false };
				}
				const perProvider = await Promise.all(
					providerIds.map(async (pid) => {
						const { rows } = await this.fetchPaged(`medical-providers/providers/${encodeURIComponent(pid)}/bills/list`, {}, maxRows);
						return rows.map((row) => ({ medical_provider_id: pid, ...row }));
					}),
				);
				return { rows: perProvider.flat(), pushed: ['medical_provider_id'], truncated: false };
			}
			case 'reductions': {
				const type = str2(filter.reducible_type);
				const ids = filterIds(filter.reducible_id);
				if (type !== 'Lien' || !ids.length) {
					warnOnce(
						'native-reductions-unsupported',
						"CasePro native: reductions are only reachable per lien (filter { reducible_type: 'Lien', reducible_id }) — returning empty",
					);
					return { rows: [], serverTotal: 0, pushed: Object.keys(filter), truncated: false };
				}
				const perLien = await Promise.all(
					ids.map(async (lienId) => {
						const json = await this.requestOr404('GET', `liens/details/${encodeURIComponent(lienId)}`);
						const reductions = isObj(json) && Array.isArray(json.reductions) ? (json.reductions.filter(isObj) as CaseProRow[]) : [];
						return reductions.map((row) => ({ reducible_type: 'Lien', reducible_id: lienId, ...row }));
					}),
				);
				return { rows: perLien.flat(), pushed: ['reducible_type', 'reducible_id'], truncated: false };
			}
			case 'negotiations':
			case 'resolutions':
			case 'liens':
			case 'expenses':
			case 'litigations':
			case 'insurances': {
				const params: Record<string, string> = {};
				const pushed: string[] = [];
				const matterId = str2(filter.matter_id);
				if (matterId) {
					params.matterId = matterId;
					pushed.push('matter_id');
				}
				const residualKeys = Object.keys(filter).filter((k) => !pushed.includes(k));
				const { rows, total, truncated } = await this.fetchPaged(`${entity}/list`, params, residualKeys.length ? maxRows : Math.min(wanted, maxRows));
				return { rows, ...(residualKeys.length ? {} : { serverTotal: total }), pushed, truncated };
			}
			default:
				return undefined;
		}
	}

	async query(entity: string, q: CaseProQuery = {}): Promise<CaseProQueryResult> {
		// Wire/auth failures THROW (status + body snippet) — a broken connection must
		// not masquerade as an empty org. Only UNMAPPED entities degrade to empty.
		const plan = await this.plan(entity, q);
		if (!plan) {
			warnOnce(`native-entity-unmapped-${entity}`, `CasePro native: entity '${entity}' has no live Crm-Backend endpoint — returning empty result`);
			return { data: [], total: 0 };
		}

		const residual: Record<string, unknown> = {};
		for (const [key, cond] of Object.entries(q.filter ?? {})) {
			if (!plan.pushed.includes(key)) {
				residual[key] = cond;
			}
		}
		const filtered = Object.keys(residual).length ? plan.rows.filter((row) => rowMatches(row, residual)) : plan.rows;
		if (plan.truncated) {
			warnOnce(`native-truncated-${entity}`, `CasePro native: query(${entity}) hit the ${NATIVE_PAGE_LIMIT * NATIVE_MAX_PAGES}-row cap — results/totals may be incomplete`);
		}
		const total = plan.serverTotal ?? filtered.length;
		const offset = q.offset ?? 0;
		const limit = q.limit ?? filtered.length;
		return { data: filtered.slice(offset, offset + limit), total };
	}

	async get(entity: string, id: string): Promise<CaseProRow | null> {
		const eid = encodeURIComponent(id);
		const routes: Record<string, { method: 'GET' | 'POST'; path: string }> = {
			matters: { method: 'POST', path: `matters/find-one/${eid}` },
			parties: { method: 'POST', path: `parties/find-one/${eid}` },
			intake_questionnaires: { method: 'POST', path: `intake-questionnaires/find-one/${eid}` },
			matter_stages: { method: 'GET', path: `matter-stages/find-one/${eid}` },
			matter_sub_stages: { method: 'GET', path: `matter-sub-stages/find-one/${eid}` },
			intake_stages: { method: 'GET', path: `intake-stages/find-one/${eid}` },
			users: { method: 'GET', path: `auth/users/${eid}` },
			case_types: { method: 'POST', path: `case-types/find-one/${eid}` },
			settlement_types: { method: 'POST', path: `settlement-types/find-one/${eid}` },
			medical_providers: { method: 'GET', path: `medical-providers/get-one/${eid}` },
			bills: { method: 'GET', path: `medical-providers/bills/get-one/${eid}` },
			negotiations: { method: 'POST', path: `negotiations/find-one/${eid}` },
			resolutions: { method: 'POST', path: `resolutions/find-one/${eid}` },
			liens: { method: 'POST', path: `liens/find-one/${eid}` },
			expenses: { method: 'POST', path: `expenses/find-one/${eid}` },
			litigations: { method: 'POST', path: `litigations/find-one/${eid}` },
			insurances: { method: 'POST', path: `insurances/find-one/${eid}` },
		};
		const route = routes[entity];
		if (!route) {
			warnOnce(`native-get-unmapped-${entity}`, `CasePro native: get(${entity}) has no live Crm-Backend endpoint — returning null`);
			return null;
		}
		const json = await this.requestOr404(route.method, route.path, route.method === 'POST' ? { body: {} } : {});
		if (json === null) {
			return null;
		}
		const row = unwrapRow(json);
		if (!row) {
			return null;
		}
		if (entity === 'matters') {
			return flattenMatterRow(row);
		}
		if (entity === 'intake_questionnaires') {
			return flattenIntakeRow(row);
		}
		if (entity === 'intake_stages') {
			return normalizeIntakeStageRow(row);
		}
		if (entity === 'users' && isObj(row.user)) {
			// GET /auth/users/:id may wrap the record as { user: {...} }.
			return row.user as CaseProRow;
		}
		return row;
	}

	async listSchema(entity: string): Promise<unknown> {
		return (await this.wire('GET', `schema/entities/${encodeURIComponent(entity)}`)).json;
	}

	async create(entity: string, data: CaseProRow, ctx?: CaseProCallContext): Promise<CaseProRow> {
		// CasePro does NOT enforce org on create — ALWAYS inject organization_id.
		let body: Record<string, unknown> = { organization_id: this.cfg.orgId, ...data };
		let route: { method: 'POST'; path: string };
		switch (entity) {
			case 'matters':
				route = { method: 'POST', path: 'matters/create' };
				break;
			case 'parties':
				route = { method: 'POST', path: 'parties/create' };
				break;
			case 'intake_questionnaires':
				route = { method: 'POST', path: 'intake-questionnaires/create' };
				body = sanitizeIntakeWrite(body as CaseProRow);
				break;
			case 'case_types':
				route = { method: 'POST', path: 'case-types/create' };
				break;
			case 'settlement_types':
				route = { method: 'POST', path: 'settlement-types/create' };
				break;
			case 'matter_stages':
				route = { method: 'POST', path: 'matter-stages/create' };
				break;
			case 'matter_sub_stages':
				route = { method: 'POST', path: 'matter-sub-stages/create' };
				break;
			case 'intake_stages':
				route = { method: 'POST', path: 'intake-stages/create' };
				break;
			case 'liens':
				route = { method: 'POST', path: 'liens/create' };
				break;
			case 'expenses':
				route = { method: 'POST', path: 'expenses/create' };
				break;
			case 'litigations':
				route = { method: 'POST', path: 'litigations/create' };
				break;
			case 'negotiations':
				route = { method: 'POST', path: 'negotiations/create' };
				break;
			case 'resolutions':
				route = { method: 'POST', path: 'resolutions/create' };
				break;
			case 'insurances':
				route = { method: 'POST', path: 'insurances/create' };
				break;
			case 'medical_providers':
				route = { method: 'POST', path: 'medical-providers' };
				break;
			case 'bills': {
				const providerId = str2(data.medical_provider_id);
				if (!providerId) {
					throw new Error('CasePro native create(bills): data.medical_provider_id is required');
				}
				route = { method: 'POST', path: `medical-providers/${encodeURIComponent(providerId)}/bills` };
				break;
			}
			default:
				throw new Error(`CasePro native create(${entity}): no live Crm-Backend endpoint`);
		}
		this.lookupCache.delete(entity);
		const { json } = await this.wire(route.method, route.path, { body, ...(ctx?.actingUserId ? { headers: { 'X-Acting-User': ctx.actingUserId } } : {}) });
		const row = unwrapRow(json);
		if (!row || !str2(row.id)) {
			throw new Error(`CasePro native create(${entity}) returned no row id`);
		}
		return row;
	}

	async update(entity: string, id: string, patch: CaseProRow, ctx?: CaseProCallContext): Promise<CaseProRow> {
		const eid = encodeURIComponent(id);
		const routes: Record<string, { method: 'PATCH' | 'PUT'; path: string }> = {
			matters: { method: 'PATCH', path: `matters/update/${eid}` },
			parties: { method: 'PATCH', path: `parties/update/${eid}` },
			intake_questionnaires: { method: 'PATCH', path: `intake-questionnaires/update/${eid}` },
			case_types: { method: 'PATCH', path: `case-types/update/${eid}` },
			settlement_types: { method: 'PATCH', path: `settlement-types/update/${eid}` },
			matter_stages: { method: 'PATCH', path: `matter-stages/update/${eid}` },
			matter_sub_stages: { method: 'PUT', path: `matter-sub-stages/update/${eid}` },
			intake_stages: { method: 'PUT', path: `intake-stages/update/${eid}` },
			liens: { method: 'PATCH', path: `liens/update/${eid}` },
			expenses: { method: 'PATCH', path: `expenses/update/${eid}` },
			litigations: { method: 'PATCH', path: `litigations/update/${eid}` },
			resolutions: { method: 'PATCH', path: `resolutions/update/${eid}` },
			insurances: { method: 'PATCH', path: `insurances/update/${eid}` },
			medical_providers: { method: 'PATCH', path: `medical-providers/edit/${eid}` },
			bills: { method: 'PATCH', path: `medical-providers/bills/edit/${eid}` },
			// negotiations / reductions have NO update endpoint upstream — falls to the throw below.
		};
		const route = routes[entity];
		if (!route) {
			throw new Error(`CasePro native update(${entity}): no live Crm-Backend endpoint`);
		}
		this.lookupCache.delete(entity);
		const body = entity === 'intake_questionnaires' ? sanitizeIntakeWrite(patch) : patch;
		const { json } = await this.wire(route.method, route.path, {
			body: body as Record<string, unknown>,
			...(ctx?.actingUserId ? { headers: { 'X-Acting-User': ctx.actingUserId } } : {}),
		});
		let row = unwrapRow(json);
		if (!row || !str2(row.id)) {
			// Some update routes answer with a message envelope — re-read for the full row.
			row = await this.get(entity, id);
		}
		if (!row) {
			throw new Error(`CasePro native update(${entity}, ${id}) returned no row`);
		}
		return row;
	}

	/**
	 * Direct authenticated POST to a plain CasePro CRM REST controller (comms-log
	 * ingest — `POST /matterchat-messages/ingest`). Reconciled from the staging
	 * live-wire onto this transport: SAME auth headers as the entity verbs, SAME
	 * egress posture (host-pinned allow-list via wireFetch/serverFetch). A relative
	 * `path` resolves against the transport's `/api/v1` base (the CRM serves its
	 * controllers there); an absolute URL may point at a different CRM host —
	 * https required unless the host is loopback (the admin-configured local rig).
	 */
	async ingest(path: string, payload: Record<string, unknown>, ctx?: CaseProCallContext): Promise<unknown> {
		const extra = ctx?.actingUserId ? { 'X-Acting-User': ctx.actingUserId } : {};
		if (/^https?:\/\//i.test(path)) {
			const target = resolveAbsoluteIngestUrl(path);
			const { json } = await wireFetch({
				method: 'POST',
				url: target.url,
				body: payload,
				headers: { ...this.headers(), ...extra },
				timeoutMs: this.timeoutMs,
				allowList: target.allowList,
			});
			return json;
		}
		const { json } = await this.wire('POST', path, { body: payload, ...(ctx?.actingUserId ? { headers: extra } : {}) });
		return json;
	}
}

/**
 * Validate + pin an ABSOLUTE ingest URL (comms-log's ingest endpoint may live on a
 * different host than the transport base). https is required — the payload rides
 * with auth headers — except for loopback hosts (the explicitly configured local
 * rig case; `localhost` is pinned to 127.0.0.1 for the SSRF gate, same as bases).
 */
function resolveAbsoluteIngestUrl(raw: string): { url: string; allowList: string[] } {
	const url = new URL(raw);
	if (url.username || url.password) {
		throw new Error('CasePro ingest: endpoint must not embed credentials');
	}
	if (url.hostname.toLowerCase() === 'localhost') {
		url.hostname = '127.0.0.1';
	}
	const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1';
	if (url.protocol !== 'https:' && !loopback) {
		throw new Error(`CasePro ingest: endpoint must be https (got ${url.protocol}//)`);
	}
	const allowList = url.port ? [url.hostname, `${url.hostname}:${url.port}`] : [url.hostname];
	return { url: url.toString(), allowList };
}

// ---------------------------------------------------------------------------
// MCP transport — JSON-RPC 2.0 tools/call against the hosted CasePro connector.
// ---------------------------------------------------------------------------

/**
 * Hosted-connector transport. POSTs JSON-RPC 2.0 `tools/call` to
 * `{base}{mcpPath}` (staging probe: https://casepro-mcp-v2.stg-omnisai.io/mcp →
 * 401 unauthed; the path is configurable — default '/mcp/v2'). Tools carry the
 * connector's generic entity verbs with the args the old RestTransport sent as
 * request bodies. Auth: `Authorization: Bearer <secret>` plus an `X-MCP-Key`
 * fallback header (the connector accepts either).
 *
 * Result parsing: MCP tool results arrive as `result.content` blocks — the JSON
 * payload is a `text` block that we `JSON.parse`. Servers speaking streamable
 * HTTP may answer `text/event-stream`; the SSE `data:` lines are parsed and the
 * matching JSON-RPC response extracted.
 */
export class McpTransport implements ICaseProTransport {
	private readonly url: string;

	private readonly timeoutMs: number;

	private readonly allowList: string[];

	private rpcSeq = 0;

	constructor(
		private readonly cfg: CaseProConfig,
		opts: { timeoutMs?: number } = {},
	) {
		// `localhost` pinned to 127.0.0.1 for the same SSRF-gate reason as
		// NativeRestTransport (see normalizeLoopbackBase).
		const wireBase = normalizeLoopbackBase(cfg.baseUrl);
		this.url = joinUrl(wireBase, cfg.mcpPath || '/mcp/v2');
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.allowList = ssrfAllowListFor(wireBase);
	}

	/** Extract the JSON-RPC response object from a JSON or SSE (`data:` lines) payload. */
	private static parseRpcPayload(json: unknown): Record<string, unknown> | undefined {
		if (isObj(json)) {
			return json;
		}
		if (typeof json !== 'string') {
			return undefined;
		}
		// text/event-stream: last `data:` line that parses to a JSON-RPC response wins.
		let found: Record<string, unknown> | undefined;
		for (const line of json.split(/\r?\n/)) {
			if (!line.startsWith('data:')) {
				continue;
			}
			try {
				const parsed = JSON.parse(line.slice(5).trim());
				if (isObj(parsed) && ('result' in parsed || 'error' in parsed)) {
					found = parsed;
				}
			} catch {
				// partial/keep-alive lines are expected — skip.
			}
		}
		return found;
	}

	/** One tools/call round trip → the tool's parsed JSON payload (or undefined). */
	private async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
		this.rpcSeq += 1;
		const { json } = await wireFetch({
			method: 'POST',
			url: this.url,
			body: {
				jsonrpc: '2.0',
				id: this.rpcSeq,
				method: 'tools/call',
				params: { name: tool, arguments: args },
			},
			headers: {
				Authorization: `Bearer ${this.cfg.apiKey}`,
				'X-MCP-Key': this.cfg.apiKey,
				Accept: 'application/json, text/event-stream',
			},
			timeoutMs: this.timeoutMs,
			allowList: this.allowList,
		});

		const rpc = McpTransport.parseRpcPayload(json);
		if (!rpc) {
			throw new Error(`CasePro MCP ${tool}: unparseable response`);
		}
		if (isObj(rpc.error)) {
			const { code, message } = rpc.error as { code?: number; message?: string };
			throw new Error(`CasePro MCP ${tool} failed: ${code ?? ''} ${message ?? 'unknown JSON-RPC error'}`.trim());
		}
		const result = isObj(rpc.result) ? rpc.result : {};
		const content = Array.isArray(result.content) ? result.content : [];
		const text = content
			.filter((block): block is { type: string; text: string } => isObj(block) && block.type === 'text' && typeof block.text === 'string')
			.map((block) => block.text)
			.join('\n');
		if (result.isError) {
			throw new Error(`CasePro MCP ${tool} failed: ${snippet(text) || 'tool reported an error'}`);
		}
		if (text) {
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		}
		// Some servers return structuredContent instead of a text block.
		return isObj(result.structuredContent) ? result.structuredContent : undefined;
	}

	async query(entity: string, q: CaseProQuery = {}): Promise<CaseProQueryResult> {
		// Wire/auth failures THROW (status + body snippet); the connector itself
		// answers unknown entities with an empty payload, so no unmapped-set here.
		const parsed = await this.call('query_entities', {
			entity,
			filter: q.filter ?? {},
			...(q.select ? { select: q.select } : {}),
			...(q.limit !== undefined ? { limit: q.limit } : {}),
			...(q.offset !== undefined ? { offset: q.offset } : {}),
		});
		// the connector returns raw DB columns — apply the same column aliases the mappers rely on.
		const normalize = (rows: CaseProRow[]): CaseProRow[] => (entity === 'intake_stages' ? rows.map(normalizeIntakeStageRow) : rows);
		if (Array.isArray(parsed)) {
			const data = normalize(parsed.filter(isObj) as CaseProRow[]);
			return { data, total: data.length };
		}
		if (isObj(parsed)) {
			const data = normalize(Array.isArray(parsed.data) ? (parsed.data.filter(isObj) as CaseProRow[]) : []);
			return { data, total: typeof parsed.total === 'number' ? parsed.total : data.length };
		}
		return { data: [], total: 0 };
	}

	async get(entity: string, id: string): Promise<CaseProRow | null> {
		try {
			const parsed = await this.call('get_entity', { entity, id });
			if (parsed === null || parsed === undefined) {
				return null;
			}
			const row = unwrapRow(parsed);
			return row && entity === 'intake_stages' ? normalizeIntakeStageRow(row) : row;
		} catch (err) {
			if (err instanceof Error && /not[\s-]?found|404/i.test(err.message)) {
				return null;
			}
			throw err;
		}
	}

	async listSchema(entity: string): Promise<unknown> {
		return this.call('list_schema', { entity });
	}

	async create(entity: string, data: CaseProRow, _ctx?: CaseProCallContext): Promise<CaseProRow> {
		const parsed = await this.call('create_entity', { entity, data });
		const row = unwrapRow(parsed);
		if (!row || !str2(row.id)) {
			throw new Error(`CasePro MCP create(${entity}) returned no row id`);
		}
		return row;
	}

	async update(entity: string, id: string, patch: CaseProRow, _ctx?: CaseProCallContext): Promise<CaseProRow> {
		const parsed = await this.call('update_entity', { entity, id, patch });
		let row = unwrapRow(parsed);
		if (!row || !str2(row.id)) {
			row = await this.get(entity, id);
		}
		if (!row) {
			throw new Error(`CasePro MCP update(${entity}, ${id}) returned no row`);
		}
		return row;
	}

	/**
	 * Direct authenticated POST to a plain CasePro CRM REST controller (comms-log
	 * ingest). NOT an MCP entity tool, so it deliberately does NOT ride
	 * `tools/call`. Same auth headers as the JSON-RPC calls, same egress posture.
	 * A relative `path` resolves against the configured base URL; an absolute URL
	 * may point at a different CRM host (https unless loopback).
	 */
	async ingest(path: string, payload: Record<string, unknown>, ctx?: CaseProCallContext): Promise<unknown> {
		const target = /^https?:\/\//i.test(path)
			? resolveAbsoluteIngestUrl(path)
			: { url: joinUrl(normalizeLoopbackBase(this.cfg.baseUrl), path), allowList: this.allowList };
		const { json } = await wireFetch({
			method: 'POST',
			url: target.url,
			body: payload,
			headers: {
				Authorization: `Bearer ${this.cfg.apiKey}`,
				'X-MCP-Key': this.cfg.apiKey,
				...(ctx?.actingUserId ? { 'X-Acting-User': ctx.actingUserId } : {}),
			},
			timeoutMs: this.timeoutMs,
			allowList: target.allowList,
		});
		return json;
	}

	/**
	 * Generic authenticated CRM REST call (GET/POST/PATCH/DELETE) — the interface verb the boards
	 * calendar/email sync reuses (see {@link ICaseProTransport.request}). Calendar & communications
	 * are plain CRM REST endpoints (not JSON-RPC tools), so they ride the gateway's own origin with the
	 * SAME auth + strict egress posture as {@link McpTransport.call} (via {@link wireFetch}: allow-listed
	 * host, https/SSRF gate, no redirect follow). `query` is appended (undefined/empty skipped) and
	 * `ctx.actingUserId` rides as the advisory `X-Acting-User` header. Returns the parsed JSON body
	 * (or `undefined` for an empty 2xx).
	 */
	async request(
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		options?: { query?: Record<string, string | undefined>; body?: Record<string, unknown>; ctx?: CaseProCallContext },
	): Promise<unknown> {
		const target = /^https?:\/\//i.test(path) ? path : `${new URL(this.url).origin}/${path.replace(/^\/+/, '')}`;
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(options?.query ?? {})) {
			if (value !== undefined && value !== '') {
				params[key] = value;
			}
		}
		const { json } = await wireFetch({
			method,
			url: target,
			...(Object.keys(params).length ? { params } : {}),
			...(options?.body ? { body: options.body } : {}),
			headers: {
				Authorization: `Bearer ${this.cfg.apiKey}`,
				'X-MCP-Key': this.cfg.apiKey,
				...(this.cfg.orgId ? { 'X-Organization-ID': this.cfg.orgId } : {}),
				...(options?.ctx?.actingUserId ? { 'X-Acting-User': options.ctx.actingUserId } : {}),
			},
			timeoutMs: this.timeoutMs,
			allowList: this.allowList,
		});
		return json;
	}
}

// ---------------------------------------------------------------------------
// Selection — default to the stub; the enablement gate lives HERE.
// ---------------------------------------------------------------------------

/** Instantiate a transport for an explicit kind (the status probe uses a short timeout). */
export function instantiateTransport(
	kind: 'stub' | 'native' | 'mcp',
	cfg: CaseProConfig,
	opts: { timeoutMs?: number } = {},
): ICaseProTransport {
	switch (kind) {
		case 'native':
			return new NativeRestTransport(cfg, opts);
		case 'mcp':
			return new McpTransport(cfg, opts);
		default:
			return new StubTransport();
	}
}

/** Memoized active transport — keeps the stub's in-memory store alive across calls. */
let active: { fingerprint: string; transport: ICaseProTransport } | undefined;

/**
 * Resolve the ACTIVE transport. This is the single enablement gate for reads AND
 * writes (design §4): `CasePro_Enabled === false` → the stub serves everything
 * (demo mode, writes land only in the in-memory store); enabled → the configured
 * transport ('stub' | 'native' | 'mcp'; legacy 'rest' → 'mcp'; a live choice
 * without a base URL falls back to stub — see {@link resolveCaseProConfig}).
 *
 * The instance is memoized on the resolved config fingerprint so the default
 * stub behaves byte-for-byte as before (one live store per config lifetime) and
 * admin setting changes take effect on the next call without a restart.
 */
export function resolveTransportFromConfig(): ICaseProTransport {
	const cfg = resolveCaseProConfig();
	const effective = cfg.enabled ? cfg.transport : 'stub';
	const fingerprint = `${effective} ${caseProConfigFingerprint(cfg)}`;
	if (active?.fingerprint !== fingerprint) {
		if (active) {
			SystemLogger.info({ msg: 'boards.casepro.transportChanged', transport: effective, enabled: cfg.enabled });
		}
		active = { fingerprint, transport: instantiateTransport(effective, cfg) };
	}
	return active.transport;
}

// ---------------------------------------------------------------------------
// Diagnostics — the staging live-wire's "why is live degraded?" surface,
// reconciled onto this config model (transports: stub | native | mcp).
// ---------------------------------------------------------------------------

export type CaseProTransportDiagnostics = {
	/** what the config asked for (before enablement/fallbacks). */
	requested: 'stub' | 'native' | 'mcp';
	/** what actually resolves (a live kind only when enabled + fully configured). */
	effective: 'stub' | 'native' | 'mcp';
	authMode: string;
	/** the configured CasePro host (never the key). */
	host?: string;
	keyConfigured: boolean;
	orgConfigured: boolean;
	/** why a requested live transport degraded to the stub. */
	reason?: string;
};

/**
 * Inspect the live-wire config WITHOUT constructing a transport. Shared by the
 * boot warning, the `boards.casepro.status` admin surface (additive `diagnostics`
 * key) and the leads-pull cron ("is the transport live?"). Never returns or logs
 * the key itself. `requested` reflects the RAW transport choice (env/setting,
 * with the legacy 'rest' → 'mcp' alias); `effective` folds in the enablement
 * gate and resolveCaseProConfig's missing-base-URL fallback — mirroring
 * {@link resolveTransportFromConfig}'s selection exactly.
 */
export function caseProTransportDiagnostics(): CaseProTransportDiagnostics {
	const cfg = resolveCaseProConfig();
	const rawChoice = (process.env.CASEPRO_TRANSPORT || safeGetSetting<string>('CasePro_Transport') || 'stub').toLowerCase();
	const requested: 'stub' | 'native' | 'mcp' =
		rawChoice === 'rest' || rawChoice === 'mcp' ? 'mcp' : rawChoice === 'native' ? 'native' : 'stub';
	const effective = cfg.enabled ? cfg.transport : 'stub';

	let host: string | undefined;
	try {
		host = cfg.baseUrl ? new URL(normalizeLoopbackBase(cfg.baseUrl)).host : undefined;
	} catch {
		host = undefined;
	}

	const base: CaseProTransportDiagnostics = {
		requested,
		effective,
		authMode: cfg.authMode,
		...(host ? { host } : {}),
		keyConfigured: Boolean(cfg.apiKey),
		orgConfigured: Boolean(cfg.orgId),
	};

	if (effective !== 'stub') {
		return base;
	}
	if (requested === 'stub') {
		return base;
	}
	if (!cfg.enabled) {
		return { ...base, reason: 'CasePro_Enabled is off — the integration is disabled (admin kill switch)' };
	}
	if (!cfg.baseUrl) {
		return { ...base, reason: 'no base URL configured (CASEPRO_BASE_URL / CasePro_Base_URL)' };
	}
	return { ...base, reason: 'live transport degraded to the stub — check the server logs for the config warning' };
}
