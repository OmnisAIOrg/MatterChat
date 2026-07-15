import type { IMatterSnapshot } from '@rocket.chat/core-typings';

import type { CaseProRow } from './transport';

/**
 * Pure mapping functions: raw CasePro rows -> M1 `IMatterSnapshot`.
 *
 * Nothing here does I/O. The client (client.ts) fetches the rows via the
 * transport, then hands them to these functions. Keeping the math pure makes the
 * stub and the live path produce identical snapshots and makes mapping unit-testable.
 *
 * Two invariants carried from the CasePro discovery docs:
 *   - NEVER `aggregate_data` GROUP BY (broken server-side). Sums here are plain
 *     JS reductions over rows the transport already returned.
 *   - PostgreSQL numeric arrives as a STRING ("125000.00"). Every money read goes
 *     through {@link num} which coerces and treats null/""/garbage as 0.
 */

/** Coerce CasePro numeric-as-string (or number) to a number; null/""/NaN -> 0. */
export function num(value: unknown): number {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') {
			return 0;
		}
		const parsed = Number(trimmed.replace(/[$,]/g, ''));
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

/** Optional number — undefined when the source is null/absent (vs 0 for sums). */
function optionalNum(value: unknown): number | undefined {
	if (value === null || value === undefined || value === '') {
		return undefined;
	}
	const n = num(value);
	return n;
}

/** Coerce a CasePro date string to a Date, or undefined when absent/invalid. */
export function toDate(value: unknown): Date | undefined {
	if (!value || (typeof value !== 'string' && !(value instanceof Date))) {
		return undefined;
	}
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

function str(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const t = value.trim();
		return t === '' ? undefined : t;
	}
	return undefined;
}

/** Narrow an unknown to a plain object (a nested relation row), else undefined. */
function isObj(value: unknown): value is CaseProRow {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A row's `date` field, epoch-ms for sorting (missing/invalid sorts oldest). */
function dateMs(row: CaseProRow): number {
	const d = toDate(row.date);
	return d ? d.getTime() : Number.NEGATIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// Lookup-table resolvers (small org-stable config tables).
// ---------------------------------------------------------------------------

export function resolveCaseTypeName(caseTypeId: unknown, caseTypes: CaseProRow[]): string | undefined {
	const id = str(caseTypeId);
	if (!id) {
		return undefined;
	}
	return str(caseTypes.find((r) => r.id === id)?.case_type_name);
}

export function resolveStage(stageId: unknown, stages: CaseProRow[]): { name?: string; id?: string } {
	const id = str(stageId);
	if (!id) {
		return {};
	}
	return { id, name: str(stages.find((r) => r.id === id)?.matter_stage_name) };
}

export function resolveSubStage(subStageId: unknown, subStages: CaseProRow[]): { name?: string; id?: string } {
	const id = str(subStageId);
	if (!id) {
		return {};
	}
	return { id, name: str(subStages.find((r) => r.id === id)?.sub_stage_name) };
}

export function resolveSettlementTypeName(settlementTypeId: unknown, settlementTypes: CaseProRow[]): string | undefined {
	const id = str(settlementTypeId);
	if (!id) {
		return undefined;
	}
	return str(settlementTypes.find((r) => r.id === id)?.settlement_type_name);
}

/** A party's display name: Individual -> full_name (fallback first+last); Business -> party_name. */
export function partyDisplayName(party?: CaseProRow | null): string | undefined {
	if (!party) {
		return undefined;
	}
	if (party.record_type === 'Business') {
		return str(party.party_name) ?? str(party.full_name);
	}
	const full = str(party.full_name);
	if (full) {
		return full;
	}
	const first = str(party.first_name);
	const last = str(party.last_name);
	const joined = [first, last].filter(Boolean).join(' ').trim();
	return joined === '' ? undefined : joined;
}

// ---------------------------------------------------------------------------
// Money / financial reductions (query-then-sum in JS).
// ---------------------------------------------------------------------------

/** Σ bills.total_amount and Σ bills.amount_due over the matter's (non-deleted) bills. */
export function mapBillTotals(bills: CaseProRow[]): { totalBilled: number; totalBalance: number } {
	const live = bills.filter((b) => !b.deleted_at);
	return {
		totalBilled: live.reduce((acc, b) => acc + num(b.total_amount), 0),
		totalBalance: live.reduce((acc, b) => acc + num(b.amount_due), 0),
	};
}

/**
 * Latest negotiation row whose `type` matches a discriminator, by `date`.
 * Demand matches /demand/i, Offer matches /offer/i (free-text `type` column).
 */
export function latestNegotiation(negotiations: CaseProRow[], discriminator: RegExp): CaseProRow | undefined {
	return negotiations
		.filter((n) => discriminator.test(String(n.type ?? '')))
		.sort((a, b) => dateMs(b) - dateMs(a))[0];
}

/** Latest resolution row by resolution_date (the settlement record). */
export function latestResolution(resolutions: CaseProRow[]): CaseProRow | undefined {
	return [...resolutions].sort((a, b) => {
		const da = toDate(a.resolution_date)?.getTime() ?? Number.NEGATIVE_INFINITY;
		const db = toDate(b.resolution_date)?.getTime() ?? Number.NEGATIVE_INFINITY;
		return db - da;
	})[0];
}

/**
 * Net liens: Σ over REAL liens (amount != null) of (lien.amount − matched reduction).
 * Reductions match by reducible_type='Lien' + reducible_id=lien.id, excluding soft-deleted.
 */
export function mapNetLiens(liens: CaseProRow[], reductions: CaseProRow[]): number {
	const realLiens = liens.filter((l) => l.amount !== null && l.amount !== undefined && l.amount !== '');
	const liveReductions = reductions.filter((r) => !r.deleted_at && String(r.reducible_type) === 'Lien');
	return realLiens.reduce((acc, lien) => {
		const reduced = liveReductions
			.filter((r) => r.reducible_id === lien.id)
			.reduce((sum, r) => sum + num(r.reduction_amount), 0);
		return acc + (num(lien.amount) - reduced);
	}, 0);
}

/** Σ expenses.amount. */
export function mapExpenseTotal(expenses: CaseProRow[]): number {
	return expenses.reduce((acc, e) => acc + num(e.amount), 0);
}

// ---------------------------------------------------------------------------
// Medical providers (treatment section). A `medical_providers` row references a
// Party (its display name + provider_type live on that party — see CasePro
// `parties.party_name` / `parties.provider_type`). CasePro exposes no per-visit
// treatment detail via this surface, so a provider list IS the representation.
// ---------------------------------------------------------------------------

/**
 * Resolve the party carrying a provider's display name/type. The native list
 * route hydrates a nested `party` object; the stub (and any lean row) carries a
 * `party_id`/`provider_party_id` FK resolved via the supplied party map.
 */
function resolveProviderParty(provider: CaseProRow, partyById?: Map<string, CaseProRow>): CaseProRow | undefined {
	const nested = isObj(provider.party) ? provider.party : undefined;
	if (nested) {
		return nested;
	}
	const partyId = str(provider.party_id) ?? str(provider.provider_party_id);
	return partyId ? partyById?.get(partyId) : undefined;
}

/**
 * Build the snapshot's `providers[]` ({ name, type? }) from the matter's
 * `medical_providers` rows. Name is the related party's `party_name` (falling
 * back to the generic party display name, then any name column on the provider
 * row); `type` is the party's `provider_type`. Soft-deleted providers and rows
 * with no resolvable name are skipped.
 */
export function mapProviders(providers: CaseProRow[], partyById?: Map<string, CaseProRow>): { name: string; type?: string }[] {
	const out: { name: string; type?: string }[] = [];
	for (const provider of providers) {
		if (provider.deleted_at) {
			continue;
		}
		const party = resolveProviderParty(provider, partyById);
		const name = str(party?.party_name) ?? partyDisplayName(party) ?? str(provider.provider_name) ?? str(provider.name);
		if (!name) {
			continue;
		}
		const type = str(party?.provider_type) ?? str(provider.provider_type);
		out.push(type ? { name, type } : { name });
	}
	return out;
}

/** projectedNet = settlement − attorney fees − expenses − net liens (undefined w/o a settlement). */
export function computeProjectedNet(
	settlementAmount: number | undefined,
	attorneyFees: number,
	totalExpenses: number,
	netLiens: number,
): number | undefined {
	if (settlementAmount === undefined) {
		return undefined;
	}
	return settlementAmount - attorneyFees - totalExpenses - netLiens;
}

// ---------------------------------------------------------------------------
// Team roles (string user-id soft-FKs on the matter).
// ---------------------------------------------------------------------------

/** Matter team-role columns (users.id strings). roleKey -> human label fallback. */
export const MATTER_TEAM_ROLE_COLUMNS: { column: string; label: string }[] = [
	{ column: 'principal_attorney', label: 'Principal Attorney' },
	{ column: 'attorney', label: 'Attorney' },
	{ column: 'pre_lit_attorney', label: 'Pre-Lit Attorney' },
	{ column: 'supervising_attorney', label: 'Supervising Attorney' },
	{ column: 'associate_attorney', label: 'Associate Attorney' },
	{ column: 'case_manager', label: 'Case Manager' },
	{ column: 'senior_case_manager', label: 'Senior Case Manager' },
	{ column: 'paralegal', label: 'Paralegal' },
	{ column: 'legal_assistant', label: 'Legal Assistant' },
	{ column: 'legal_writer', label: 'Legal Writer' },
	{ column: 'pd_specialist', label: 'PD Specialist' },
	{ column: 'lien_negotiator', label: 'Lien Negotiator' },
	{ column: 'bra_coordinator', label: 'BRA Coordinator' },
	{ column: 'transaction_coordinator', label: 'Transaction Coordinator' },
	{ column: 'intake_specialist', label: 'Intake Specialist' },
	{ column: 'auditor', label: 'Auditor' },
];

/**
 * A CasePro user's display name. CentralizedAuth stores a single `name` column
 * (full display name); fall back to `first_name`+`last_name` (defensive — some
 * user payloads split them) and finally `email` so a resolved user always yields
 * SOMETHING more useful than a raw UUID.
 */
export function userDisplayName(user?: CaseProRow | null): string | undefined {
	if (!user) {
		return undefined;
	}
	const name = str(user.name);
	if (name) {
		return name;
	}
	const joined = [str(user.first_name), str(user.last_name)].filter(Boolean).join(' ').trim();
	if (joined) {
		return joined;
	}
	return str(user.email);
}

/** Build the `users.id -> display name` resolver map from fetched user rows. */
export function buildUserNameMap(users: CaseProRow[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const user of users) {
		const id = str(user.id);
		const name = userDisplayName(user);
		if (id && name) {
			map.set(id, name);
		}
	}
	return map;
}

/**
 * Build the M1 snapshot's `team[]` ({ role, name }). The raw value is a CasePro
 * `users.id` string. A name-resolver map (built by {@link buildUserNameMap} from
 * the `users` transport entity) upgrades ids -> display names; when a user can't
 * be resolved (map absent, or the users endpoint unavailable) `name` falls back
 * to the raw id so the UI still renders.
 */
export function mapTeam(matter: CaseProRow, nameById?: Map<string, string>): { role: string; name: string }[] {
	const out: { role: string; name: string }[] = [];
	for (const { column, label } of MATTER_TEAM_ROLE_COLUMNS) {
		const raw = str(matter[column]);
		if (!raw) {
			continue;
		}
		out.push({ role: label, name: nameById?.get(raw) ?? raw });
	}
	return out;
}

// ---------------------------------------------------------------------------
// The bundle a transport hands the mapper.
// ---------------------------------------------------------------------------

/** Everything the mapper needs to assemble one snapshot. Pure data — no I/O. */
export type MatterRowBundle = {
	matter: CaseProRow;
	caseTypes: CaseProRow[];
	matterStages: CaseProRow[];
	matterSubStages: CaseProRow[];
	settlementTypes: CaseProRow[];
	clientParty?: CaseProRow | null;
	providerCount: number;
	/** raw medical_providers rows for the matter (drives `providers[]`). */
	providers?: CaseProRow[];
	/** party_id -> party row, resolving provider display names when not hydrated inline. */
	providerPartyById?: Map<string, CaseProRow>;
	bills: CaseProRow[];
	negotiations: CaseProRow[];
	resolutions: CaseProRow[];
	liens: CaseProRow[];
	reductions: CaseProRow[];
	expenses: CaseProRow[];
	/** optional users.id -> display name resolver for team roles. */
	teamNameById?: Map<string, string>;
};

/**
 * Assemble an `IMatterSnapshot` from raw rows. This is the single mapping entry
 * point used by the client. `projectedNet` is computed but `IMatterSnapshot` has
 * no field for it in M1 — it is folded into the team/financial reads the panel
 * needs; callers that want it can use {@link computeProjectedNet} directly.
 */
export function mapMatterSnapshot(bundle: MatterRowBundle): IMatterSnapshot {
	const { matter } = bundle;
	const matterId = str(matter.id) ?? '';

	const stage = resolveStage(matter.stage_id, bundle.matterStages);
	const subStage = resolveSubStage(matter.sub_stage, bundle.matterSubStages);

	const { totalBilled, totalBalance } = mapBillTotals(bundle.bills);

	const demand = latestNegotiation(bundle.negotiations, /demand/i);
	const offer = latestNegotiation(bundle.negotiations, /offer/i);
	const resolution = latestResolution(bundle.resolutions);

	return {
		matterId,
		matterName: str(matter.matter_name),
		matterNumber: str(matter.matter_number),
		causeNumber: str(matter.cause_number),
		clientName: partyDisplayName(bundle.clientParty),
		practiceArea: resolveCaseTypeName(matter.case_type, bundle.caseTypes),
		stageId: stage.id,
		stageName: stage.name,
		subStageId: subStage.id,
		subStageName: subStage.name,
		incidentDate: toDate(matter.incident_date),
		incidentDescription: str(matter.description),
		solDate: toDate(matter.statute_of_limitations),
		liabilityStatus: str(matter.liability_status),
		providerCount: bundle.providerCount,
		providers: mapProviders(bundle.providers ?? [], bundle.providerPartyById),
		totalBilled,
		totalBalance,
		expensesTotal: mapExpenseTotal(bundle.expenses),
		lastDemandAmount: optionalNum(demand?.amount),
		lastOfferAmount: optionalNum(offer?.amount),
		demandExpiration: toDate(demand?.expiration_date),
		settlementAmount: optionalNum(resolution?.settlement_amount),
		litboxWorkspaceId: str(matter.litbox_workspace_id),
		medchronMatterId: str(matter.medchron_matter_id),
		team: mapTeam(matter, bundle.teamNameById),
		fetchedAt: new Date(),
		stale: false,
		resolved: true, // a real CasePro read (vs the pending placeholder a graceful bind writes)
	};
}

/** Thin list item for board columns (id, name, number, stage, client). */
export type MatterListItem = {
	matterId: string;
	matterName?: string;
	matterNumber?: string;
	stageId?: string;
	stageName?: string;
	clientId?: string;
};

export function mapMatterListItem(matter: CaseProRow, matterStages: CaseProRow[]): MatterListItem {
	const stage = resolveStage(matter.stage_id, matterStages);
	return {
		matterId: str(matter.id) ?? '',
		matterName: str(matter.matter_name),
		matterNumber: str(matter.matter_number),
		stageId: stage.id,
		stageName: stage.name,
		clientId: str(matter.client_id),
	};
}

// ---------------------------------------------------------------------------
// Litigation scheduling-order docket dates (M5 — mirror into board deadlines).
// ---------------------------------------------------------------------------

/**
 * One litigation scheduling-order date, normalized for the board's deadline engine.
 * `kind` maps onto `BoardDeadlineKind` (filing | discovery | mediation); `column` is
 * the source CasePro `litigations` column for auditability; `label` is the UI label.
 */
export type LitigationDocketDate = {
	kind: 'filing' | 'discovery' | 'mediation';
	column: string;
	label: string;
	date: Date;
};

/**
 * The `litigations` scheduling-order date columns we mirror into board deadlines, with
 * their target deadline kind + label. Real schema (CasePro `litigations`, 39 cols — see
 * omnis-boards-build/casepro/04-litigation-workflow-custom.md): all are `date` nullable.
 * We mirror the load-bearing docket deadlines; `trial_date` is the anchor but has no
 * dedicated BoardDeadlineKind, so it maps to 'filing' (a hard court date) like the
 * pleadings/dispositive-motion deadlines.
 */
const LITIGATION_DATE_COLUMNS: { column: string; kind: LitigationDocketDate['kind']; label: string }[] = [
	{ column: 'discovery', kind: 'discovery', label: 'Discovery deadline' },
	{ column: 'mediation_date', kind: 'mediation', label: 'Mediation' },
	{ column: 'pleadings', kind: 'filing', label: 'Pleadings deadline' },
	{ column: 'dispositive_motion', kind: 'filing', label: 'Dispositive motion deadline' },
	{ column: 'no_evidence_msj', kind: 'filing', label: 'No-evidence MSJ deadline' },
	{ column: 'docket_call', kind: 'filing', label: 'Docket call' },
	{ column: 'trial_date', kind: 'filing', label: 'Trial date' },
];

/**
 * Map a `litigations` row to its non-null scheduling-order docket dates. Pure: the
 * client fetches the rows, this normalizes them. Skips null/blank/invalid dates so a
 * sparsely-filled scheduling order yields only the deadlines that are actually set.
 */
export function mapLitigationDates(litigation: CaseProRow): LitigationDocketDate[] {
	const out: LitigationDocketDate[] = [];
	for (const { column, kind, label } of LITIGATION_DATE_COLUMNS) {
		const date = toDate(litigation[column]);
		if (date) {
			out.push({ kind, column, label, date });
		}
	}
	return out;
}

/** A board column descriptor from a matter_stages row. */
export type StageDescriptor = { stageId: string; name: string; orderIndex: number };

export function mapStage(row: CaseProRow): StageDescriptor {
	return {
		stageId: str(row.id) ?? '',
		name: str(row.matter_stage_name) ?? '',
		orderIndex: num(row.order_index),
	};
}
