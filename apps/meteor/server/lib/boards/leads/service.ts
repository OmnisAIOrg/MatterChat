import type {
	IBoard,
	IBoardList,
	IBoardCard,
	ILead,
	ILeadContact,
	ILeadIncident,
	ILeadQualification,
	ILeadAttribution,
	LeadCapturedChannel,
	LeadLostReason,
	ICommunication,
	IReferralSource,
} from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsActivities, BoardsLeads, BoardsCommunications, BoardsReferralSources } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { caseProClient } from '../casepro';
import type { IntakeCaptureInput } from '../casepro';
import { createBoard, createList } from '../service';
import { emitBoardEvent } from '../events';
import { findBoardsForFirm } from '../firmScope';
import { ensureMattersBoard, bindMatterCard } from '../matters';
import { assertBoardRole } from '../permissions';
import { pushCreate, pushStage, pushQualify } from './caseproSync';
import { nextLeadRefNo, nextSeq } from './refNo';
import { createSpeedToLeadTask } from './intakeTasks';
import { stopSequencesForLead } from './sequences';

/**
 * Leads server service (M3b). The single place lead mutation logic lives so the
 * Meteor methods AND the REST routes both call into it. Mirrors the M1 board
 * service convention: resolve board access → write model → bump rev → activity
 * log → automation event seam → return the fresh doc.
 *
 * Leads are MatterChat-owned (CasePro has no pre-conversion lead entity). A lead
 * is 1:1 with a `cardType:'lead'` card on the canonical Leads board; the lead's
 * intake STATUS is the `boards_lists._id` of the column the card sits in (no
 * separate stage collection — per 00-MASTER-PLAN). We seed those 8 columns from
 * the REAL CasePro intake_stages names.
 */

// ---------------------------------------------------------------------------
// Leads board + intake-stage columns
// ---------------------------------------------------------------------------

/**
 * The 8 REAL CasePro intake stages, in order. Seeded as the canonical Leads
 * board's columns. The first ("New Lead / Initial Contact") is the entry column
 * every new lead lands on; the last three are terminal-lost; "POA Received" is
 * the conversion gate. `caseproStageId` is filled later by the M2 CasePro sync —
 * here we seed by name so the board is usable offline/local-first.
 */
export const INTAKE_STAGE_NAMES = [
	'New Lead / Initial Contact',
	'Pending Intake Completion',
	'Further Evaluation',
	'POA Sent',
	'POA Received',
	'Declined-Unqualified',
	'Declined-Lost Lead',
	'No Response',
] as const;

export type IntakeStageName = (typeof INTAKE_STAGE_NAMES)[number];

/**
 * Lead-Docket-style sub-status refinements per intake column (M6 — the per-column
 * "where exactly is this lead" picker, intake-lead-management.md §4). Stored on the
 * list's `subStatuses[]` (IBoardList) and surfaced as the LeadPanel sub-status
 * dropdown; persisted on the lead via the existing `boards.leads.update` patch.
 *
 * Keyed by the canonical intake-stage title so seeding is firm-portable. Only the
 * columns that genuinely benefit from a refinement carry entries (the working
 * columns where a lead lingers awaiting contact / forms / a signature); terminal
 * and gate columns intentionally seed nothing. The "No Answer 1/2/3" + voicemail
 * ladder mirrors Lead Docket's call-attempt cadence.
 */
const INTAKE_STAGE_SUBSTATUSES: Partial<Record<IntakeStageName, string[]>> = {
	'New Lead / Initial Contact': ['No Answer 1', 'No Answer 2', 'No Answer 3', 'Left Voicemail', 'Callback Scheduled'],
	'Pending Intake Completion': ['Forms Sent', 'Forms Partially Complete', 'Awaiting Documents', 'No Answer 1', 'No Answer 2'],
	'Further Evaluation': ['Attorney Review', 'Awaiting Records', 'Investigating Liability', 'Pending Decision'],
	'POA Sent': ['Sent', 'Viewed', 'Partially Signed', 'No Answer 1', 'Left Voicemail'],
	'No Response': ['No Answer 1', 'No Answer 2', 'No Answer 3', 'Left Voicemail', 'Final Attempt'],
};

const LEADS_BOARD_TITLE = 'Leads';

export type EnsureLeadsBoardResult = { board: IBoard; lists: IBoardList[]; created: boolean };

/**
 * Find (or create + seed) the workspace's leads-pipeline board. Idempotent: a
 * second call returns the existing board and its lists. Seeds any missing intake
 * columns by name (so a partially-seeded board self-heals). The caller becomes a
 * board admin on creation so they immediately pass `assertBoardRole`.
 */
export async function ensureLeadsBoard(uid: string): Promise<EnsureLeadsBoardResult> {
	// Reuse an existing leads-pipeline board the caller can actually reach — one in
	// their own firm — preferring one they already belong to. This used to scan
	// `findByPipelineType('leads')` and return the first non-archived hit in the
	// WHOLE database, so a second firm on the workspace got handed the first firm's
	// leads board. In a single-firm workspace every board is reachable, so this
	// still returns exactly the board the unscoped scan returned.
	const existing = await findBoardsForFirm(uid, 'boards.ensureLeadsBoard', 'leads');
	const board = existing.find((b) => b.members.some((m) => m.userId === uid)) ?? existing[0] ?? null;

	if (board) {
		const lists = await seedMissingStages(uid, board._id);
		return { board, lists, created: false };
	}

	const created = await createBoard(uid, { title: LEADS_BOARD_TITLE, pipelineType: 'leads' });
	const lists = await seedMissingStages(uid, created._id);
	return { board: created, lists, created: true };
}

/** Create any intake-stage columns the board is missing, return all in order. */
async function seedMissingStages(uid: string, boardId: string): Promise<IBoardList[]> {
	const current = await BoardsLists.findByBoard(boardId).toArray();
	const haveByTitle = new Set(current.map((l) => l.title));

	let position = await BoardsLists.maxPosition(boardId);
	for (const name of INTAKE_STAGE_NAMES) {
		if (haveByTitle.has(name)) {
			continue;
		}
		position += 1024;
		// createList enforces member role + audit-logs the list.created activity
		await createList(uid, { boardId, title: name, position });
	}

	const lists = await BoardsLists.findByBoard(boardId).toArray();
	await seedSubStatuses(lists);
	return BoardsLists.findByBoard(boardId).toArray();
}

/**
 * Seed the Lead-Docket-style sub-status options onto each intake column that has a
 * refinement defined but no `subStatuses` yet, so the LeadPanel picker has options.
 * Idempotent: a column that already carries any sub-statuses (firm-customized or
 * previously seeded) is left untouched, so this never clobbers a firm's edits.
 * Best-effort per list — a single write failure never aborts the rest.
 */
async function seedSubStatuses(lists: IBoardList[]): Promise<void> {
	for (const list of lists) {
		const seed = INTAKE_STAGE_SUBSTATUSES[list.title as IntakeStageName];
		if (!seed?.length || (list.subStatuses?.length ?? 0) > 0) {
			continue;
		}
		try {
			await BoardsLists.updateOne({ _id: list._id }, { $set: { subStatuses: seed }, $inc: { rev: 1 } });
		} catch {
			// best-effort: a sub-status seed failure must never block board ensure.
		}
	}
}

/** The entry column ("New Lead / Initial Contact") for a leads board. */
async function getEntryList(boardId: string): Promise<IBoardList> {
	const lists = await BoardsLists.findByBoard(boardId).toArray();
	const entry = lists.find((l) => l.title === INTAKE_STAGE_NAMES[0]) ?? lists[0];
	if (!entry) {
		throw new Meteor.Error('error-leads-board-not-seeded', 'Leads board has no columns', { method: 'leads.create' });
	}
	return entry;
}

// ---------------------------------------------------------------------------
// createLead
// ---------------------------------------------------------------------------

export type CreateLeadFields = {
	contact: ILeadContact;
	caseTypeId?: string;
	practiceArea?: string;
	preferredContact?: ILead['preferredContact'];
	incident?: ILeadIncident;
	qualification?: ILeadQualification;
	attribution?: ILeadAttribution;
	solDate?: Date;
	solComputedFrom?: ILead['solComputedFrom'];
	capturedChannel?: LeadCapturedChannel;
	questionnaireId?: string;
	litboxWorkspaceId?: string;
	tags?: string[];
	/** when true, skip the phone/email dedupe short-circuit and force-create. */
	allowDuplicate?: boolean;
	/**
	 * Optional explicit CasePro-shaped capture payload for the write-through. When
	 * omitted (and CasePro is enabled) one is derived from the lead's contact +
	 * classification. Ignored entirely when CasePro is disabled.
	 */
	caseproCapture?: IntakeCaptureInput;
};

export type CreateLeadResult = {
	lead: ILead;
	card: IBoardCard;
	refNo: number;
	/** set when an open lead already matched the contact phone/email (dedupe). */
	duplicateOf?: ILead;
};

/**
 * Create a lead: dedupe on phone/email → allocate refNo → insert the
 * `boards_leads` record → create the `cardType:'lead'` card on the entry column
 * linked back to the lead → write the 1:1 cardId onto the lead → activity log.
 *
 * Dedupe: if an open lead already matches the contact phone OR email we DO NOT
 * create a second one (unless `allowDuplicate`); we return the existing lead in
 * `duplicateOf` and re-load its card so callers can surface a merge/link prompt.
 */
export async function createLead(uid: string, fields: CreateLeadFields): Promise<CreateLeadResult> {
	const contact = fields.contact ?? {};
	const phone = contact.phone ?? contact.mobile;
	const email = contact.email;

	if (!fields.allowDuplicate && (phone || email)) {
		const matches = await BoardsLeads.findByPhoneOrEmail(phone, email).toArray();
		const open = matches.find((l) => !l.archived && !l.convertedAt && !l.lostAt);
		if (open) {
			const existingCard = open.cardId ? await BoardsCards.findOneById(open.cardId) : null;
			return {
				lead: open,
				card: existingCard as IBoardCard,
				refNo: open.refNo,
				duplicateOf: open,
			};
		}
	}

	const { board } = await ensureLeadsBoard(uid);
	const entryList = await getEntryList(board._id);

	const now = new Date();
	const refNo = await nextLeadRefNo();

	const leadDoc: Omit<ILead, '_id' | '_updatedAt'> = {
		refNo,
		boardId: board._id,
		statusId: entryList._id,
		contact,
		...(fields.caseTypeId ? { caseTypeId: fields.caseTypeId } : {}),
		...(fields.practiceArea ? { practiceArea: fields.practiceArea } : {}),
		...(fields.preferredContact ? { preferredContact: fields.preferredContact } : {}),
		...(fields.incident ? { incident: fields.incident } : {}),
		...(fields.qualification ? { qualification: fields.qualification } : {}),
		...(fields.attribution ? { attribution: fields.attribution } : {}),
		...(fields.solDate ? { solDate: fields.solDate } : {}),
		...(fields.solComputedFrom ? { solComputedFrom: fields.solComputedFrom } : {}),
		...(fields.questionnaireId ? { questionnaireId: fields.questionnaireId } : {}),
		...(fields.litboxWorkspaceId ? { litboxWorkspaceId: fields.litboxWorkspaceId } : {}),
		...(fields.tags ? { tags: fields.tags } : {}),
		capturedAt: now,
		capturedChannel: fields.capturedChannel ?? 'manual',
		capturedByUserId: uid,
		lastActivityAt: now,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId: leadId } = await BoardsLeads.insertOne(leadDoc);

	// create the kanban face — a cardType:'lead' card linked to the lead
	const composedName = contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
	const title = composedName || `Lead #${refNo}`;
	const card = await createCardForLead(uid, {
		boardId: board._id,
		listId: entryList._id,
		title,
		leadId,
	});

	// back-link the card onto the lead (the 1:1 unique-sparse cardId)
	await BoardsLeads.updateOne({ _id: leadId }, { $set: { cardId: card._id }, $inc: { rev: 1 } });

	await BoardsActivities.log({
		boardId: board._id,
		listId: entryList._id,
		cardId: card._id,
		actor: uid,
		verb: 'card.created',
		to: { kind: 'lead', leadId, refNo, title },
		ts: now,
	});
	emitBoardEvent('card.created', { boardId: board._id, listId: entryList._id, cardId: card._id, actor: uid });

	let lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found after create', { method: 'leads.create' });
	}

	// CasePro write-through (no-op + swallowed when disabled/unconfigured): create the
	// party + intake_questionnaires upstream and stamp the sync key back onto the lead.
	try {
		const pushed = await pushCreate(uid, lead, fields.caseproCapture);
		if (pushed.synced) {
			lead = (await BoardsLeads.findOneById(leadId)) ?? lead;
		}
	} catch {
		// the board is the working view; a failed upstream create must NOT fail capture.
	}

	// speed-to-lead SLA: auto-create the first-touch follow-up task (best-effort).
	try {
		await createSpeedToLeadTask(uid, lead);
	} catch {
		// the SLA tickler is a convenience; never fail capture if it can't be written.
	}

	return { lead, card, refNo };
}

/**
 * Insert a `cardType:'lead'` card carrying the discriminated `{kind:'lead', leadId}`
 * link. We write the card doc directly (not the M1 `createCard`) because the link
 * union + lead card type must be set atomically at insert.
 */
async function createCardForLead(
	uid: string,
	params: { boardId: string; listId: string; title: string; leadId: string },
): Promise<IBoardCard> {
	await assertBoardRole(params.boardId, uid, 'member', 'leads.create');

	const position = (await BoardsCards.maxPosition(params.listId)) + 1024;
	const cardNumber = await Boards.nextCardNumber(params.boardId);
	const now = new Date();

	const doc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId: params.boardId,
		listId: params.listId,
		title: params.title,
		position,
		cardType: 'lead',
		link: { kind: 'lead', leadId: params.leadId },
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
	};

	const { insertedId } = await BoardsCards.insertOne(doc);
	const card = await BoardsCards.findOneById(insertedId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Lead card not found after create', { method: 'leads.create' });
	}
	return card;
}

// ---------------------------------------------------------------------------
// updateLead
// ---------------------------------------------------------------------------

export type UpdateLeadPatch = Partial<
	Pick<
		ILead,
		| 'contact'
		| 'preferredContact'
		| 'caseTypeId'
		| 'practiceArea'
		| 'incident'
		| 'attribution'
		| 'solDate'
		| 'solComputedFrom'
		| 'solAtRisk'
		| 'subStatus'
		| 'tags'
		| 'litboxWorkspaceId'
		| 'channelRoomId'
	>
> & {
	/** move the lead to a different intake-stage column (mirrors the card move). */
	statusId?: string;
};

/**
 * Patch a lead's editable fields. When `statusId` changes we also move the
 * linked card to that column (so the kanban face stays in sync) and log the
 * transition. Other field edits log a `field.changed` activity.
 */
export async function updateLead(uid: string, leadId: string, patch: UpdateLeadPatch): Promise<ILead> {
	const current = await BoardsLeads.findOneById(leadId);
	if (!current) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.update' });
	}
	if (current.boardId) {
		await assertBoardRole(current.boardId, uid, 'member', 'leads.update');
	}

	const set: Record<string, unknown> = { lastActivityAt: new Date() };
	const fieldKeys: (keyof UpdateLeadPatch)[] = [
		'contact',
		'preferredContact',
		'caseTypeId',
		'practiceArea',
		'incident',
		'attribution',
		'solDate',
		'solComputedFrom',
		'solAtRisk',
		'subStatus',
		'tags',
		'litboxWorkspaceId',
		'channelRoomId',
	];
	for (const key of fieldKeys) {
		if (patch[key] !== undefined) {
			set[key] = patch[key];
		}
	}

	const statusChanged = typeof patch.statusId === 'string' && patch.statusId !== current.statusId;
	if (statusChanged) {
		set.statusId = patch.statusId;
	}

	await BoardsLeads.updateOne({ _id: leadId }, { $set: set, $inc: { rev: 1 } });

	// keep the kanban card in sync on a status change
	if (statusChanged && current.cardId && current.boardId && patch.statusId) {
		const targetList = await BoardsLists.findOneById(patch.statusId);
		if (targetList && targetList.boardId === current.boardId && !targetList.archived) {
			const position = (await BoardsCards.maxPosition(patch.statusId)) + 1024;
			await BoardsCards.move(current.cardId, patch.statusId, position, patch.subStatus);
			await BoardsActivities.log({
				boardId: current.boardId,
				listId: patch.statusId,
				cardId: current.cardId,
				actor: uid,
				verb: 'card.moved',
				from: { listId: current.statusId },
				to: { listId: patch.statusId, subStatus: patch.subStatus },
				ts: new Date(),
			});
			emitBoardEvent('card.moved', {
				boardId: current.boardId,
				listId: patch.statusId,
				cardId: current.cardId,
				actor: uid,
				fromListId: current.statusId,
				toListId: patch.statusId,
			});
		}
	}

	// Automation seam (M7): higher-level lead lifecycle event. The `card.moved` above is
	// the raw kanban move; `lead.statusChanged` lets intake automations trigger on the
	// lead's intake STATUS transition (the column == status per the master plan) — e.g.
	// "moved to Further Evaluation → notify attorney". Carries the from/to statusId +
	// linked card. Fire-and-forget (emitBoardEvent never throws).
	if (statusChanged && patch.statusId && current.boardId) {
		emitBoardEvent('lead.statusChanged', {
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			leadId,
			fromStatusId: current.statusId,
			toStatusId: patch.statusId,
			...(patch.subStatus ? { subStatus: patch.subStatus } : {}),
		});
	}

	// CasePro write-through on a stage change: map the new column -> intake_stage_id.
	// No-op + swallowed when CasePro is disabled or the lead has no caseproIntakeId.
	if (statusChanged && patch.statusId) {
		try {
			await pushStage(uid, current, patch.statusId);
		} catch {
			// the upstream write is best-effort; the local move already happened.
		}
		// a status advance stops any running drips (intake-lead-management.md §7).
		try {
			await stopSequencesForLead(leadId, 'status-advances');
		} catch {
			// best-effort drip stop.
		}
	}

	if (!statusChanged && current.boardId) {
		await BoardsActivities.log({
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: set,
			ts: new Date(),
		});
	}

	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.update' });
	}
	return lead;
}

// ---------------------------------------------------------------------------
// qualifyLead
// ---------------------------------------------------------------------------

/**
 * Persist a qualification/scoring result on the lead. Pure data write (scoring
 * computation itself — rule weights, AI — is a later phase); this stores whatever
 * the caller computed.
 */
export async function qualifyLead(uid: string, leadId: string, qualification: ILeadQualification): Promise<ILead> {
	const current = await BoardsLeads.findOneById(leadId);
	if (!current) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.qualify' });
	}
	if (current.boardId) {
		await assertBoardRole(current.boardId, uid, 'member', 'leads.qualify');
	}

	await BoardsLeads.setQualification(leadId, qualification);

	if (current.boardId) {
		await BoardsActivities.log({
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { qualification },
			ts: new Date(),
		});
	}

	// Automation seam (M7): the qualification decision is the intake gate automations
	// branch on — `lead.qualified` (e.g. start sign-up sequence / notify attorney) vs
	// `lead.disqualified` (e.g. label + send decline drip). We only emit a terminal
	// event when the decision is explicit (true/false); an undefined `qualified` is a
	// scoring update, not a decision, so it carries no lifecycle event. Fire-and-forget.
	if (current.boardId && typeof qualification.qualified === 'boolean') {
		emitBoardEvent(qualification.qualified ? 'lead.qualified' : 'lead.disqualified', {
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			leadId,
			...(qualification.score !== undefined ? { score: qualification.score } : {}),
			...(qualification.qualified === false && qualification.disqualifyReason
				? { disqualifyReason: qualification.disqualifyReason }
				: {}),
		});
	}

	// CasePro write-through: persist intake_status + scoring rationale into form_data.
	// No-op + swallowed when CasePro is disabled or the lead has no caseproIntakeId.
	try {
		await pushQualify(uid, current, qualification);
	} catch {
		// best-effort; the local qualification already persisted.
	}

	// a qualified decision stops any running nurture drips.
	if (qualification.qualified === true) {
		try {
			await stopSequencesForLead(leadId, 'qualified');
		} catch {
			// best-effort drip stop.
		}
	}

	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.qualify' });
	}
	return lead;
}

// ---------------------------------------------------------------------------
// assignLead (round-robin via a cursor on the leads board doc)
// ---------------------------------------------------------------------------

export type AssignLeadParams = {
	/** explicit owner; omit to round-robin across the board members (member role). */
	ownerId?: string;
	/** speed-to-lead due time; if omitted, no SLA is set here. */
	slaDueAt?: Date;
	/** assignment pool override; defaults to the board's member/admin user ids. */
	pool?: string[];
};

export type AssignLeadResult = { lead: ILead; ownerId: string; slaDueAt?: Date };

/**
 * Assign a lead's owner. If no explicit `ownerId` is given we round-robin across
 * the assignment pool (board members by default), advancing a cursor stored on
 * the leads board doc so successive unassigned leads spread across the team.
 *
 * The cursor lives in `IBoard.fieldValues`-free space: we keep it on a dedicated
 * `boards_counters` doc keyed by board id (no M1 board-model edit needed).
 */
export async function assignLead(uid: string, leadId: string, params: AssignLeadParams = {}): Promise<AssignLeadResult> {
	const current = await BoardsLeads.findOneById(leadId);
	if (!current) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.assign' });
	}
	const boardId = current.boardId;
	if (boardId) {
		await assertBoardRole(boardId, uid, 'member', 'leads.assign');
	}

	let ownerId = params.ownerId;
	if (!ownerId) {
		ownerId = await pickRoundRobinOwner(boardId, params.pool);
	}
	if (!ownerId) {
		throw new Meteor.Error('error-no-assignment-pool', 'No assignment pool available', { method: 'leads.assign' });
	}

	await BoardsLeads.setOwner(leadId, ownerId, params.slaDueAt, uid);

	if (boardId) {
		await BoardsActivities.log({
			boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			verb: 'member.added',
			to: { ownerId, slaDueAt: params.slaDueAt },
			ts: new Date(),
		});
	}

	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.assign' });
	}
	return { lead, ownerId, ...(params.slaDueAt ? { slaDueAt: params.slaDueAt } : {}) };
}

/** Round-robin selection across the board's member pool, cursor-advanced. */
async function pickRoundRobinOwner(boardId: string | undefined, poolOverride?: string[]): Promise<string | undefined> {
	let pool = poolOverride;
	if ((!pool || pool.length === 0) && boardId) {
		const board = await Boards.findOneById(boardId);
		pool = (board?.members ?? []).filter((m) => m.role !== 'observer').map((m) => m.userId);
	}
	if (!pool || pool.length === 0) {
		return undefined;
	}
	// advance a per-board cursor; modulo into the pool
	const seq = await nextSeq(boardId ? `leadAssign:${boardId}` : 'leadAssign:global');
	return pool[(seq - 1) % pool.length];
}

// ---------------------------------------------------------------------------
// logCommunication
// ---------------------------------------------------------------------------

export type LogCommunicationParams = Omit<ICommunication, '_id' | '_updatedAt' | 'leadId' | 'ts' | 'byUserId'> & {
	ts?: Date;
};

export type LogCommunicationResult = { commId: string; communication: ICommunication };

/**
 * Append a communication to a lead's timeline. On an inbound comm we also call
 * `recordContact` (updates lastContactedAt / first-contact SLA timestamp, clears
 * coldSince). Returns the persisted communication.
 */
export async function logCommunication(uid: string, leadId: string, params: LogCommunicationParams): Promise<LogCommunicationResult> {
	const current = await BoardsLeads.findOneById(leadId);
	if (!current) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.logComm' });
	}
	if (current.boardId) {
		await assertBoardRole(current.boardId, uid, 'member', 'leads.logComm');
	}

	const ts = params.ts ?? new Date();
	const entry: Omit<ICommunication, '_id' | '_updatedAt'> = {
		...params,
		leadId,
		ts,
		byUserId: uid,
	};

	const commId = await BoardsCommunications.log(entry);

	// any logged comm counts as contact (drives cold-lead aging + the SLA $min);
	// passing the direction lets recordContact stamp lastInboundAt for inbound ONLY,
	// so an outbound drip send never registers as the lead "responding".
	await BoardsLeads.recordContact(leadId, ts, params.direction);

	// an INBOUND comm means the lead responded -> auto-stop any running drips.
	if (params.direction === 'in') {
		try {
			await stopSequencesForLead(leadId, 'lead-responds');
		} catch {
			// drip stop is best-effort; never fail the comm log.
		}
	}

	if (current.boardId) {
		await BoardsActivities.log({
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			verb: 'comment.added',
			to: { commId, kind: params.kind, direction: params.direction },
			ts,
		});
	}

	const communication = await BoardsCommunications.findOneById(commId);
	if (!communication) {
		throw new Meteor.Error('error-comm-not-found', 'Communication not found after log', { method: 'leads.logComm' });
	}
	return { commId, communication };
}

// ---------------------------------------------------------------------------
// upsertReferralSource
// ---------------------------------------------------------------------------

export type UpsertReferralSourceFields = Partial<Omit<IReferralSource, '_id' | '_updatedAt' | 'createdAt' | 'createdBy'>> & {
	name: string;
	type: IReferralSource['type'];
};

export type UpsertReferralSourceResult = { source: IReferralSource; created: boolean };

/**
 * Create or update an inbound referral / marketing source. When `sourceId` is
 * given we patch; otherwise we insert a new directory entry. Dedupe-by-name is
 * intentionally NOT enforced here (firms can have same-named contacts); callers
 * that want match-or-create pass an existing `sourceId`.
 */
export async function upsertReferralSource(
	uid: string,
	fields: UpsertReferralSourceFields,
	sourceId?: string,
): Promise<UpsertReferralSourceResult> {
	if (sourceId) {
		const existing = await BoardsReferralSources.findOneById(sourceId);
		if (!existing) {
			throw new Meteor.Error('error-referral-source-not-found', 'Referral source not found', { method: 'referralSource.upsert' });
		}
		const { name, type, contact, defaultFeePct, channel, utmSource, monthlySpend, campaigns, caseproPartyId, notes, active } = fields;
		await BoardsReferralSources.updateSource(sourceId, {
			name,
			type,
			...(contact !== undefined ? { contact } : {}),
			...(defaultFeePct !== undefined ? { defaultFeePct } : {}),
			...(channel !== undefined ? { channel } : {}),
			...(utmSource !== undefined ? { utmSource } : {}),
			...(monthlySpend !== undefined ? { monthlySpend } : {}),
			...(campaigns !== undefined ? { campaigns } : {}),
			...(caseproPartyId !== undefined ? { caseproPartyId } : {}),
			...(notes !== undefined ? { notes } : {}),
			...(active !== undefined ? { active } : {}),
		});
		const source = await BoardsReferralSources.findOneById(sourceId);
		if (!source) {
			throw new Meteor.Error('error-referral-source-not-found', 'Referral source not found', { method: 'referralSource.upsert' });
		}
		return { source, created: false };
	}

	const now = new Date();
	const doc: Omit<IReferralSource, '_id' | '_updatedAt'> = {
		name: fields.name,
		type: fields.type,
		...(fields.contact !== undefined ? { contact: fields.contact } : {}),
		...(fields.defaultFeePct !== undefined ? { defaultFeePct: fields.defaultFeePct } : {}),
		...(fields.channel !== undefined ? { channel: fields.channel } : {}),
		...(fields.utmSource !== undefined ? { utmSource: fields.utmSource } : {}),
		...(fields.monthlySpend !== undefined ? { monthlySpend: fields.monthlySpend } : {}),
		...(fields.campaigns !== undefined ? { campaigns: fields.campaigns } : {}),
		...(fields.caseproPartyId !== undefined ? { caseproPartyId: fields.caseproPartyId } : {}),
		...(fields.notes !== undefined ? { notes: fields.notes } : {}),
		active: fields.active ?? true,
		createdBy: uid,
		createdAt: now,
	};
	const { insertedId } = await BoardsReferralSources.insertOne(doc);
	const source = await BoardsReferralSources.findOneById(insertedId);
	if (!source) {
		throw new Meteor.Error('error-referral-source-not-found', 'Referral source not found after create', { method: 'referralSource.upsert' });
	}
	return { source, created: true };
}

// ---------------------------------------------------------------------------
// markLost (exit helper used by REST/methods status flow)
// ---------------------------------------------------------------------------

export async function markLeadLost(uid: string, leadId: string, reason: LeadLostReason): Promise<ILead> {
	const current = await BoardsLeads.findOneById(leadId);
	if (!current) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.markLost' });
	}
	if (current.boardId) {
		await assertBoardRole(current.boardId, uid, 'member', 'leads.markLost');
	}

	await BoardsLeads.markLost(leadId, reason, uid);

	// a lost lead stops any running drips.
	try {
		await stopSequencesForLead(leadId, 'lost');
	} catch {
		// best-effort drip stop.
	}

	if (current.boardId) {
		await BoardsActivities.log({
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { lostReason: reason },
			ts: new Date(),
		});
	}

	// Automation seam (M7): the lead reached a terminal lost state. Lets automations
	// fire a "lost lead" follow-up (e.g. re-engagement drip, mark the source's ROI,
	// notify the intake manager). Carries the structured `LeadLostReason` for condition
	// matching. Fire-and-forget (emitBoardEvent never throws).
	if (current.boardId) {
		emitBoardEvent('lead.lost', {
			boardId: current.boardId,
			...(current.cardId ? { cardId: current.cardId } : {}),
			actor: uid,
			leadId,
			reason,
		});
	}

	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.markLost' });
	}
	return lead;
}

// ---------------------------------------------------------------------------
// syncLeadStageFromCard (kanban seam — called from the boards.cardMove path)
// ---------------------------------------------------------------------------

/**
 * The terminal "lost"-class exit columns (intake-lead-management.md §4 exits),
 * keyed by their seeded `INTAKE_STAGE_NAMES` title -> the `LeadLostReason` stamped
 * when a lead card lands there. These three are the last entries of
 * `INTAKE_STAGE_NAMES` (the conversion gate "POA Received" is index 4, NOT lost).
 *
 * We key off the COLUMN TITLE because the leads board models intake status AS the
 * `boards_lists` column (per 00-MASTER-PLAN — no separate stage/status collection),
 * and the columns are seeded from these exact real CasePro stage names. The
 * `referred-out` reason is stamped by the explicit referral flow (`createReferralOut`),
 * not a drag, so it is intentionally not column-mapped here.
 */
const LOST_STATUS_REASON_BY_TITLE: Record<string, LeadLostReason> = {
	[INTAKE_STAGE_NAMES[5]]: 'declined-unqualified', // 'Declined-Unqualified'
	[INTAKE_STAGE_NAMES[6]]: 'declined-lost', // 'Declined-Lost Lead'
	[INTAKE_STAGE_NAMES[7]]: 'no-response', // 'No Response'
};

/** The lost-class reason for a destination column, or undefined if not a lost exit. */
async function lostReasonForList(listId: string): Promise<LeadLostReason | undefined> {
	const list = await BoardsLists.findOneById(listId);
	if (!list) {
		return undefined;
	}
	return LOST_STATUS_REASON_BY_TITLE[list.title];
}

/**
 * Kanban → lead sync hook. When a `cardType:'lead'` card is moved on the leads
 * board (the M1 `boards.cardMove` path), the linked lead's `statusId` must follow
 * the column AND the change must write through to CasePro. This is the least-
 * invasive seam: `cardMove` calls this AFTER the card has already moved, so we
 * only reconcile the lead doc + push the stage (we do NOT move the card again).
 *
 * When the destination column is a terminal lost-class exit (§4 — Not a Fit /
 * Lost / No Response), we ALSO run `markLeadLost` so `lostAt`/`lostReason` get
 * stamped and the drips stop — `setStatus` alone never did that, so a dragged lead
 * was silently left "open". Best-effort: a lost-stamp/CasePro failure never rolls
 * back the already-committed card move, and a normal stage move is untouched.
 *
 * No-op for non-lead cards / cards with no linked lead.
 */
export async function syncLeadStageFromCard(uid: string, cardId: string, toListId: string): Promise<void> {
	const lead = await BoardsLeads.findOneByCardId(cardId);
	if (!lead) {
		return; // not a lead card (or no linked lead) — nothing to sync
	}
	if (lead.statusId !== toListId) {
		await BoardsLeads.setStatus(lead._id, toListId);
	}

	// terminal lost-class exit → stamp lostAt/lostReason + stop drips (best-effort).
	// Skip if the lead is already converted/lost so we don't re-stamp or clobber.
	if (!lead.convertedAt && !lead.lostAt) {
		try {
			const reason = await lostReasonForList(toListId);
			if (reason) {
				await markLeadLost(uid, lead._id, reason);
			}
		} catch {
			// the lost-stamp is best-effort; the card + lead status already moved.
		}
	}

	try {
		await pushStage(uid, lead, toListId);
	} catch {
		// best-effort upstream write; the card + lead status already moved locally.
	}

	// Automation seam (M7): mirror the drag-driven status change as the higher-level
	// `lead.statusChanged` (the same event `updateLead` emits for an in-panel status
	// change), so intake automations fire identically whether the lead was dragged on
	// the kanban or moved via the LeadPanel. `lead.statusId` here is the pre-move value
	// (the local doc predates `setStatus`). A terminal lost exit additionally emitted
	// `lead.lost` via `markLeadLost` above. Fire-and-forget (emitBoardEvent never throws).
	if (lead.boardId && lead.statusId !== toListId) {
		emitBoardEvent('lead.statusChanged', {
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			leadId: lead._id,
			fromStatusId: lead.statusId,
			toStatusId: toListId,
		});
	}
}

// ---------------------------------------------------------------------------
// convertToMatter (POA Received → create CasePro matter + bind a matter card)
// ---------------------------------------------------------------------------

export type ConvertToMatterResult = {
	lead: ILead;
	matterId: string;
	matterCard: IBoardCard;
	mattersBoardId: string;
};

/**
 * Convert a lead at "POA Received" into a CasePro matter:
 *   1. guard the lead sits on the POA-Received column (the conversion gate),
 *   2. `caseProClient.createMatterFromIntake` — creates the CasePro `matters` row
 *      and stamps `intake_questionnaires.matter_id` (the upstream link),
 *   3. ensure a Matters board + `bindMatterCard` (reuses the M3a matters service)
 *      so the new matter shows on the matters pipeline,
 *   4. `BoardsLeads.markConverted` (records matterId + matter card id + actor),
 *   5. activity log on both the lead card and the new matter card.
 *
 * Requires CasePro to be enabled AND the lead to carry `caseproIntakeId` — a lead
 * with no upstream intake cannot be converted through this path.
 */
export async function convertToMatter(uid: string, leadId: string): Promise<ConvertToMatterResult> {
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'leads.convertToMatter' });
	}
	if (lead.boardId) {
		await assertBoardRole(lead.boardId, uid, 'member', 'leads.convertToMatter');
	}
	if (lead.convertedMatterId || lead.convertedAt) {
		throw new Meteor.Error('error-lead-already-converted', 'Lead already converted to a matter', {
			method: 'leads.convertToMatter',
		});
	}
	if (!lead.caseproIntakeId) {
		throw new Meteor.Error('error-lead-no-intake', 'Lead has no CasePro intake to convert', {
			method: 'leads.convertToMatter',
		});
	}

	// guard: the lead must be on the "POA Received" column (the conversion gate).
	const POA_RECEIVED = INTAKE_STAGE_NAMES[4];
	const currentList = await BoardsLists.findOneById(lead.statusId);
	if (!currentList || currentList.title !== POA_RECEIVED) {
		throw new Meteor.Error('error-lead-not-at-poa-received', `Lead must be at "${POA_RECEIVED}" to convert`, {
			method: 'leads.convertToMatter',
		});
	}

	// 1. create the CasePro matter from the intake (sets intake.matter_id upstream).
	const matterName =
		lead.contact?.fullName ||
		[lead.contact?.firstName, lead.contact?.lastName].filter(Boolean).join(' ').trim() ||
		`Matter from intake ${lead.caseproIntakeNumber ?? lead.caseproIntakeId}`;
	const { matterId } = await caseProClient.createMatterFromIntake(lead.caseproIntakeId, { matter_name: matterName }, { actingUserId: uid });

	// 2. ensure the matters board + bind a card for the new matter (reuse M3a service).
	const { board: mattersBoard, lists: matterLists } = await ensureMattersBoard(uid);
	const entryMatterList = [...matterLists].sort((a, b) => a.position - b.position)[0];
	if (!entryMatterList) {
		throw new Meteor.Error('error-matters-board-not-seeded', 'Matters board has no stage lists', {
			method: 'leads.convertToMatter',
		});
	}
	const matterCard = await bindMatterCard(uid, mattersBoard._id, entryMatterList._id, matterId);

	// 3. mark the lead converted (records matterId + matter card id + actor).
	await BoardsLeads.markConverted(leadId, { matterId, matterCardId: matterCard._id, byUserId: uid });

	// converting stops any running drips.
	try {
		await stopSequencesForLead(leadId, 'converted');
	} catch {
		// best-effort drip stop.
	}

	// 4. activity log on the lead card and on the new matter card.
	const now = new Date();
	if (lead.boardId) {
		await BoardsActivities.log({
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			verb: 'card.linked',
			to: { convertedToMatter: matterId, matterCardId: matterCard._id, caseproIntakeId: lead.caseproIntakeId },
			ts: now,
		});
	}
	await BoardsActivities.log({
		boardId: mattersBoard._id,
		listId: matterCard.listId,
		cardId: matterCard._id,
		actor: uid,
		verb: 'card.linked',
		to: { convertedFromLeadId: leadId, refNo: lead.refNo, matterId },
		ts: now,
	});

	// Automation seam (M7): the lead crossed the conversion gate into a CasePro matter.
	// Scoped to the LEADS board (where the lead-lifecycle automations live) and carries
	// the new matterId + matter card + matters board so an automation can hand off (e.g.
	// notify the case manager, kick the Intake stage playbook, request a LitBox folder).
	// The matter card's own creation/link events fire from the matters service. Fire-and-
	// forget (emitBoardEvent never throws).
	if (lead.boardId) {
		emitBoardEvent('lead.converted', {
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			leadId,
			refNo: lead.refNo,
			matterId,
			matterCardId: matterCard._id,
			mattersBoardId: mattersBoard._id,
		});
	}

	const converted = await BoardsLeads.findOneById(leadId);
	if (!converted) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found after convert', { method: 'leads.convertToMatter' });
	}

	return { lead: converted, matterId, matterCard, mattersBoardId: mattersBoard._id };
}
