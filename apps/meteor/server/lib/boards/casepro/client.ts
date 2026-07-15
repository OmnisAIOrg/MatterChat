import type { IMatterSnapshot } from '@rocket.chat/core-typings';

import {
	mapMatterSnapshot,
	mapMatterListItem,
	mapStage,
	mapLitigationDates,
	buildUserNameMap,
	MATTER_TEAM_ROLE_COLUMNS,
	type MatterListItem,
	type MatterRowBundle,
	type StageDescriptor,
	type LitigationDocketDate,
} from './mapping';
import {
	mapIntakeLead,
	mapIntakeStage,
	buildPartyRowFromCapture,
	buildIntakeRowFromCapture,
	buildIntakePatch,
	buildMatterRowFromIntake,
	type IntakeLead,
	type IntakeStageDescriptor,
	type IntakeCaptureInput,
	type IntakePatchInput,
} from './mapping-intake';
import { resolveTransportFromConfig, type ICaseProTransport, type CaseProRow, type CaseProCallContext } from './transport';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const asObj = (v: unknown): CaseProRow | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as CaseProRow) : undefined);
const onlyStrings = (rows: CaseProRow[], key = 'id'): string[] =>
	rows.map((r) => str(r[key])).filter((id): id is string => Boolean(id));

export type ListMattersOpts = { stageId?: string; caseTypeId?: string; query?: string; limit?: number; offset?: number };
export type ListMattersResult = { matters: MatterListItem[]; total: number };

export type ListIntakesOpts = { stageId?: string; caseTypeId?: string; limit?: number; offset?: number };
export type ListIntakesResult = { intakes: IntakeLead[]; total: number };

/** Conversion result: the new CasePro matter id + the (now matter-linked) intake. */
export type ConvertIntakeResult = { matterId: string; intake: IntakeLead };

/**
 * The single outbound CasePro read client (M2). All Matters reads go through here;
 * the transport (stub | native | mcp) is config-selected. Sums are computed in JS —
 * CasePro's aggregate_data GROUP BY is broken (see casepro discovery docs).
 */
export class CaseProClient {
	private transport: ICaseProTransport | undefined;

	/**
	 * Resolved per access so the `caseProMode()` enablement gate and admin setting
	 * changes take effect immediately: disabled → every read serves the stub (demo
	 * mode) and client "writes" only touch the stub's in-memory store — no
	 * upstream effect. `resolveTransportFromConfig` memoizes on the config
	 * fingerprint, so this is cheap and the stub store survives across calls.
	 */
	private get tx(): ICaseProTransport {
		return this.transport ?? resolveTransportFromConfig();
	}

	/** Override the transport (tests / runtime swap); pass undefined to revert to config. */
	setTransport(transport?: ICaseProTransport): void {
		this.transport = transport;
	}

	/**
	 * Comms-log: file a batch of channel messages onto a matter's communication
	 * history (CasePro `POST /matterchat-messages/ingest`, idempotent per message
	 * id upstream). `ingestPath` may be absolute when the CRM backend lives on a
	 * different host than the MCP connector base URL.
	 */
	async logMatterChannelMessages(ingestPath: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.tx.ingest(ingestPath, payload);
	}

	/** Page an entity fully (CasePro caps page size; we accumulate then reduce in JS). */
	private async queryAll(entity: string, filter?: Record<string, unknown>): Promise<CaseProRow[]> {
		const out: CaseProRow[] = [];
		const limit = 200;
		let offset = 0;
		for (let page = 0; page < 50; page++) {
			const { data, total } = await this.tx.query(entity, { filter, limit, offset });
			out.push(...data);
			offset += data.length;
			if (data.length === 0 || out.length >= total) {
				break;
			}
		}
		return out;
	}

	async matterSnapshot(matterId: string): Promise<IMatterSnapshot | null> {
		const matter = await this.tx.get('matters', matterId);
		if (!matter) {
			return null;
		}

		const [caseTypes, matterStages, matterSubStages, settlementTypes] = await Promise.all([
			this.queryAll('case_types'),
			this.queryAll('matter_stages'),
			this.queryAll('matter_sub_stages'),
			this.queryAll('settlement_types'),
		]);

		const clientId = str(matter.client_id);
		const clientParty = clientId ? await this.tx.get('parties', clientId) : null;

		// bills have no matter_id — reach them via medical_providers.matter_id -> bills.medical_provider_id
		const providers = await this.queryAll('medical_providers', { matter_id: matterId });
		const providerIds = onlyStrings(providers);
		const bills = providerIds.length ? await this.queryAll('bills', { medical_provider_id: { $in: providerIds } }) : [];

		const [negotiations, resolutions, liens, expenses] = await Promise.all([
			this.queryAll('negotiations', { matter_id: matterId }),
			this.queryAll('resolutions', { matter_id: matterId }),
			this.queryAll('liens', { matter_id: matterId }),
			this.queryAll('expenses', { matter_id: matterId }),
		]);

		// reductions are polymorphic — only the Lien ones net against liens
		const lienIds = onlyStrings(liens);
		const reductions = lienIds.length
			? await this.queryAll('reductions', { reducible_type: 'Lien', reducible_id: { $in: lienIds } })
			: [];

		// Resolve provider display names (via each provider's party) and team-role
		// user ids (via the users entity). Both DEGRADE to raw values on failure so
		// a snapshot never hard-fails on the enrichment reads.
		const [providerPartyById, teamNameById] = await Promise.all([
			this.resolveProviderParties(providers),
			this.resolveTeamNames(matter),
		]);

		const bundle: MatterRowBundle = {
			matter,
			caseTypes,
			matterStages,
			matterSubStages,
			settlementTypes,
			clientParty,
			providerCount: providers.length,
			providers,
			providerPartyById,
			bills,
			negotiations,
			resolutions,
			liens,
			reductions,
			expenses,
			teamNameById,
		};

		return mapMatterSnapshot(bundle);
	}

	/**
	 * Resolve the party (name + provider_type) behind each `medical_providers`
	 * row. Native list rows hydrate a nested `party`; leaner rows (and the stub)
	 * carry a `party_id`/`provider_party_id` fetched here. Missing/404 parties are
	 * simply omitted — `mapProviders` falls back to any inline name.
	 */
	private async resolveProviderParties(providers: CaseProRow[]): Promise<Map<string, CaseProRow>> {
		const map = new Map<string, CaseProRow>();
		const toFetch = new Set<string>();
		for (const provider of providers) {
			const nested = asObj(provider.party);
			const partyId = str(nested?.id) ?? str(provider.party_id) ?? str(provider.provider_party_id);
			if (!partyId) {
				continue;
			}
			if (nested) {
				map.set(partyId, nested);
			} else if (!map.has(partyId)) {
				toFetch.add(partyId);
			}
		}
		const ids = [...toFetch];
		const fetched = await Promise.all(ids.map((id) => this.tx.get('parties', id)));
		ids.forEach((id, i) => {
			const party = fetched[i];
			if (party) {
				map.set(id, party);
			}
		});
		return map;
	}

	/**
	 * Resolve the matter's team-role user-id UUIDs (see MATTER_TEAM_ROLE_COLUMNS)
	 * to display names via the `users` transport entity. Returns undefined when
	 * there are no team ids OR the users endpoint is unavailable (e.g. the CRM's
	 * users route is session-guarded and rejects service auth) — `mapTeam` then
	 * falls back to the raw ids. Never throws.
	 */
	private async resolveTeamNames(matter: CaseProRow): Promise<Map<string, string> | undefined> {
		const ids = new Set<string>();
		for (const { column } of MATTER_TEAM_ROLE_COLUMNS) {
			const raw = str(matter[column]);
			if (raw) {
				ids.add(raw);
			}
		}
		if (ids.size === 0) {
			return undefined;
		}
		try {
			const users = await Promise.all([...ids].map((id) => this.tx.get('users', id)));
			const map = buildUserNameMap(users.filter((u): u is CaseProRow => Boolean(u)));
			return map.size ? map : undefined;
		} catch {
			return undefined;
		}
	}

	async listMatters(opts: ListMattersOpts = {}): Promise<ListMattersResult> {
		const filter: Record<string, unknown> = { archived: false };
		if (opts.stageId) {
			filter.stage_id = opts.stageId;
		}
		if (opts.caseTypeId) {
			filter.case_type = opts.caseTypeId;
		}
		const { data, total } = await this.tx.query('matters', {
			filter,
			limit: opts.limit ?? 50,
			offset: opts.offset ?? 0,
		});
		const matterStages = await this.queryAll('matter_stages');
		return { matters: data.map((m) => mapMatterListItem(m, matterStages)), total };
	}

	async listStages(): Promise<StageDescriptor[]> {
		const rows = await this.queryAll('matter_stages');
		return rows
			.map(mapStage)
			.filter((s) => Boolean(s.stageId))
			.sort((a, b) => a.orderIndex - b.orderIndex);
	}

	async providerCount(matterId: string): Promise<number> {
		const { total } = await this.tx.query('medical_providers', { filter: { matter_id: matterId }, limit: 1 });
		return total;
	}

	/**
	 * Read the matter's litigation scheduling-order docket dates (M5 — mirror into board
	 * deadlines on entering a litigation stage). A matter has at most a handful of
	 * `litigations` rows (typically one, created when the case enters suit); we read all
	 * of them and flatten the non-null scheduling-order dates. The `status` soft-delete
	 * column is filtered to active (the discovery-doc rule: every entity carries an
	 * active|inactive `status`). Returns [] when the matter has no litigation row.
	 */
	async listLitigationDates(matterId: string): Promise<LitigationDocketDate[]> {
		const rows = await this.queryAll('litigations', { matter_id: matterId });
		const out: LitigationDocketDate[] = [];
		for (const row of rows) {
			if (row.status === 'inactive' || row.deleted_at) {
				continue;
			}
			out.push(...mapLitigationDates(row));
		}
		return out;
	}

	// -------------------------------------------------------------------------
	// Leads / Intake pillar (M3) — read-through + write-through against
	// `intake_questionnaires`. CasePro is the system of record; the leads board
	// is a synced working view. ALL CasePro intake writes go through here.
	// -------------------------------------------------------------------------

	/** Build the lead-shaped projection for one intake row (resolves party + lookups). */
	private async mapIntake(intake: CaseProRow, lookups?: { intakeStages: CaseProRow[]; caseTypes: CaseProRow[] }): Promise<IntakeLead> {
		const { intakeStages, caseTypes } = lookups ?? {
			intakeStages: await this.queryAll('intake_stages'),
			caseTypes: await this.queryAll('case_types'),
		};
		const partyId = str(intake.party_id);
		const party = partyId ? await this.tx.get('parties', partyId) : null;
		return mapIntakeLead({ intake, intakeStages, caseTypes, party });
	}

	/** Page `intake_questionnaires` (optionally by stage / practice area) -> lead-shaped rows. */
	async listIntakes(opts: ListIntakesOpts = {}): Promise<ListIntakesResult> {
		const filter: Record<string, unknown> = {};
		if (opts.stageId) {
			filter.intake_stage_id = opts.stageId;
		}
		if (opts.caseTypeId) {
			filter.case_type_id = opts.caseTypeId;
		}
		const { data, total } = await this.tx.query('intake_questionnaires', {
			filter,
			limit: opts.limit ?? 50,
			offset: opts.offset ?? 0,
		});
		const [intakeStages, caseTypes] = await Promise.all([this.queryAll('intake_stages'), this.queryAll('case_types')]);
		const intakes = await Promise.all(data.map((row) => this.mapIntake(row, { intakeStages, caseTypes })));
		return { intakes, total };
	}

	/** Fetch one intake by `intake_questionnaires.id` -> lead-shaped row (or null). */
	async getIntake(intakeId: string): Promise<IntakeLead | null> {
		const intake = await this.tx.get('intake_questionnaires', intakeId);
		if (!intake) {
			return null;
		}
		return this.mapIntake(intake);
	}

	/** The 8 intake pipeline stages (= Leads board columns), sorted by order_index. */
	async listIntakeStages(): Promise<IntakeStageDescriptor[]> {
		const rows = await this.queryAll('intake_stages');
		return rows
			.map(mapIntakeStage)
			.filter((s) => Boolean(s.stageId))
			.sort((a, b) => a.orderIndex - b.orderIndex);
	}

	/**
	 * Capture: match-or-create a party (when no `partyId` supplied) then create the
	 * `intake_questionnaires` row. Write-through — returns the created intake lead.
	 * `ctx.actingUserId` (the MatterChat user driving the write) rides along as the
	 * transport's advisory writer-identity header.
	 */
	async createIntake(input: IntakeCaptureInput, ctx?: CaseProCallContext): Promise<IntakeLead> {
		let partyId = str(input.partyId);
		if (!partyId) {
			const created = await this.tx.create('parties', buildPartyRowFromCapture(input), ctx);
			partyId = str(created.id);
			if (!partyId) {
				throw new Error('CasePro createIntake: party create returned no id');
			}
		}
		// CasePro REQUIRES template_id on intake create ("An intake template is
		// required…", surfaced as an opaque 500; only MEDICAL orgs get a server-side
		// get-or-create fallback). Manual captures don't carry one, so fall back to
		// the org's first intake form template (the transport caches the lookup).
		const templateId = str(input.templateId) ?? (await this.defaultIntakeTemplateId());
		const intake = await this.tx.create('intake_questionnaires', buildIntakeRowFromCapture({ ...input, templateId }, partyId), ctx);
		return this.mapIntake(intake);
	}

	/** First intake form template id of the org, or a CLEAR error (the upstream
	 * failure mode is an unexplained 500 wrapping the template requirement). */
	private async defaultIntakeTemplateId(): Promise<string> {
		const { data } = await this.tx.query('intake_form_templates', { limit: 1 });
		const id = str(data[0]?.id);
		if (!id) {
			throw new Error(
				'CasePro createIntake: the organization has no intake form templates — create one in CasePro or pass templateId in the capture input',
			);
		}
		return id;
	}

	/** Drag a card -> write `intake_stage_id` (write-through). Returns the updated lead. */
	async updateIntakeStage(intakeId: string, intakeStageId: string, ctx?: CaseProCallContext): Promise<IntakeLead> {
		const intake = await this.tx.update('intake_questionnaires', intakeId, { intake_stage_id: intakeStageId }, ctx);
		return this.mapIntake(intake);
	}

	/** Qualify / edit: patch intake_status / form_data / case_type / stage / etc. */
	async updateIntake(intakeId: string, patch: IntakePatchInput, ctx?: CaseProCallContext): Promise<IntakeLead> {
		const intake = await this.tx.update('intake_questionnaires', intakeId, buildIntakePatch(patch), ctx);
		return this.mapIntake(intake);
	}

	/**
	 * Convert (POA Received): create a `matters` row from the intake + caller extras,
	 * then set `intake_questionnaires.matter_id`. Returns the new matter id + the
	 * now matter-linked intake. ALL writes go through the one transport.
	 */
	async createMatterFromIntake(intakeId: string, extra: CaseProRow = {}, ctx?: CaseProCallContext): Promise<ConvertIntakeResult> {
		const intakeRow = await this.tx.get('intake_questionnaires', intakeId);
		if (!intakeRow) {
			throw new Error(`CasePro createMatterFromIntake: intake ${intakeId} not found`);
		}
		const matter = await this.tx.create('matters', buildMatterRowFromIntake(intakeRow, extra), ctx);
		const matterId = str(matter.id);
		if (!matterId) {
			throw new Error('CasePro createMatterFromIntake: matter create returned no id');
		}
		const updated = await this.tx.update('intake_questionnaires', intakeId, { matter_id: matterId }, ctx);
		const intake = await this.mapIntake(updated);
		return { matterId, intake };
	}

	// -------------------------------------------------------------------------
	// Matters write-back (automation `caseproWriteback` execution path). Thin
	// pass-throughs onto the ONE transport — same verbs the intake write-through
	// uses; auth/transport wiring stays inside transport.ts (owned elsewhere).
	// -------------------------------------------------------------------------

	/** Patch a `matters` row (advanceStage → { stage_id }, updateField → { [col]: value }). */
	async updateMatter(matterId: string, patch: CaseProRow): Promise<CaseProRow> {
		return this.tx.update('matters', matterId, patch);
	}

	// -------------------------------------------------------------------------
	// Tasks (card → CasePro task PUSH sync). Correlation contract with
	// Crm-Backend: tasks.external_ref (varchar(128), indexed) carries the board
	// card `_id`; tasks.source is stamped 'MatterChat'. CasePro's task field for
	// the card title is `subject` (NOT `title`). Push-only — CasePro emits no
	// task events, so there is no pull direction.
	// -------------------------------------------------------------------------

	/** Look up the CasePro task correlated to an external ref (board card _id), or null. */
	async findTaskByExternalRef(externalRef: string): Promise<CaseProRow | null> {
		const { data } = await this.tx.query('tasks', { filter: { external_ref: externalRef }, limit: 1 });
		return data[0] ?? null;
	}

	/** Create a `tasks` row (caller stamps source/external_ref/subject). Returns the row with its id. */
	async createTask(row: CaseProRow): Promise<CaseProRow> {
		return this.tx.create('tasks', row);
	}

	/** Patch a `tasks` row by CasePro task id. */
	async updateTask(taskId: string, patch: CaseProRow): Promise<CaseProRow> {
		return this.tx.update('tasks', taskId, patch);
	}
}

export const caseProClient = new CaseProClient();
