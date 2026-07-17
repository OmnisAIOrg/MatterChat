import type { IMatterSnapshot } from '@rocket.chat/core-typings';

/**
 * The CasePro client contract this phase (M3a — Matters server) codes against.
 *
 * The concrete client is built in PARALLEL (subsystem 04) and lives at
 * `apps/meteor/server/lib/boards/casepro/client`. We import the runtime value from
 * `../casepro/client` (see `caseProClient.ts`) but type it against THIS interface so
 * the matters package self-typechecks independently of the parallel phase landing.
 *
 * Method names are fixed by the integrator contract: `matterSnapshot(matterId)`,
 * `listMatters(opts)`, `listStages()`.
 */

/**
 * One CasePro matter_stages row, as returned by `listStages()`.
 *
 * Shape mirrors subsystem 04's `StageDescriptor` ({ stageId, name, orderIndex }).
 * `id` is accepted as a tolerated alias so the matters service binds regardless of
 * which key the concrete client emits; `getStageId()` normalizes the two.
 */
export interface CaseProStage {
	/** matter_stages.id (uuid) — written onto the board list as `caseproStageId`. */
	stageId?: string;
	/** tolerated alias for `stageId`. */
	id?: string;
	/** matter_stages.matter_stage_name — used to match the canonical seed table by name. */
	name: string;
	/** matter_stages.order_index — column ordering. */
	orderIndex: number;
}

/** Normalize the stage id across the `stageId` / `id` shapes. */
export const getStageId = (stage: CaseProStage): string | undefined => stage.stageId ?? stage.id;

/** A thin matter list item, as returned by `listMatters()`. */
export interface CaseProMatterListItem {
	/** matters.id (uuid) — the card link's matterId / join key. */
	matterId: string;
	matterName?: string;
	matterNumber?: string;
	/** matters.stage_id → matter_stages.id. Used to place the card on the right list. */
	stageId?: string;
	stageName?: string;
	clientName?: string;
	practiceArea?: string;
}

/** Options accepted by `listMatters()`. */
export interface CaseProListMattersOpts {
	stageId?: string;
	caseTypeId?: string;
	query?: string;
	limit?: number;
	offset?: number;
}

export interface CaseProListMattersResult {
	matters: CaseProMatterListItem[];
	total: number;
}

/**
 * One litigation scheduling-order docket date, normalized for the board deadline engine
 * (M5 — litigation docket-date mirror). Shape mirrors subsystem 04's
 * `LitigationDocketDate`; `kind` is a `BoardDeadlineKind` subset (filing|discovery|
 * mediation), `column` is the source CasePro `litigations` column for auditability.
 */
export interface CaseProLitigationDate {
	kind: 'filing' | 'discovery' | 'mediation';
	column: string;
	label: string;
	date: Date;
}

/**
 * The surface this phase consumes. `matterSnapshot` returns the M1 `IMatterSnapshot`
 * (the exact shape `BoardsCards.refreshMatterSnapshot` writes onto a matter-linked card),
 * or `null` when the matter can't be read/found — matching the concrete client
 * (`casepro/client.ts`). Consumers (crossPipeline.ts, boards-ai.ts) already null-narrow.
 */
export interface ICaseProClient {
	matterSnapshot(matterId: string): Promise<IMatterSnapshot | null>;
	listMatters(opts?: CaseProListMattersOpts): Promise<CaseProListMattersResult>;
	/** Every non-archived matter, fully paged — bulk consumers (seedFromCasePro) use this. */
	listAllMatters(opts?: Pick<CaseProListMattersOpts, 'stageId' | 'caseTypeId'>): Promise<CaseProListMattersResult>;
	listStages(): Promise<CaseProStage[]>;
	/** Litigation scheduling-order docket dates for a matter (M5 mirror). [] if no suit. */
	listLitigationDates(matterId: string): Promise<CaseProLitigationDate[]>;
}
