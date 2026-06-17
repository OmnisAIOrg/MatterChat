import type {
	BoardAutomationActionType,
	BoardAutomationKind,
	BoardAutomationTriggerEvent,
	BoardConditionField,
	BoardConditionOp,
} from '@rocket.chat/core-typings';

/**
 * Client-side metadata catalog for the Automation BUILDER (M7 client).
 *
 * The engine (server) is the source of truth for *executing* triggers / conditions /
 * actions; this catalog is the source of truth for *rendering* the editor. For each
 * trigger event, condition field, and action type it declares:
 *  - a stable i18n label key (all keys reported to Integration), and
 *  - which dynamic param fields the row needs (so the builder can render the right
 *    inputs without a giant switch in the component).
 *
 * Every literal here is a member of the corresponding core-typings union
 * (`IAutomation.ts`), so adding a union arm there surfaces as a TS error here.
 */

// --- Kinds -------------------------------------------------------------------

export type AutomationTab = 'rules' | 'card-buttons' | 'board-buttons' | 'scheduled' | 'sequences' | 'activity';

/** Which automation `kind` each contextualbar tab lists/creates. */
export const TAB_KIND: Record<Exclude<AutomationTab, 'activity'>, BoardAutomationKind> = {
	'rules': 'rule',
	'card-buttons': 'card-button',
	'board-buttons': 'board-button',
	'scheduled': 'scheduled',
	'sequences': 'sequence',
};

export const KIND_LABEL: Record<BoardAutomationKind, string> = {
	'rule': 'Boards_Automation_Rule',
	'card-button': 'Boards_Automation_Card_Button',
	'board-button': 'Boards_Automation_Board_Button',
	'scheduled': 'Boards_Automation_Scheduled',
	'sequence': 'Boards_Automation_Sequence',
};

// --- Field kinds the builder can render --------------------------------------

/**
 * The kinds of dynamic input a trigger-filter / condition / action param maps to.
 * The builder renders each from board context (lists/labels/members) or free text.
 */
export type ParamKind =
	| 'list' // Select of board lists
	| 'label' // Select of board labelDefs
	| 'member' // Select of board members
	| 'field' // Select of board fieldDefs
	| 'playbook' // Select of boards_playbooks
	| 'sequence' // Select of boards_sequences
	| 'template' // Select of boards_comm_templates
	| 'cardType' // Select of card types
	| 'text' // free text (often supports {tokens})
	| 'number' // numeric
	| 'duration' // duration token e.g. '60d','-1d','{now+30d}'
	| 'boolean'; // toggle

export type ParamSpec = {
	/** the key written into the trigger.filters / condition.value-bag / action object */
	key: string;
	labelKey: string;
	kind: ParamKind;
	/** when false the row is still valid without it (default true => required) */
	required?: boolean;
	placeholder?: string;
};

// --- Triggers ----------------------------------------------------------------

export type TriggerSpec = {
	event: BoardAutomationTriggerEvent;
	labelKey: string;
	/** filters this trigger supports (rendered under the event picker) */
	filters: ParamSpec[];
};

/**
 * The rule trigger events offered in the builder. `schedule` is excluded — it is
 * implied by `kind:'scheduled'` and edited via the schedule panel, not as a rule
 * event. Order = grouped by domain (card / matter / lead / dates) for the dropdown.
 */
export const TRIGGERS: TriggerSpec[] = [
	// card lifecycle
	{ event: 'card.created', labelKey: 'Boards_Automation_Trigger_card_created', filters: [{ key: 'listId', labelKey: 'Boards_Automation_Filter_inList', kind: 'list', required: false }] },
	{ event: 'card.moved', labelKey: 'Boards_Automation_Trigger_card_moved', filters: [
		{ key: 'fromListId', labelKey: 'Boards_Automation_Filter_fromList', kind: 'list', required: false },
		{ key: 'toListId', labelKey: 'Boards_Automation_Filter_toList', kind: 'list', required: false },
	] },
	{ event: 'card.archived', labelKey: 'Boards_Automation_Trigger_card_archived', filters: [] },
	{ event: 'card.subStatusChanged', labelKey: 'Boards_Automation_Trigger_card_subStatusChanged', filters: [] },
	{ event: 'card.converted', labelKey: 'Boards_Automation_Trigger_card_converted', filters: [] },
	{ event: 'card.commented', labelKey: 'Boards_Automation_Trigger_card_commented', filters: [] },
	// card-detail mutations
	{ event: 'label.added', labelKey: 'Boards_Automation_Trigger_label_added', filters: [{ key: 'labelId', labelKey: 'Boards_Automation_Filter_label', kind: 'label', required: false }] },
	{ event: 'label.removed', labelKey: 'Boards_Automation_Trigger_label_removed', filters: [{ key: 'labelId', labelKey: 'Boards_Automation_Filter_label', kind: 'label', required: false }] },
	{ event: 'member.added', labelKey: 'Boards_Automation_Trigger_member_added', filters: [{ key: 'userId', labelKey: 'Boards_Automation_Filter_member', kind: 'member', required: false }] },
	{ event: 'member.removed', labelKey: 'Boards_Automation_Trigger_member_removed', filters: [{ key: 'userId', labelKey: 'Boards_Automation_Filter_member', kind: 'member', required: false }] },
	{ event: 'due.set', labelKey: 'Boards_Automation_Trigger_due_set', filters: [] },
	{ event: 'due.completed', labelKey: 'Boards_Automation_Trigger_due_completed', filters: [] },
	{ event: 'checklist.itemChecked', labelKey: 'Boards_Automation_Trigger_checklist_itemChecked', filters: [] },
	{ event: 'checklist.completed', labelKey: 'Boards_Automation_Trigger_checklist_completed', filters: [] },
	{ event: 'field.changed', labelKey: 'Boards_Automation_Trigger_field_changed', filters: [{ key: 'fieldId', labelKey: 'Boards_Automation_Filter_field', kind: 'field', required: false }] },
	// matter domain
	{ event: 'matter.stageChanged', labelKey: 'Boards_Automation_Trigger_matter_stageChanged', filters: [] },
	{ event: 'casepro.stageChanged', labelKey: 'Boards_Automation_Trigger_casepro_stageChanged', filters: [] },
	// lead domain
	{ event: 'lead.captured', labelKey: 'Boards_Automation_Trigger_lead_captured', filters: [{ key: 'source', labelKey: 'Boards_Automation_Filter_source', kind: 'text', required: false }] },
	{ event: 'lead.statusChanged', labelKey: 'Boards_Automation_Trigger_lead_statusChanged', filters: [{ key: 'statusId', labelKey: 'Boards_Automation_Filter_toList', kind: 'list', required: false }] },
	{ event: 'lead.qualified', labelKey: 'Boards_Automation_Trigger_lead_qualified', filters: [] },
	{ event: 'lead.disqualified', labelKey: 'Boards_Automation_Trigger_lead_disqualified', filters: [] },
	{ event: 'lead.lost', labelKey: 'Boards_Automation_Trigger_lead_lost', filters: [] },
	{ event: 'lead.converted', labelKey: 'Boards_Automation_Trigger_lead_converted', filters: [] },
	{ event: 'lead.contacted', labelKey: 'Boards_Automation_Trigger_lead_contacted', filters: [] },
	{ event: 'lead.responded', labelKey: 'Boards_Automation_Trigger_lead_responded', filters: [] },
	{ event: 'lead.noContact', labelKey: 'Boards_Automation_Trigger_lead_noContact', filters: [{ key: 'offset', labelKey: 'Boards_Automation_Filter_after', kind: 'duration', required: false, placeholder: '24h' }] },
	// deadlines / card dates (cron-synthesized)
	{ event: 'deadline.created', labelKey: 'Boards_Automation_Trigger_deadline_created', filters: [] },
	{ event: 'deadline.due', labelKey: 'Boards_Automation_Trigger_deadline_due', filters: [] },
	{ event: 'deadline.acknowledged', labelKey: 'Boards_Automation_Trigger_deadline_acknowledged', filters: [] },
	{ event: 'card.dueSoon', labelKey: 'Boards_Automation_Trigger_card_dueSoon', filters: [{ key: 'offset', labelKey: 'Boards_Automation_Filter_before', kind: 'duration', required: false, placeholder: '-1d' }] },
	{ event: 'card.overdue', labelKey: 'Boards_Automation_Trigger_card_overdue', filters: [] },
];

export const TRIGGER_BY_EVENT: Record<string, TriggerSpec> = Object.fromEntries(TRIGGERS.map((tr) => [tr.event, tr]));

// --- Conditions --------------------------------------------------------------

export type ConditionFieldSpec = {
	field: BoardConditionField;
	labelKey: string;
	ops: BoardConditionOp[];
	/** how to render the value input for this field */
	valueKind: ParamKind;
	/** when true the field carries no value (e.g. due 'set'/'unset') for those ops */
	valuelessOps?: BoardConditionOp[];
	placeholder?: string;
};

export const CONDITION_OP_LABEL: Record<BoardConditionOp, string> = {
	is: 'Boards_Automation_Op_is',
	isNot: 'Boards_Automation_Op_isNot',
	has: 'Boards_Automation_Op_has',
	lacks: 'Boards_Automation_Op_lacks',
	contains: 'Boards_Automation_Op_contains',
	none: 'Boards_Automation_Op_none',
	set: 'Boards_Automation_Op_set',
	unset: 'Boards_Automation_Op_unset',
	within: 'Boards_Automation_Op_within',
	over: 'Boards_Automation_Op_over',
	eq: 'Boards_Automation_Op_eq',
	neq: 'Boards_Automation_Op_neq',
	gt: 'Boards_Automation_Op_gt',
	lt: 'Boards_Automation_Op_lt',
	empty: 'Boards_Automation_Op_empty',
};

/**
 * The condition fields offered in the builder. `field:<id>` (custom field) is handled
 * specially in the component (the field id is picked from a Select of board fieldDefs,
 * then composed into the `field:` prefix). The static fields below cover the rest.
 */
export const CONDITION_FIELDS: ConditionFieldSpec[] = [
	{ field: 'list', labelKey: 'Boards_Automation_Cond_list', ops: ['is', 'isNot'], valueKind: 'list' },
	{ field: 'label', labelKey: 'Boards_Automation_Cond_label', ops: ['has', 'lacks'], valueKind: 'label' },
	{ field: 'assignee', labelKey: 'Boards_Automation_Cond_assignee', ops: ['is', 'contains', 'none'], valueKind: 'member', valuelessOps: ['none'] },
	{ field: 'cardType', labelKey: 'Boards_Automation_Cond_cardType', ops: ['is', 'isNot'], valueKind: 'cardType' },
	{ field: 'subStatus', labelKey: 'Boards_Automation_Cond_subStatus', ops: ['is', 'isNot'], valueKind: 'text' },
	{ field: 'due', labelKey: 'Boards_Automation_Cond_due', ops: ['set', 'unset', 'within', 'over'], valueKind: 'duration', valuelessOps: ['set', 'unset'], placeholder: '7d' },
	{ field: 'sol', labelKey: 'Boards_Automation_Cond_sol', ops: ['within', 'over'], valueKind: 'duration', placeholder: '90d' },
	{ field: 'daysInStage', labelKey: 'Boards_Automation_Cond_daysInStage', ops: ['gt', 'lt'], valueKind: 'number', placeholder: '30' },
	{ field: 'lead.source', labelKey: 'Boards_Automation_Cond_lead_source', ops: ['is', 'isNot'], valueKind: 'text' },
	{ field: 'lead.score', labelKey: 'Boards_Automation_Cond_lead_score', ops: ['gt', 'lt', 'eq'], valueKind: 'number', placeholder: '70' },
	{ field: 'lead.qualified', labelKey: 'Boards_Automation_Cond_lead_qualified', ops: ['is'], valueKind: 'boolean' },
];

/** Ops for a `field:<id>` custom-field condition. */
export const CUSTOM_FIELD_OPS: BoardConditionOp[] = ['eq', 'neq', 'gt', 'lt', 'contains', 'empty'];

// --- Actions -----------------------------------------------------------------

export type ActionSpec = {
	type: BoardAutomationActionType;
	labelKey: string;
	params: ParamSpec[];
	/** P3 / gated actions get a warning chip in the editor */
	gated?: boolean;
};

/**
 * The action types offered in the builder, mirroring the `IAutomationAction` union.
 * `params` declare exactly the fields each action arm carries (matching the
 * discriminated-union member in core-typings, e.g. IActionMove has toListId+position).
 */
export const ACTIONS: ActionSpec[] = [
	// card
	{ type: 'addLabel', labelKey: 'Boards_Automation_Action_addLabel', params: [{ key: 'labelId', labelKey: 'Boards_Automation_Cond_label', kind: 'label' }] },
	{ type: 'removeLabel', labelKey: 'Boards_Automation_Action_removeLabel', params: [{ key: 'labelId', labelKey: 'Boards_Automation_Cond_label', kind: 'label' }] },
	{ type: 'move', labelKey: 'Boards_Automation_Action_move', params: [
		{ key: 'toListId', labelKey: 'Boards_Automation_Filter_toList', kind: 'list' },
		{ key: 'subStatus', labelKey: 'Boards_Automation_Cond_subStatus', kind: 'text', required: false },
	] },
	{ type: 'setField', labelKey: 'Boards_Automation_Action_setField', params: [
		{ key: 'fieldId', labelKey: 'Boards_Automation_Filter_field', kind: 'field' },
		{ key: 'value', labelKey: 'Boards_Automation_Value', kind: 'text' },
	] },
	{ type: 'assignMember', labelKey: 'Boards_Automation_Action_assignMember', params: [
		{ key: 'userId', labelKey: 'Boards_Automation_Filter_member', kind: 'member', required: false },
		{ key: 'roundRobin', labelKey: 'Boards_Automation_RoundRobin', kind: 'boolean', required: false },
	] },
	{ type: 'unassignMember', labelKey: 'Boards_Automation_Action_unassignMember', params: [{ key: 'userId', labelKey: 'Boards_Automation_Filter_member', kind: 'member' }] },
	{ type: 'setDue', labelKey: 'Boards_Automation_Action_setDue', params: [{ key: 'due', labelKey: 'Boards_Automation_Due', kind: 'duration', placeholder: '{now+30d}' }] },
	{ type: 'completeDue', labelKey: 'Boards_Automation_Action_completeDue', params: [] },
	{ type: 'comment', labelKey: 'Boards_Automation_Action_comment', params: [
		{ key: 'body', labelKey: 'Boards_Automation_Message', kind: 'text', placeholder: 'Demand sent {now}' },
		{ key: 'alsoPostToRoom', labelKey: 'Boards_Automation_AlsoPostToRoom', kind: 'boolean', required: false },
	] },
	{ type: 'createCard', labelKey: 'Boards_Automation_Action_createCard', params: [
		{ key: 'listId', labelKey: 'Boards_Automation_Filter_inList', kind: 'list' },
		{ key: 'title', labelKey: 'Title', kind: 'text', placeholder: 'Follow up with {card.title}' },
	] },
	{ type: 'archiveCard', labelKey: 'Boards_Automation_Action_archiveCard', params: [] },
	{ type: 'addChecklist', labelKey: 'Boards_Automation_Action_addChecklist', params: [
		{ key: 'playbookId', labelKey: 'Boards_Automation_Playbook', kind: 'playbook', required: false },
		{ key: 'title', labelKey: 'Title', kind: 'text', required: false },
	] },
	// matter depth
	{ type: 'createDeadline', labelKey: 'Boards_Automation_Action_createDeadline', params: [
		{ key: 'kind', labelKey: 'Boards_Automation_DeadlineKind', kind: 'text', placeholder: 'sol | statute | court | task | custom' },
		{ key: 'label', labelKey: 'Boards_Automation_Label', kind: 'text', required: false },
		{ key: 'due', labelKey: 'Boards_Automation_Due', kind: 'duration', placeholder: '{now+30d}' },
	] },
	{ type: 'createTask', labelKey: 'Boards_Automation_Action_createTask', params: [
		{ key: 'title', labelKey: 'Title', kind: 'text', placeholder: 'Order records for {card.title}' },
		{ key: 'assigneeRole', labelKey: 'Boards_Automation_AssigneeRole', kind: 'text', required: false, placeholder: 'paralegal' },
		{ key: 'dueOffsetDays', labelKey: 'Boards_Automation_DueOffsetDays', kind: 'number', required: false },
	] },
	// notify / communicate
	{ type: 'notify', labelKey: 'Boards_Automation_Action_notify', params: [
		{ key: 'target', labelKey: 'Boards_Automation_NotifyTarget', kind: 'text', placeholder: 'owner | assignees | watchers | user' },
		{ key: 'userId', labelKey: 'Boards_Automation_Filter_member', kind: 'member', required: false },
		{ key: 'message', labelKey: 'Boards_Automation_Message', kind: 'text' },
	] },
	{ type: 'notifyEmail', labelKey: 'Boards_Automation_Action_notifyEmail', params: [
		{ key: 'templateId', labelKey: 'Boards_Automation_Template', kind: 'template', required: false },
		{ key: 'subject', labelKey: 'Subject', kind: 'text', required: false },
		{ key: 'body', labelKey: 'Boards_Automation_Message', kind: 'text', required: false },
	] },
	{ type: 'notifySms', labelKey: 'Boards_Automation_Action_notifySms', gated: true, params: [
		{ key: 'templateId', labelKey: 'Boards_Automation_Template', kind: 'template', required: false },
		{ key: 'body', labelKey: 'Boards_Automation_Message', kind: 'text', required: false },
	] },
	{ type: 'enrollSequence', labelKey: 'Boards_Automation_Action_enrollSequence', params: [{ key: 'sequenceId', labelKey: 'Boards_Automation_Sequence', kind: 'sequence' }] },
	{ type: 'stopSequence', labelKey: 'Boards_Automation_Action_stopSequence', params: [{ key: 'sequenceId', labelKey: 'Boards_Automation_Sequence', kind: 'sequence', required: false }] },
	// integration (P3, gated)
	{ type: 'caseproWriteback', labelKey: 'Boards_Automation_Action_caseproWriteback', gated: true, params: [
		{ key: 'operation', labelKey: 'Boards_Automation_CaseproOperation', kind: 'text', placeholder: 'advanceStage | updateField' },
		{ key: 'stageId', labelKey: 'Boards_Automation_StageId', kind: 'text', required: false },
		{ key: 'field', labelKey: 'Boards_Automation_Filter_field', kind: 'text', required: false },
		{ key: 'value', labelKey: 'Boards_Automation_Value', kind: 'text', required: false },
	] },
	{ type: 'litboxRequestFolder', labelKey: 'Boards_Automation_Action_litboxRequestFolder', gated: true, params: [] },
	{ type: 'aiGenerate', labelKey: 'Boards_Automation_Action_aiGenerate', gated: true, params: [
		{ key: 'kind', labelKey: 'Boards_Automation_AiKind', kind: 'text', placeholder: 'demand | summary | description' },
		{ key: 'prompt', labelKey: 'Boards_Automation_Prompt', kind: 'text', required: false },
		{ key: 'targetFieldId', labelKey: 'Boards_Automation_Filter_field', kind: 'field', required: false },
	] },
];

export const ACTION_BY_TYPE: Record<string, ActionSpec> = Object.fromEntries(ACTIONS.map((a) => [a.type, a]));

/** Card types for the cardType condition Select. */
export const CARD_TYPES = ['task', 'matter', 'lead', 'document', 'evidence'] as const;

/** Interpolation tokens offered in the "insert token" menu of templated text fields. */
export const TOKENS: { token: string; labelKey: string }[] = [
	{ token: '{card.title}', labelKey: 'Boards_Automation_Token_cardTitle' },
	{ token: '{card.url}', labelKey: 'Boards_Automation_Token_cardUrl' },
	{ token: '{card.due}', labelKey: 'Boards_Automation_Token_cardDue' },
	{ token: '{board.name}', labelKey: 'Boards_Automation_Token_boardName' },
	{ token: '{me}', labelKey: 'Boards_Automation_Token_me' },
	{ token: '{now}', labelKey: 'Boards_Automation_Token_now' },
	{ token: '{now+30d}', labelKey: 'Boards_Automation_Token_nowPlus' },
	{ token: '{lead.firstName}', labelKey: 'Boards_Automation_Token_leadFirstName' },
	{ token: '{lead.source}', labelKey: 'Boards_Automation_Token_leadSource' },
	{ token: '{matter.clientName}', labelKey: 'Boards_Automation_Token_matterClientName' },
	{ token: '{matter.solDate}', labelKey: 'Boards_Automation_Token_matterSolDate' },
	{ token: '{matter.demandAmount}', labelKey: 'Boards_Automation_Token_matterDemandAmount' },
	{ token: '{matter.stage}', labelKey: 'Boards_Automation_Token_matterStage' },
];

// --- Schedule cadences -------------------------------------------------------

export const SCHEDULE_KINDS = ['every', 'at', 'cron'] as const;
export const SCHEDULE_CADENCES = ['daily', 'weekday', 'weekly'] as const;
export const DOW_LABELS = [
	'Boards_Automation_Dow_0',
	'Boards_Automation_Dow_1',
	'Boards_Automation_Dow_2',
	'Boards_Automation_Dow_3',
	'Boards_Automation_Dow_4',
	'Boards_Automation_Dow_5',
	'Boards_Automation_Dow_6',
];
