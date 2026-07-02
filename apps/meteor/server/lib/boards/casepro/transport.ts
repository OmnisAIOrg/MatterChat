import type { SettingValue } from '@rocket.chat/core-typings';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { settings } from '../../../../app/settings/server';

/**
 * CasePro read transport (M2 — CasePro READ CLIENT).
 *
 * The transport is the ONLY thing that touches the wire. Everything above it
 * (mapping.ts, client.ts) is pure and never knows whether the rows came from a
 * stub or a live CasePro/MCP connector. Two implementations ship:
 *
 *  - {@link StubTransport}  — representative mock rows so a MatterSnapshot fully
 *    renders with zero network/config. This is the DEFAULT.
 *  - {@link RestTransport}  — a Meteor server-side fetch against the configured
 *    CasePro base URL. Auth is stubbed with a clearly-marked TODO(auth) where the
 *    OIDC `sub`→users.id / KeyGate handshake plugs in.
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
	create(entity: string, data: CaseProRow): Promise<CaseProRow>;
	/** Patch a row by id; returns the full updated row. */
	update(entity: string, id: string, patch: CaseProRow): Promise<CaseProRow>;
	/**
	 * Narrow custom-path POST for CasePro ingest endpoints that don't speak the
	 * entity verbs (first consumer: `matterchat-messages/ingest`, the comms-log
	 * digest filing). `path` is relative to the configured base URL.
	 *
	 * TODO(auth) — LIVE-WIRE LANE: this verb must ride the SAME auth handshake as
	 * the entity verbs (see {@link RestTransport.authHeaders}). It intentionally
	 * calls authHeaders() so wiring auth there covers ingest automatically —
	 * please keep it that way (do not give ingest its own header path).
	 */
	ingest(path: string, payload: Record<string, unknown>): Promise<unknown>;
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

	async create(entity: string, data: CaseProRow): Promise<CaseProRow> {
		const id = str(data.id) ?? this.nextId(entity);
		const row: CaseProRow = { ...data, id };
		this.table(entity).push(row);
		return { ...row };
	}

	async update(entity: string, id: string, patch: CaseProRow): Promise<CaseProRow> {
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

	async ingest(path: string, payload: Record<string, unknown>): Promise<unknown> {
		this.ingested.push({ path, payload });
		return { ok: true, stub: true };
	}
}

// ---------------------------------------------------------------------------
// REST transport — Meteor server-side fetch against the configured CasePro URL.
// ---------------------------------------------------------------------------

/**
 * Live transport skeleton. The exact CasePro/MCP REST verb shapes are confirmed
 * at integration time; this maps the three transport verbs onto a query/get/schema
 * surface and leaves auth as the single marked seam.
 */
export class RestTransport implements ICaseProTransport {
	constructor(private readonly baseUrl: string) {}

	/**
	 * TODO(auth): plug the CentralizedAuth OIDC `sub` → CasePro `users.id` /
	 * KeyGate service-key handshake in here. For now this returns only the JSON
	 * content-type header. When wired, read the auth mode + secret from settings
	 * (`CasePro_Auth_Mode`, service-key/bearer/cookie) and attach the right header.
	 */
	private authHeaders(): Record<string, string> {
		return { 'Content-Type': 'application/json' };
	}

	private url(path: string): string {
		const base = this.baseUrl.replace(/\/+$/, '');
		return `${base}/${path.replace(/^\/+/, '')}`;
	}

	async query(entity: string, query: CaseProQuery = {}): Promise<CaseProQueryResult> {
		const res = await fetch(this.url('query_entities'), {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({ entity, filter: query.filter ?? {}, select: query.select, limit: query.limit, offset: query.offset }),
			// TODO(auth): once a per-org allow-list exists, prefer `allowList` over disabling SSRF checks.
			ignoreSsrfValidation: true,
		});
		if (!res.ok) {
			throw new Error(`CasePro query(${entity}) failed: ${res.status}`);
		}
		const json = (await res.json()) as { data?: CaseProRow[]; total?: number };
		return { data: json.data ?? [], total: json.total ?? json.data?.length ?? 0 };
	}

	async get(entity: string, id: string): Promise<CaseProRow | null> {
		const res = await fetch(this.url('get_entity'), {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({ entity, id }),
			ignoreSsrfValidation: true,
		});
		if (!res.ok) {
			if (res.status === 404) {
				return null;
			}
			throw new Error(`CasePro get(${entity}, ${id}) failed: ${res.status}`);
		}
		const json = (await res.json()) as { data?: CaseProRow | null };
		return json.data ?? null;
	}

	async listSchema(entity: string): Promise<unknown> {
		const res = await fetch(this.url('list_schema'), {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({ entity }),
			ignoreSsrfValidation: true,
		});
		if (!res.ok) {
			throw new Error(`CasePro listSchema(${entity}) failed: ${res.status}`);
		}
		return res.json();
	}

	/**
	 * TODO(auth): write verbs need the SAME CentralizedAuth/KeyGate handshake the
	 * reads do (see {@link authHeaders}), plus — critically — a writer identity so
	 * CasePro stamps created_by/updated_by. Until that seam is wired, the live
	 * transport must NOT be used for writes in production; the stub backs all tests.
	 */
	async create(entity: string, data: CaseProRow): Promise<CaseProRow> {
		const res = await fetch(this.url('create_entity'), {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({ entity, data }),
			ignoreSsrfValidation: true,
		});
		if (!res.ok) {
			throw new Error(`CasePro create(${entity}) failed: ${res.status}`);
		}
		const json = (await res.json()) as { data?: CaseProRow };
		if (!json.data) {
			throw new Error(`CasePro create(${entity}) returned no row`);
		}
		return json.data;
	}

	/**
	 * Custom-path POST (comms-log ingest). Rides {@link authHeaders} on purpose —
	 * when the live-wire lane lands the KeyGate/OIDC handshake there, ingest is
	 * covered automatically. Do NOT fork a separate header path for ingest.
	 */
	async ingest(path: string, payload: Record<string, unknown>): Promise<unknown> {
		// `path` may be absolute: the comms-log ingest lives on the CasePro CRM
		// backend, which can be a different host than the MCP connector base URL.
		const target = /^https?:\/\//i.test(path) ? path : this.url(path);
		const res = await fetch(target, {
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify(payload),
			// TODO(auth): once a per-org allow-list exists, prefer `allowList` over disabling SSRF checks.
			ignoreSsrfValidation: true,
		});
		if (!res.ok) {
			throw new Error(`CasePro ingest(${path}) failed: ${res.status}`);
		}
		return res.json();
	}

	async update(entity: string, id: string, patch: CaseProRow): Promise<CaseProRow> {
		const res = await fetch(this.url('update_entity'), {
			// PATCH semantics; some connectors expose this as POST update_entity — keep POST to match the read verbs.
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({ entity, id, patch }),
			ignoreSsrfValidation: true,
		});
		if (!res.ok) {
			throw new Error(`CasePro update(${entity}, ${id}) failed: ${res.status}`);
		}
		const json = (await res.json()) as { data?: CaseProRow };
		if (!json.data) {
			throw new Error(`CasePro update(${entity}, ${id}) returned no row`);
		}
		return json.data;
	}
}

// ---------------------------------------------------------------------------
// Selection — default to the stub, override by setting or env flag.
// ---------------------------------------------------------------------------

/**
 * Resolve the configured transport. Default is the stub. The REST transport is
 * selected only when explicitly chosen AND a base URL is present.
 *
 * Selection order:
 *   1. env CASEPRO_TRANSPORT = 'stub' | 'rest'   (test / local override)
 *   2. setting CasePro_Transport (select, default 'stub')
 */
export function resolveTransportFromConfig(): ICaseProTransport {
	const envChoice = process.env.CASEPRO_TRANSPORT;
	const settingChoice = safeGetSetting<string>('CasePro_Transport');
	const choice = (envChoice || settingChoice || 'stub').toLowerCase();

	if (choice === 'rest') {
		const baseUrl = process.env.CASEPRO_BASE_URL || safeGetSetting<string>('CasePro_Base_URL') || '';
		if (baseUrl) {
			return new RestTransport(baseUrl);
		}
		// Misconfigured (rest selected, no URL) — fall back to stub so snapshots still render.
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
