import type { IBoardList, ILead, ILeadQualification } from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsLeads, BoardsActivities } from '@rocket.chat/models';

import { caseProClient, caseProMode } from '../casepro';
import type { IntakeCaptureInput, IntakeLead, IntakePatchInput } from '../casepro';
import { nextLeadRefNo } from './refNo';
import { ensureLeadsBoard, INTAKE_STAGE_NAMES } from './service';

/**
 * CasePro Leads/Intake sync service (M3).
 *
 * CasePro is the SYSTEM OF RECORD for intake (`intake_questionnaires`); the
 * MatterChat leads board is a synced WORKING VIEW — a read-through cache +
 * match-or-create write-through. A board lead card maps 1:1 to an intake row via
 * `boards_leads.caseproIntakeId`.
 *
 *   - {@link pullFromCasePro} — read-through: pull every intake, match-or-create a
 *     `boards_leads` + lead card per intake, refresh cached fields.
 *   - {@link pushStage} — drag a card / move a lead → write `intake_stage_id`.
 *   - {@link pushCreate} — capture → create party + `intake_questionnaires`, then
 *     stamp `caseproIntakeId`/`caseproIntakeNumber` back onto the lead.
 *   - {@link pushQualify} — qualify → write `intake_status` / `form_data`.
 *
 * ALL CasePro writes go through `caseProClient` (the one client). Every push fn is
 * a NO-OP (logged via the activity feed actor, silent otherwise) when
 * `CasePro_Enabled` is false — so the board works fully standalone/offline.
 */

// ---------------------------------------------------------------------------
// Enablement gate
// ---------------------------------------------------------------------------

/**
 * THE one enablement gate, shared with the read side (design §4): this simply
 * mirrors `caseProMode().enabled` so reads and writes can never disagree again
 * (the old footgun: reads ignored `CasePro_Enabled` while writes gated on it).
 * Disabled → every push below no-ops AND `caseProClient` reads serve the stub.
 */
export function isCaseProEnabled(): boolean {
	return caseProMode().enabled;
}

// ---------------------------------------------------------------------------
// Board-column <-> intake-stage resolution
// ---------------------------------------------------------------------------

/**
 * Find the leads board list (column) that maps to a CasePro intake stage. Match
 * order, most-precise first:
 *   1. `list.caseproStageId` === the intake stage id (the durable binding),
 *   2. column title === the intake stage NAME (offline/first-pull seam: leads
 *      columns are seeded from the same 8 real stage names).
 * Returns undefined when no column matches (caller falls back to the entry column).
 */
function resolveListForIntakeStage(
	lists: IBoardList[],
	intake: Pick<IntakeLead, 'stageId' | 'stageName'>,
): IBoardList | undefined {
	if (intake.stageId) {
		const byId = lists.find((l) => l.caseproStageId === intake.stageId);
		if (byId) {
			return byId;
		}
	}
	if (intake.stageName) {
		const byName = lists.find((l) => l.title === intake.stageName);
		if (byName) {
			return byName;
		}
	}
	return undefined;
}

/** The entry column ("New Lead / Initial Contact"), or the first list if unseeded. */
function entryList(lists: IBoardList[]): IBoardList | undefined {
	return lists.find((l) => l.title === INTAKE_STAGE_NAMES[0]) ?? lists[0];
}

/**
 * Once a leads column is matched to an intake stage by NAME on a pull, stamp the
 * real CasePro `intake_stages.id` onto the column so future pulls/pushes bind by
 * id (the precise seam). Idempotent — only writes when the id is new/changed.
 */
async function bindListStageId(list: IBoardList, intakeStageId?: string): Promise<void> {
	if (intakeStageId && list.caseproStageId !== intakeStageId) {
		await BoardsLists.updateOne({ _id: list._id }, { $set: { caseproStageId: intakeStageId }, $inc: { rev: 1 } });
		list.caseproStageId = intakeStageId;
	}
}

// ---------------------------------------------------------------------------
// Cached-field projection (intake lead -> boards_leads fields)
// ---------------------------------------------------------------------------

/** The CasePro-owned fields we cache on `boards_leads` from an intake row. */
function cachedLeadFields(intake: IntakeLead): Partial<ILead> {
	const contact: ILead['contact'] = {
		...(intake.clientName ? { fullName: intake.clientName } : {}),
	};
	return {
		caseproIntakeId: intake.caseproIntakeId,
		...(intake.caseproIntakeNumber ? { caseproIntakeNumber: intake.caseproIntakeNumber } : {}),
		...(intake.caseTypeId ? { caseTypeId: intake.caseTypeId } : {}),
		...(intake.practiceArea ? { practiceArea: intake.practiceArea } : {}),
		...(intake.clientName ? { contact } : {}),
		...(intake.matterId ? { convertedMatterId: intake.matterId } : {}),
	};
}

// ---------------------------------------------------------------------------
// pullFromCasePro — read-through cache refresh
// ---------------------------------------------------------------------------

export type PullFromCaseProResult = {
	/** total intakes returned by CasePro. */
	total: number;
	/** new `boards_leads` created on this pull. */
	created: number;
	/** existing `boards_leads` whose cache/column was refreshed. */
	updated: number;
	/** intakes skipped (no usable id, or a write error swallowed to keep the pull going). */
	skipped: number;
	boardId: string;
};

/**
 * Read-through pull: ensure the leads board, list every CasePro intake, and for
 * each one match-or-create a `boards_leads` + its lead card on the column whose
 * `caseproStageId`/name matches the intake's stage, refreshing cached fields.
 *
 * Match key is `caseproIntakeId` (1:1). On create we mint a fresh lead+card on the
 * resolved column; on match we refresh cached fields and re-home the card if the
 * upstream stage moved. NO-OP guard lives in the caller (sync method) — this fn
 * is the engine and always runs when invoked.
 */
export async function pullFromCasePro(uid: string): Promise<PullFromCaseProResult> {
	const { board } = await ensureLeadsBoard(uid);
	const lists = await BoardsLists.findByBoard(board._id).toArray();

	const { intakes, total } = await caseProClient.listIntakes({ limit: 500 });

	let created = 0;
	let updated = 0;
	let skipped = 0;

	for (const intake of intakes) {
		if (!intake.caseproIntakeId) {
			skipped += 1;
			continue;
		}
		try {
			const targetList = resolveListForIntakeStage(lists, intake) ?? entryList(lists);
			if (!targetList) {
				skipped += 1;
				continue;
			}
			// once matched by name, bind the real stage id onto the column for next time.
			await bindListStageId(targetList, intake.stageId);

			const existing = await BoardsLeads.findOneByCaseproIntakeId(intake.caseproIntakeId);
			if (existing) {
				await refreshExistingLead(uid, board._id, existing, intake, targetList);
				updated += 1;
			} else {
				await createLeadFromIntake(uid, board._id, intake, targetList);
				created += 1;
			}
		} catch {
			// never let one bad intake abort the whole pull.
			skipped += 1;
		}
	}

	await BoardsActivities.log({
		boardId: board._id,
		actor: uid,
		verb: 'casepro.snapshot.refreshed',
		to: { syncedFromCasePro: true, total, created, updated, skipped },
		ts: new Date(),
	});

	return { total, created, updated, skipped, boardId: board._id };
}

/** Create a `boards_leads` + lead card from a pulled intake row (no upstream write). */
async function createLeadFromIntake(uid: string, boardId: string, intake: IntakeLead, list: IBoardList): Promise<void> {
	const now = new Date();
	const refNo = await nextLeadRefNo();

	const cached = cachedLeadFields(intake);
	const leadDoc: Omit<ILead, '_id' | '_updatedAt'> = {
		refNo,
		boardId,
		statusId: list._id,
		contact: cached.contact ?? {},
		...(cached.caseproIntakeId ? { caseproIntakeId: cached.caseproIntakeId } : {}),
		...(cached.caseproIntakeNumber ? { caseproIntakeNumber: cached.caseproIntakeNumber } : {}),
		...(cached.caseTypeId ? { caseTypeId: cached.caseTypeId } : {}),
		...(cached.practiceArea ? { practiceArea: cached.practiceArea } : {}),
		...(cached.convertedMatterId ? { convertedMatterId: cached.convertedMatterId } : {}),
		capturedAt: now,
		capturedChannel: 'api',
		capturedByUserId: uid,
		lastActivityAt: now,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId: leadId } = await BoardsLeads.insertOne(leadDoc);

	const title = intake.clientName || `Lead ${intake.caseproIntakeNumber ?? `#${refNo}`}`;
	const position = (await BoardsCards.maxPosition(list._id)) + 1024;
	const cardNumber = await Boards.nextCardNumber(boardId);

	const { insertedId: cardId } = await BoardsCards.insertOne({
		boardId,
		listId: list._id,
		title,
		position,
		cardType: 'lead',
		link: { kind: 'lead', leadId },
		labels: [],
		assignees: [],
		watchers: [],
		fieldValues: {},
		checklists: [],
		attachments: [],
		comments: [],
		cardNumber,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	});

	await BoardsLeads.updateOne({ _id: leadId }, { $set: { cardId }, $inc: { rev: 1 } });

	await BoardsActivities.log({
		boardId,
		listId: list._id,
		cardId,
		actor: uid,
		verb: 'card.linked',
		to: { kind: 'lead', leadId, caseproIntakeId: intake.caseproIntakeId, syncedFromCasePro: true },
		ts: now,
	});
}

/** Refresh cached fields on an existing matched lead and re-home its card if the stage moved. */
async function refreshExistingLead(
	uid: string,
	boardId: string,
	existing: ILead,
	intake: IntakeLead,
	list: IBoardList,
): Promise<void> {
	const cached = cachedLeadFields(intake);
	const set: Record<string, unknown> = { lastActivityAt: new Date() };
	for (const [k, v] of Object.entries(cached)) {
		if (v !== undefined) {
			set[k] = v;
		}
	}

	const stageMoved = existing.statusId !== list._id;
	if (stageMoved) {
		set.statusId = list._id;
	}

	await BoardsLeads.updateOne({ _id: existing._id }, { $set: set, $inc: { rev: 1 } });

	if (stageMoved && existing.cardId) {
		const position = (await BoardsCards.maxPosition(list._id)) + 1024;
		await BoardsCards.move(existing.cardId, list._id, position);
		await BoardsActivities.log({
			boardId,
			listId: list._id,
			cardId: existing.cardId,
			actor: uid,
			verb: 'card.moved',
			from: { listId: existing.statusId },
			to: { listId: list._id, syncedFromCasePro: true },
			ts: new Date(),
		});
	}
}

// ---------------------------------------------------------------------------
// pushStage — board column move -> intake_stage_id write-through
// ---------------------------------------------------------------------------

export type PushResult = { synced: boolean; intake?: IntakeLead; reason?: string };

/**
 * Write-through a stage change: map the target board column to its CasePro
 * `intake_stage_id` and `caseProClient.updateIntakeStage`. NO-OP (returns
 * `{ synced:false }`) when CasePro is disabled or the lead has no `caseproIntakeId`.
 *
 * The column's `caseproStageId` is the binding. If a column was never bound to a
 * stage id (offline-seeded board, never pulled) we resolve the stage by NAME via
 * `caseProClient.listIntakeStages()` and bind it onto the column for next time.
 */
export async function pushStage(uid: string, lead: ILead, newStatusListId: string): Promise<PushResult> {
	if (!isCaseProEnabled()) {
		return { synced: false, reason: 'casepro-disabled' };
	}
	if (!lead.caseproIntakeId) {
		return { synced: false, reason: 'no-intake-link' };
	}

	const list = await BoardsLists.findOneById(newStatusListId);
	if (!list) {
		return { synced: false, reason: 'list-not-found' };
	}

	let intakeStageId = list.caseproStageId;
	if (!intakeStageId) {
		// resolve by name against the real intake stages, then bind for next time.
		const stages = await caseProClient.listIntakeStages();
		const match = stages.find((s) => s.name === list.title);
		intakeStageId = match?.stageId;
		if (intakeStageId) {
			await bindListStageId(list, intakeStageId);
		}
	}
	if (!intakeStageId) {
		return { synced: false, reason: 'stage-unmapped' };
	}

	const intake = await caseProClient.updateIntakeStage(lead.caseproIntakeId, intakeStageId);

	// audit the upstream write on the lead's card (the local card/lead move is logged
	// by the caller — this records that the stage was mirrored INTO CasePro).
	if (lead.boardId) {
		await BoardsActivities.log({
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { intakeStageId, pushedToCasePro: true },
			ts: new Date(),
		});
	}

	return { synced: true, intake };
}

// ---------------------------------------------------------------------------
// pushCreate — capture -> create party + intake_questionnaires write-through
// ---------------------------------------------------------------------------

/**
 * Write-through a freshly-captured lead into CasePro: create the party +
 * `intake_questionnaires` row, then stamp `caseproIntakeId`/`caseproIntakeNumber`
 * back onto the `boards_leads` doc (the 1:1 sync key). NO-OP when disabled.
 *
 * `captureInput` is the CasePro-shaped capture payload; when omitted we derive a
 * minimal one from the lead's contact + classification so a manual create still
 * lands an intake upstream (CasePro has 0 required fields + no dedup, so the
 * leads service is responsible for any match-or-create — here we always create).
 */
export async function pushCreate(uid: string, lead: ILead, captureInput?: IntakeCaptureInput): Promise<PushResult> {
	if (!isCaseProEnabled()) {
		return { synced: false, reason: 'casepro-disabled' };
	}
	if (lead.caseproIntakeId) {
		// already linked (e.g. came from a pull) — don't double-create.
		return { synced: false, reason: 'already-linked' };
	}

	const input: IntakeCaptureInput = captureInput ?? deriveCaptureInput(lead);
	const intake = await caseProClient.createIntake(input);

	await BoardsLeads.updateOne(
		{ _id: lead._id },
		{
			$set: {
				caseproIntakeId: intake.caseproIntakeId,
				...(intake.caseproIntakeNumber ? { caseproIntakeNumber: intake.caseproIntakeNumber } : {}),
				lastActivityAt: new Date(),
			},
			$inc: { rev: 1 },
		},
	);

	if (lead.boardId) {
		await BoardsActivities.log({
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { caseproIntakeId: intake.caseproIntakeId, pushedToCasePro: true },
			ts: new Date(),
		});
	}

	return { synced: true, intake };
}

/** Derive a minimal CasePro capture payload from a board lead (contact + classification). */
function deriveCaptureInput(lead: ILead): IntakeCaptureInput {
	const c = lead.contact ?? {};
	return {
		contact: {
			...(c.firstName ? { firstName: c.firstName } : {}),
			...(c.lastName ? { lastName: c.lastName } : {}),
			...(c.fullName ? { fullName: c.fullName } : {}),
			...(c.email ? { email: c.email } : {}),
			...(c.phone ?? c.mobile ? { phone: c.phone ?? c.mobile } : {}),
		},
		...(lead.caseTypeId ? { caseTypeId: lead.caseTypeId } : {}),
		...(lead.attribution?.source ? { source: lead.attribution.source } : {}),
		...(lead.incident?.incidentDate ? { incidentDate: lead.incident.incidentDate } : {}),
	};
}

// ---------------------------------------------------------------------------
// pushQualify — qualify -> intake_status / form_data write-through
// ---------------------------------------------------------------------------

/**
 * Write-through a qualification: patch `intake_status` (qualified/disqualified) and
 * carry the scoring breakdown into `form_data` so CasePro keeps the rationale.
 * NO-OP when disabled or unlinked.
 */
export async function pushQualify(uid: string, lead: ILead, qualification: ILeadQualification): Promise<PushResult> {
	if (!isCaseProEnabled()) {
		return { synced: false, reason: 'casepro-disabled' };
	}
	if (!lead.caseproIntakeId) {
		return { synced: false, reason: 'no-intake-link' };
	}

	const intakeStatus =
		qualification.qualified === true ? 'Qualified' : qualification.qualified === false ? 'Disqualified' : undefined;

	const patch: IntakePatchInput = {
		...(intakeStatus ? { intakeStatus } : {}),
		formData: {
			leadScore: qualification.score,
			qualified: qualification.qualified,
			...(qualification.disqualifyReason ? { disqualifyReason: qualification.disqualifyReason } : {}),
			...(qualification.scoreBreakdown ? { scoreBreakdown: qualification.scoreBreakdown } : {}),
		},
	};

	const intake = await caseProClient.updateIntake(lead.caseproIntakeId, patch);

	if (lead.boardId) {
		await BoardsActivities.log({
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { intakeStatus, pushedToCasePro: true },
			ts: new Date(),
		});
	}

	return { synced: true, intake };
}
