import type {
	BoardAutomationKind,
	BoardAutomationScheduleKind,
	BoardAutomationTriggerEvent,
	BoardConditionField,
	BoardConditionOp,
	IAutomationAction,
} from '@rocket.chat/core-typings';

/**
 * Editor-side draft shapes for the Automation BUILDER.
 *
 * These are deliberately *looser* than the strict core-typings unions: the builder
 * holds work-in-progress values (e.g. an action whose required fields are not yet
 * filled), so an action draft is `{ type } & Record<string,unknown>`. On save the
 * draft is serialized straight into the automation body; the engine validates the
 * final shape (the REST body is permissive — see boards-automations.ts).
 */

export type ConditionDraft = {
	/** transient client-only stable key for list rendering (stripped on serialize) */
	_key?: string;
	field: BoardConditionField;
	op: BoardConditionOp;
	value?: unknown;
};

export type ActionDraft = {
	/** transient client-only stable key for list rendering (stripped on serialize) */
	_key?: string;
	type: IAutomationAction['type'];
	delay?: string;
	critical?: boolean;
	[key: string]: unknown;
};

export type ScheduleDraft = {
	kind: BoardAutomationScheduleKind;
	cadence?: 'daily' | 'weekday' | 'weekly';
	dayOfWeek?: number;
	hour?: number;
	minute?: number;
	at?: string;
	cron?: string;
};

/** The whole automation as the builder edits it. */
export type AutomationDraft = {
	_id?: string;
	name: string;
	description?: string;
	boardId?: string;
	kind: BoardAutomationKind;
	icon?: string;
	enabled: boolean;
	triggerEvent?: BoardAutomationTriggerEvent;
	triggerFilters: Record<string, unknown>;
	schedule?: ScheduleDraft;
	conditions: ConditionDraft[];
	actions: ActionDraft[];
	sequence?: {
		stopOnReply?: boolean;
		stopOnStageAdvance?: boolean;
		maxEnrollments?: number;
	};
};

/** Picker options resolved from board context for the builder Selects. */
export type BoardContextOptions = {
	lists: { value: string; label: string }[];
	labels: { value: string; label: string }[];
	members: { value: string; label: string }[];
	fields: { value: string; label: string }[];
};
