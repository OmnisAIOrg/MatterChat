import type { IBoardCondition, IBoardCard, ILead, IMatterSnapshot, BoardConditionOp } from '@rocket.chat/core-typings';
import { BoardsActivities } from '@rocket.chat/models';

import type { AutomationSubject } from './context';

/**
 * Condition evaluation (M7 — 05-automation-engine.md §5.2). A `kind:'rule'` /
 * scheduled automation runs its actions only when ALL conditions pass (AND-combined).
 * Every condition reads from the already-resolved {@link AutomationSubject} (card /
 * lead / matter snapshot) so a tick never re-loads the subject per condition.
 *
 * Never throws: an unevaluable condition (missing field, bad value) returns `false`
 * (fail-closed — an automation that can't prove its gate simply doesn't fire), and the
 * one async source (`daysInStage`, derived from the activity feed) degrades to 0.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a duration value like '60d','2h','30m','3w' (number => days) into ms; null if unparseable. */
function durationMs(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value * DAY_MS; // bare number = days
	}
	if (typeof value !== 'string') {
		return null;
	}
	const m = /^(\d+)\s*([mhdw])$/.exec(value.trim());
	if (!m) {
		const n = Number(value);
		return Number.isFinite(n) ? n * DAY_MS : null;
	}
	const n = Number(m[1]);
	const unit = { m: 60 * 1000, h: 60 * 60 * 1000, d: DAY_MS, w: 7 * DAY_MS }[m[2]] ?? DAY_MS;
	return n * unit;
}

function toNum(v: unknown): number | null {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Generic comparator used by the value-bearing ops (eq/neq/gt/lt/contains/empty). */
function compareScalar(op: BoardConditionOp, actual: unknown, expected: unknown): boolean {
	switch (op) {
		case 'eq':
		case 'is':
			return String(actual ?? '') === String(expected ?? '');
		case 'neq':
		case 'isNot':
			return String(actual ?? '') !== String(expected ?? '');
		case 'gt': {
			const a = toNum(actual);
			const b = toNum(expected);
			return a !== null && b !== null && a > b;
		}
		case 'lt': {
			const a = toNum(actual);
			const b = toNum(expected);
			return a !== null && b !== null && a < b;
		}
		case 'contains':
			return String(actual ?? '')
				.toLowerCase()
				.includes(String(expected ?? '').toLowerCase());
		case 'empty':
			return actual === undefined || actual === null || String(actual) === '';
		case 'set':
			return actual !== undefined && actual !== null && String(actual) !== '';
		case 'unset':
			return actual === undefined || actual === null || String(actual) === '';
		default:
			return false;
	}
}

/** Days the card has spent in its current list, from the most recent `card.moved` into it (else createdAt). */
async function daysInStage(card: IBoardCard, now: Date): Promise<number> {
	let since: Date = card.createdAt;
	try {
		const activities = await BoardsActivities.findByCard(card._id, { limit: 50 }).toArray();
		const lastMove = activities.find((a) => a.verb === 'card.moved' && (a.to as { listId?: string } | undefined)?.listId === card.listId);
		if (lastMove?.ts) {
			since = lastMove.ts;
		}
	} catch {
		// degrade to createdAt — never throw out of condition eval.
	}
	return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS));
}

/** Evaluate the date-window ops (within/over/set/unset) against a date field. */
function evalDateField(op: BoardConditionOp, date: Date | undefined, value: unknown, now: Date): boolean {
	if (op === 'set') {
		return Boolean(date);
	}
	if (op === 'unset') {
		return !date;
	}
	if (!date) {
		return false;
	}
	const span = durationMs(value);
	if (span === null) {
		return false;
	}
	const diff = new Date(date).getTime() - now.getTime();
	if (op === 'within') {
		// due within the next <span> (and not already long past): 0 <= diff <= span OR overdue within span.
		return diff <= span;
	}
	if (op === 'over') {
		// more than <span> away (or, for age-style fields, older than) — diff beyond the span.
		return diff > span;
	}
	return false;
}

/**
 * Evaluate ONE condition against the subject. The condition `field` selects the source;
 * `op` + `value` decide the test. Returns a promise because `daysInStage` reads the
 * activity feed; all other fields resolve synchronously.
 */
export async function evaluateCondition(cond: IBoardCondition, subject: AutomationSubject, now: Date = new Date()): Promise<boolean> {
	const { card, lead, snapshot } = subject;
	const { field, op, value } = cond;

	// custom field by id: field:<id>
	if (field.startsWith('field:')) {
		const fieldId = field.slice('field:'.length);
		return compareScalar(op, card?.fieldValues?.[fieldId], value);
	}

	switch (field) {
		case 'list':
			return compareScalar(op === 'is' || op === 'isNot' ? op : 'is', card?.listId, value);
		case 'label': {
			const labels = card?.labels ?? [];
			const has = labels.includes(String(value));
			if (op === 'has') {
				return has;
			}
			if (op === 'lacks') {
				return !has;
			}
			return false;
		}
		case 'assignee': {
			const assignees = card?.assignees ?? [];
			if (op === 'none') {
				return assignees.length === 0;
			}
			if (op === 'has' || op === 'contains' || op === 'is') {
				return assignees.includes(String(value));
			}
			if (op === 'lacks' || op === 'isNot') {
				return !assignees.includes(String(value));
			}
			return false;
		}
		case 'cardType':
			return compareScalar(op === 'isNot' ? 'isNot' : 'is', card?.cardType, value);
		case 'subStatus':
			return compareScalar(op === 'isNot' ? 'isNot' : 'is', card?.subStatus, value);
		case 'pipelineType':
			// board pipeline isn't on the card; treat the card's matter/lead link as the proxy.
			return compareScalar(op === 'isNot' ? 'isNot' : 'is', card?.cardType, value);
		case 'due':
			return evalDateField(op, card?.dueDate, value, now);
		case 'sol':
			// CasePro statute_of_limitations carried on the matter snapshot (M2 contract).
			return evalDateField(op, snapshot?.solDate ? new Date(snapshot.solDate) : undefined, value, now);
		case 'daysInStage': {
			if (!card) {
				return false;
			}
			const days = await daysInStage(card, now);
			return compareScalar(op, days, value);
		}
		case 'lead.source':
			return compareScalar(op === 'isNot' ? 'isNot' : 'is', lead?.attribution?.source, value);
		case 'lead.score':
			return compareScalar(op, lead?.qualification?.score, value);
		case 'lead.qualified':
			return compareScalar(op === 'isNot' ? 'isNot' : 'is', Boolean(lead?.qualification?.qualified), value);
		default:
			return false;
	}
}

/**
 * Evaluate the full AND-combined gate. Short-circuits on the first failing condition.
 * An empty conditions[] always passes (an unconditional rule/button). Re-checked by the
 * runner just before action execution, since board state may have changed since enqueue.
 */
export async function evaluateConditions(
	conditions: IBoardCondition[] | undefined,
	subject: AutomationSubject,
	now: Date = new Date(),
): Promise<boolean> {
	if (!conditions || conditions.length === 0) {
		return true;
	}
	for (const cond of conditions) {
		// eslint-disable-next-line no-await-in-loop
		if (!(await evaluateCondition(cond, subject, now))) {
			return false;
		}
	}
	return true;
}

/** Re-export the subject type for handler convenience. */
export type { ILead, IBoardCard, IMatterSnapshot };
