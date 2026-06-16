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
 * The transport contract. Three verbs, mirroring the CasePro connector surface
 * that the discovery docs describe (`query_entities`, `get_entity`, `list_schema`).
 */
export interface ICaseProTransport {
	/** Page rows for an entity+filter. NEVER groups/aggregates (aggregate_data is broken). */
	query(entity: string, query?: CaseProQuery): Promise<CaseProQueryResult>;
	/** Single row by id, or null. */
	get(entity: string, id: string): Promise<CaseProRow | null>;
	/** Schema/diagnostics for an entity (admin "test connection"). */
	listSchema(entity: string): Promise<unknown>;
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
const STUB_CASE_TYPES: CaseProRow[] = [{ id: 'stub-casetype-mva', case_type_name: 'Motor Vehicle Accident' }];
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

/** entity -> seed rows. Anything not listed returns []. */
const STUB_TABLES: Record<string, CaseProRow[]> = {
	matters: STUB_MATTERS,
	parties: STUB_PARTIES,
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
};

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
	async query(entity: string, query: CaseProQuery = {}): Promise<CaseProQueryResult> {
		const all = (STUB_TABLES[entity] ?? []).filter((row) => rowMatches(row, query.filter));
		const offset = query.offset ?? 0;
		const limit = query.limit ?? all.length;
		return { data: all.slice(offset, offset + limit), total: all.length };
	}

	async get(entity: string, id: string): Promise<CaseProRow | null> {
		return (STUB_TABLES[entity] ?? []).find((row) => row.id === id) ?? null;
	}

	async listSchema(entity: string): Promise<unknown> {
		const sample = (STUB_TABLES[entity] ?? [])[0] ?? {};
		return { entity, columns: Object.keys(sample), stub: true };
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
