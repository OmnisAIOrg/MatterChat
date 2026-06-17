import type { IAutomation, Serialized } from '@rocket.chat/core-typings';

import { ACTION_BY_TYPE, TRIGGER_BY_EVENT } from './catalog';
import type { ActionDraft, AutomationDraft, ConditionDraft } from './types';

/**
 * Builder <-> wire serialization for automations.
 *
 * `toDraft` hydrates the editor from a saved (serialized) automation; `toBody`
 * collapses the editor draft into the create/update body the permissive REST
 * endpoint accepts. We strip empty/optional params so the stored doc stays clean
 * and the engine's discriminated-union narrowing (on `type`/`event`) sees only the
 * keys that action/trigger actually carries.
 */

const PARAM_TRUE = (v: unknown): boolean => v === true || v === 'true';

/** A transient client-only stable key for condition/action list rows. */
export const rowKey = (): string => `row_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

/** Build an empty draft for a new automation of the given kind. */
export const emptyDraft = (kind: AutomationDraft['kind'], boardId?: string): AutomationDraft => ({
	name: '',
	boardId,
	kind,
	enabled: false,
	triggerFilters: {},
	conditions: [],
	actions: [],
	...(kind === 'scheduled' ? { schedule: { kind: 'every', cadence: 'daily', hour: 8, minute: 0 } } : {}),
	...(kind === 'sequence' ? { sequence: { stopOnReply: true, stopOnStageAdvance: true } } : {}),
});

/** Hydrate the editor from a saved automation (serialized over the wire). */
export const toDraft = (a: Serialized<IAutomation>): AutomationDraft => ({
	_id: a._id,
	name: a.name,
	description: a.description,
	boardId: a.boardId,
	kind: a.kind,
	icon: a.icon,
	enabled: a.enabled,
	triggerEvent: a.trigger?.event,
	triggerFilters: { ...(a.trigger?.filters ?? {}) } as Record<string, unknown>,
	schedule: a.schedule
		? {
				kind: a.schedule.kind,
				cadence: a.schedule.cadence,
				dayOfWeek: a.schedule.dayOfWeek,
				hour: a.schedule.hour,
				minute: a.schedule.minute,
				at: a.schedule.at,
				cron: a.schedule.cron,
			}
		: undefined,
	conditions: (a.conditions ?? []).map((c) => ({ _key: rowKey(), field: c.field, op: c.op, value: c.value })),
	actions: (a.actions ?? []).map((act) => ({ _key: rowKey(), ...act }) as ActionDraft),
	sequence: a.sequence ? { ...a.sequence } : undefined,
});

/** Drop empty-string / undefined params off an action draft, coercing typed params. */
const cleanAction = (draft: ActionDraft): Record<string, unknown> => {
	const spec = ACTION_BY_TYPE[draft.type];
	const out: Record<string, unknown> = { type: draft.type };
	if (draft.delay) {
		out.delay = draft.delay;
	}
	if (draft.critical) {
		out.critical = true;
	}
	for (const p of spec?.params ?? []) {
		const raw = draft[p.key];
		if (raw === undefined || raw === '' || raw === null) {
			continue;
		}
		if (p.kind === 'number') {
			const n = Number(raw);
			if (!Number.isNaN(n)) {
				out[p.key] = n;
			}
			continue;
		}
		if (p.kind === 'boolean') {
			if (PARAM_TRUE(raw)) {
				out[p.key] = true;
			}
			continue;
		}
		out[p.key] = raw;
	}
	return out;
};

/** Drop a condition whose value is empty for value-bearing ops. */
const cleanCondition = (c: ConditionDraft): Record<string, unknown> => {
	const out: Record<string, unknown> = { field: c.field, op: c.op };
	if (c.value !== undefined && c.value !== '' && c.value !== null) {
		out.value = c.value;
	}
	return out;
};

/** Drop empty filter keys; keep only filters the chosen trigger actually supports. */
const cleanFilters = (event: string | undefined, filters: Record<string, unknown>): Record<string, unknown> | undefined => {
	if (!event) {
		return undefined;
	}
	const spec = TRIGGER_BY_EVENT[event];
	const out: Record<string, unknown> = {};
	for (const f of spec?.filters ?? []) {
		const raw = filters[f.key];
		if (raw !== undefined && raw !== '' && raw !== null) {
			out[f.key] = raw;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * Collapse the editor draft into the create/update body. The result is shaped like
 * an (unsaved) IAutomation minus server-owned fields — exactly what create accepts
 * and what dryRun's inline-automation path expects.
 */
export const toBody = (draft: AutomationDraft): Record<string, unknown> => {
	const body: Record<string, unknown> = {
		name: draft.name.trim(),
		kind: draft.kind,
		enabled: draft.enabled,
		conditions: draft.conditions.map(cleanCondition),
		actions: draft.actions.map(cleanAction),
	};
	if (draft.boardId) {
		body.boardId = draft.boardId;
	}
	if (draft.description?.trim()) {
		body.description = draft.description.trim();
	}
	if (draft.icon) {
		body.icon = draft.icon;
	}
	if (draft.kind === 'rule' && draft.triggerEvent) {
		const filters = cleanFilters(draft.triggerEvent, draft.triggerFilters);
		body.trigger = { event: draft.triggerEvent, ...(filters ? { filters } : {}) };
	}
	if (draft.kind === 'scheduled' && draft.schedule) {
		body.schedule = draft.schedule;
	}
	if (draft.kind === 'sequence' && draft.sequence) {
		body.sequence = draft.sequence;
	}
	return body;
};

/** Whether a draft has the minimum to be saved (name + a trigger/schedule per kind). */
export const isDraftValid = (draft: AutomationDraft): boolean => {
	if (!draft.name.trim()) {
		return false;
	}
	if (draft.kind === 'rule' && !draft.triggerEvent) {
		return false;
	}
	if (draft.kind === 'scheduled' && !draft.schedule) {
		return false;
	}
	if (draft.actions.length === 0) {
		return false;
	}
	return true;
};
