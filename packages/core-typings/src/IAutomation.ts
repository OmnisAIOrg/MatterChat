import type { BoardsCardType } from './IBoardCard';
import type { BoardDeadlineKind } from './IBoardDeadline';
import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Automation definition (Tier 3, collection `boards_automations`). The
 * Butler-equivalent: one doc per rule / card-button / board-button / scheduled
 * automation / drip-sequence. Powers intake drip, SOL reminders, and stage
 * playbooks for The Nguyen Law Firm (05-automation-engine.md).
 *
 * The engine (M7 service) is the single executor: drip sequences and stage
 * playbooks are *clients* of it — a drip is `kind:'sequence'`, a playbook is a
 * `card.moved` rule whose actions create checklist items / tasks / deadlines.
 *
 * Field conventions mirror the other Boards models (`rev`, `createdBy:_id`,
 * `createdAt`/`updatedAt`, `enabled`, `isSystem`, `seedKey`) so the model recipe
 * and the audit/permission idioms line up.
 *
 * NOTE on the event vocabulary: the engine's runtime event union lives in
 * `apps/meteor/server/lib/boards/events.ts` (`BoardEventName`). core-typings may
 * not import from apps/meteor, so `BoardAutomationTriggerEvent` below mirrors the
 * same names (same precedent as `BoardsActivityVerb` in IBoardActivity). Keep the
 * two in sync — they are the same contract.
 */

export type BoardAutomationKind = 'rule' | 'card-button' | 'board-button' | 'scheduled' | 'sequence';

export type BoardAutomationScope = 'board' | 'global';

// --- Trigger -----------------------------------------------------------------

/**
 * The events a `kind:'rule'` automation can fire on. Mirrors `BoardEventName`
 * (minus the pure board/list lifecycle events that have no card subject), plus
 * the literal `'schedule'` used by `kind:'scheduled'`.
 */
export type BoardAutomationTriggerEvent =
	// card lifecycle
	| 'card.created'
	| 'card.updated'
	| 'card.moved'
	| 'card.archived'
	| 'card.subStatusChanged'
	| 'card.converted'
	| 'card.commented'
	// card-detail mutations
	| 'label.added'
	| 'label.removed'
	| 'member.added'
	| 'member.removed'
	| 'due.set'
	| 'due.completed'
	| 'checklist.itemChecked'
	| 'checklist.completed'
	| 'field.changed'
	// matter domain
	| 'matter.stageChanged'
	| 'casepro.stageChanged'
	// lead domain
	| 'lead.captured'
	| 'lead.statusChanged'
	| 'lead.qualified'
	| 'lead.disqualified'
	| 'lead.lost'
	| 'lead.converted'
	| 'lead.contacted'
	| 'lead.responded'
	| 'lead.noContact'
	// deadlines / card dates (cron-synthesized where noted in events.ts)
	| 'deadline.created'
	| 'deadline.due'
	| 'deadline.acknowledged'
	| 'card.dueSoon'
	| 'card.overdue'
	// scheduled pseudo-event
	| 'schedule';

/**
 * Cheap pre-filters applied to the event payload before the (more expensive)
 * conditions run. All present keys must match (AND). e.g. a `card.moved` rule
 * with `{ toListId }` only fires when the card lands in that list.
 */
export interface IBoardAutomationFilters {
	listId?: string; // card.created / generic list scoping
	fromListId?: string; // card.moved
	toListId?: string; // card.moved
	cardType?: BoardsCardType; // restrict to lead/matter/task cards
	labelId?: string; // label.added/removed
	userId?: string; // member.added/removed
	fieldId?: string; // field.changed
	fromStage?: string; // matter.stageChanged / casepro.stageChanged (stage id)
	toStage?: string; // matter.stageChanged / casepro.stageChanged (stage id)
	statusId?: string; // lead.statusChanged (boards_lists._id)
	deadlineKind?: BoardDeadlineKind; // deadline.* events
	source?: string; // lead.captured (capturedChannel / attribution source)
	/** For cron-synthesized date events: how far ahead to fire, e.g. '-1d','-2h'. */
	offset?: string;
}

export interface IBoardAutomationTrigger {
	event: BoardAutomationTriggerEvent;
	filters?: IBoardAutomationFilters;
}

// --- Schedule (kind:'scheduled') --------------------------------------------

export type BoardAutomationScheduleKind = 'every' | 'at' | 'cron';

/**
 * Anchor for `kind:'scheduled'` automations, evaluated by the engine cron in the
 * firm timezone (`Boards_Automation_Timezone`).
 * - 'every' : recurring cadence + time-of-day (Cold-lead weekday 8am, SOL daily, Stuck-matter weekly).
 * - 'at'    : a single absolute ISO instant (one-shot).
 * - 'cron'  : an explicit 5-field cron string for power users.
 */
export interface IBoardAutomationSchedule {
	kind: BoardAutomationScheduleKind;
	cadence?: 'daily' | 'weekday' | 'weekly';
	dayOfWeek?: number; // 0..6 (weekly)
	hour?: number; // 0..23 firm-local
	minute?: number; // 0..59
	at?: string; // absolute ISO (kind:'at')
	cron?: string; // raw 5-field cron (kind:'cron')
}

// --- Conditions (AND-combined) ----------------------------------------------

export type BoardConditionField =
	| 'list'
	| 'label'
	| 'assignee'
	| 'cardType'
	| 'pipelineType'
	| 'subStatus'
	| 'due'
	| 'sol'
	| 'daysInStage'
	| 'lead.source'
	| 'lead.score'
	| 'lead.qualified'
	| `field:${string}`; // custom field by fieldDef id

export type BoardConditionOp =
	| 'is'
	| 'isNot'
	| 'has'
	| 'lacks'
	| 'contains'
	| 'none'
	| 'set'
	| 'unset'
	| 'within'
	| 'over'
	| 'eq'
	| 'neq'
	| 'gt'
	| 'lt'
	| 'empty';

export interface IBoardCondition {
	field: BoardConditionField;
	op: BoardConditionOp;
	value?: unknown; // listId | labelId | userId | duration('60d') | number | enum
}

// --- Actions (discriminated union on `type`) --------------------------------

export type BoardAutomationActionType =
	// card
	| 'addLabel'
	| 'removeLabel'
	| 'move'
	| 'setField'
	| 'assignMember'
	| 'unassignMember'
	| 'setDue'
	| 'completeDue'
	| 'setCover'
	| 'comment'
	| 'createCard'
	| 'archiveCard'
	| 'addChecklist'
	// matter depth
	| 'createDeadline'
	| 'createTask'
	// notify / communicate
	| 'notify'
	| 'notifyEmail'
	| 'notifySms'
	| 'enrollSequence'
	| 'stopSequence'
	// integration (P3, gated)
	| 'caseproWriteback'
	| 'litboxRequestFolder'
	| 'aiGenerate';

interface IBoardActionBase {
	type: BoardAutomationActionType;
	/**
	 * Sequence steps only (kind:'sequence'): delay before this step fires,
	 * relative to enrollment / the previous step. e.g. '0', '15m', '1d', '3d'.
	 */
	delay?: string;
	/** When true, a failure aborts the remaining actions (default: continue best-effort). */
	critical?: boolean;
}

export interface IActionAddLabel extends IBoardActionBase {
	type: 'addLabel';
	labelId: string;
}
export interface IActionRemoveLabel extends IBoardActionBase {
	type: 'removeLabel';
	labelId: string;
}
export interface IActionMove extends IBoardActionBase {
	type: 'move';
	toListId: string;
	position?: 'top' | 'bottom';
	subStatus?: string;
}
export interface IActionSetField extends IBoardActionBase {
	type: 'setField';
	fieldId: string;
	value: string | number | boolean | null; // may carry {var} templates
}
export interface IActionAssignMember extends IBoardActionBase {
	type: 'assignMember';
	userId?: string; // explicit user; omit + roundRobin:true to rotate the board team
	roundRobin?: boolean;
}
export interface IActionUnassignMember extends IBoardActionBase {
	type: 'unassignMember';
	userId: string;
}
export interface IActionSetDue extends IBoardActionBase {
	type: 'setDue';
	due: string; // ISO or relative token, e.g. '{now+30d}'
}
export interface IActionCompleteDue extends IBoardActionBase {
	type: 'completeDue';
}
export interface IActionSetCover extends IBoardActionBase {
	type: 'setCover';
	cover: { kind: 'color' | 'image' | 'attachment'; value: string };
}
export interface IActionComment extends IBoardActionBase {
	type: 'comment';
	body: string; // templated
	alsoPostToRoom?: boolean; // matter cards: fan out to the channel-per-matter room
}
export interface IActionCreateCard extends IBoardActionBase {
	type: 'createCard';
	listId: string;
	title: string; // templated
	description?: string;
	cardType?: BoardsCardType;
	fieldValues?: Record<string, string | number | boolean | null>;
}
export interface IActionArchiveCard extends IBoardActionBase {
	type: 'archiveCard';
}
export interface IActionAddChecklist extends IBoardActionBase {
	type: 'addChecklist';
	playbookId?: string; // -> boards_playbooks._id (apply a templated checklist)
	title?: string; // inline checklist title when no playbookId
	items?: string[]; // inline item texts
}
export interface IActionCreateDeadline extends IBoardActionBase {
	type: 'createDeadline';
	kind: BoardDeadlineKind;
	label?: string;
	due: string; // ISO or relative token
	highRisk?: boolean;
}
export interface IActionCreateTask extends IBoardActionBase {
	type: 'createTask';
	title: string; // templated
	assigneeRole?: 'attorney' | 'paralegal' | 'case-manager' | 'owner' | 'intake';
	dueOffsetDays?: number;
}
export interface IActionNotify extends IBoardActionBase {
	type: 'notify';
	target: 'owner' | 'assignees' | 'watchers' | 'user';
	userId?: string; // when target:'user'
	message: string; // templated
}
export interface IActionNotifyEmail extends IBoardActionBase {
	type: 'notifyEmail';
	templateId?: string; // -> boards_comm_templates._id
	subject?: string; // templated, when no templateId
	body?: string; // templated, when no templateId
}
export interface IActionNotifySms extends IBoardActionBase {
	type: 'notifySms';
	templateId?: string;
	body?: string; // templated
}
export interface IActionEnrollSequence extends IBoardActionBase {
	type: 'enrollSequence';
	sequenceId: string; // -> boards_sequences._id (the existing M6 drip)
}
export interface IActionStopSequence extends IBoardActionBase {
	type: 'stopSequence';
	sequenceId?: string; // omit to stop all active enrollments for the subject
}
export interface IActionCaseproWriteback extends IBoardActionBase {
	type: 'caseproWriteback';
	/** The allow-listed CasePro operation; routed through validate_operation → execute_operation. */
	operation: 'advanceStage' | 'createMatterFromLead' | 'updateField';
	stageId?: string; // advanceStage (mapped matter_stages.id)
	field?: string; // updateField (allow-listed matters column)
	value?: string | number | boolean | null; // updateField; may be templated
}
export interface IActionLitboxRequestFolder extends IBoardActionBase {
	type: 'litboxRequestFolder';
}
export interface IActionAiGenerate extends IBoardActionBase {
	type: 'aiGenerate';
	kind: 'demand' | 'summary' | 'description';
	prompt?: string; // templated override
	targetFieldId?: string; // where to write the result (else attach to card)
}

export type IAutomationAction =
	| IActionAddLabel
	| IActionRemoveLabel
	| IActionMove
	| IActionSetField
	| IActionAssignMember
	| IActionUnassignMember
	| IActionSetDue
	| IActionCompleteDue
	| IActionSetCover
	| IActionComment
	| IActionCreateCard
	| IActionArchiveCard
	| IActionAddChecklist
	| IActionCreateDeadline
	| IActionCreateTask
	| IActionNotify
	| IActionNotifyEmail
	| IActionNotifySms
	| IActionEnrollSequence
	| IActionStopSequence
	| IActionCaseproWriteback
	| IActionLitboxRequestFolder
	| IActionAiGenerate;

// --- The automation doc ------------------------------------------------------

/** Auto-stop semantics for `kind:'sequence'` (mirror ISequence.stopOn intent). */
export interface IBoardAutomationSequenceOptions {
	stopOnReply?: boolean; // lead lastInboundAt advanced past enrollment
	stopOnStageAdvance?: boolean; // card left the enrollment list
	maxEnrollments?: number;
}

export interface IAutomation extends IRocketChatRecord {
	name: string;
	description?: string;

	boardId?: string; // -> boards_boards._id; null/unset = global (scope:'global')
	scope: BoardAutomationScope;
	kind: BoardAutomationKind;

	trigger?: IBoardAutomationTrigger; // kind:'rule' (event: BoardAutomationTriggerEvent)
	schedule?: IBoardAutomationSchedule; // kind:'scheduled'
	conditions: IBoardCondition[]; // AND-combined gate
	actions: IAutomationAction[]; // ordered; sequence steps carry .delay

	sequence?: IBoardAutomationSequenceOptions; // kind:'sequence'

	icon?: string; // Fuselage icon for buttons (e.g. 'kanban','bell','clock')
	enabled: boolean;
	isSystem?: boolean; // seeded prebuilt template
	/**
	 * Catalog-only seed: a prebuilt template the firm installs/clones onto a board, NOT a
	 * live rule. The dispatcher EXCLUDES `isTemplate` rows from event matching so a global
	 * catalog entry never fires on a board that lacks its referenced list/label/stage ids
	 * (05-automation-engine.md §9). `boards.automations.templates.install` clones it into a
	 * board-scoped, non-template, enabled automation.
	 */
	isTemplate?: boolean;
	seedKey?: string; // stable idempotent seed key (prebuilt templates)

	// rollups
	runCount?: number;
	lastRunAt?: Date;
	lastErrorAt?: Date;
	lastError?: string;

	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
	updatedBy?: IUser['_id'];
	updatedAt: Date;
}
