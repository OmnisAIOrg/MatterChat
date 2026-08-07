import type { IAutomation, IBoardAutomationSchedule } from '@rocket.chat/core-typings';
import { Boards, BoardsAutomations, BoardsCards, BoardsDeadlines, BoardsLeads, BoardsSequenceEnrollments } from '@rocket.chat/models';

import { settings } from '../../settings';
import { advanceEnrollment } from '../../lib/boards/leads/sequences';
import { SystemLogger } from '../../lib/logger/system';
import type { AutomationContext, AutomationSubject } from './context';
import { rootLoopState } from './context';
import { evaluateConditions } from './conditions';
import { dispatchEvent } from './dispatcher';
import { runAutomation } from './runner';
import { enqueue } from './queue';

/**
 * The cron tick body (M7 — 05-automation-engine.md §7). One master tick per minute drives
 * three things, each indexed + best-effort so the tick stays cheap and never throws:
 *
 *  1. Scheduled automations — `kind:'scheduled'` whose `schedule` is due THIS minute (firm
 *     tz via `Boards_Automation_Timezone`); for each, the matching board's cards/leads are
 *     iterated and the actions run per subject. Covers Cold-lead (weekday 8am), SOL watch
 *     (daily), Stuck-matter (weekly).
 *  2. Synthesized time triggers — `card.dueSoon` (due − offset lands this minute),
 *     `card.overdue` (dueDate lands this minute), `deadline.due` (a tracked deadline's
 *     reminder window) → dispatched into the normal rule engine. Crossing-minute firing is
 *     the idempotency story (each fires exactly once as the boundary passes).
 *  3. Drip sequence steps — due `boards_sequence_enrollments` advanced via the EXISTING M6
 *     `advanceEnrollment` (NO drip logic re-implemented here).
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function timezone(): string {
	try {
		return String(settings.get('Boards_Automation_Timezone') || 'America/Chicago');
	} catch {
		return 'America/Chicago';
	}
}

/** Wall-clock fields for `now` in the firm timezone (hour/minute/day-of-week). */
function firmWallClock(now: Date): { hour: number; minute: number; dayOfWeek: number } {
	const tz = timezone();
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			weekday: 'short',
			hour12: false,
		}).formatToParts(now);
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
		const hour = Number(get('hour')) % 24;
		const minute = Number(get('minute'));
		const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
		const dayOfWeek = wdMap[get('weekday')] ?? now.getUTCDay();
		return { hour, minute, dayOfWeek };
	} catch {
		return { hour: now.getUTCHours(), minute: now.getUTCMinutes(), dayOfWeek: now.getUTCDay() };
	}
}

/**
 * Whether a schedule is due in the minute containing `now`. 'every' matches the firm-tz
 * cadence + time-of-day; 'at' matches the single absolute instant's minute; 'cron' matches
 * a 5-field expression's minute/hour/day-of-week fields (the subset used by the seeds).
 */
export function isScheduleDue(schedule: IBoardAutomationSchedule | undefined, now: Date): boolean {
	if (!schedule) {
		return false;
	}
	if (schedule.kind === 'at') {
		if (!schedule.at) {
			return false;
		}
		const at = new Date(schedule.at).getTime();
		return at >= now.getTime() - MINUTE_MS && at < now.getTime();
	}

	const wall = firmWallClock(now);

	if (schedule.kind === 'cron') {
		return matchesCron(schedule.cron, wall);
	}

	// 'every': cadence + hour/minute (+ dayOfWeek for weekly).
	const hour = schedule.hour ?? 0;
	const minute = schedule.minute ?? 0;
	if (wall.hour !== hour || wall.minute !== minute) {
		return false;
	}
	switch (schedule.cadence) {
		case 'daily':
			return true;
		case 'weekday':
			return wall.dayOfWeek >= 1 && wall.dayOfWeek <= 5;
		case 'weekly':
			return wall.dayOfWeek === (schedule.dayOfWeek ?? 1);
		default:
			return true;
	}
}

/** Minimal 5-field cron match (minute hour dom month dow) on minute/hour/dow; `*` wildcards. */
function matchesCron(cron: string | undefined, wall: { hour: number; minute: number; dayOfWeek: number }): boolean {
	if (!cron) {
		return false;
	}
	const f = cron.trim().split(/\s+/);
	if (f.length < 5) {
		return false;
	}
	const field = (spec: string, value: number): boolean => spec === '*' || spec.split(',').map(Number).includes(value);
	return field(f[0], wall.minute) && field(f[1], wall.hour) && field(f[4], wall.dayOfWeek);
}

/**
 * Run one scheduled automation: iterate the candidate cards on its board (matter/lead
 * cards), evaluate its conditions per card, and run its actions for those that pass. A
 * board-less (global) scheduled automation sweeps all non-archived boards. Best-effort per
 * subject; serialized on each card's board chain.
 */
async function runScheduledAutomation(automation: IAutomation, now: Date): Promise<void> {
	const boards = automation.boardId ? [automation.boardId] : await allActiveBoardIds();
	for (const boardId of boards) {
		// eslint-disable-next-line no-await-in-loop
		const cards = await BoardsCards.findByBoard(boardId).toArray();
		for (const card of cards) {
			if (card.archived) {
				continue;
			}
			// load the linked lead for lead cards so lead-domain conditions/tokens resolve.
			const lead = card.link?.kind === 'lead' ? await BoardsLeads.findOneById(card.link.leadId) : null;
			const subject: AutomationSubject = {
				boardId,
				card,
				...(lead ? { lead } : {}),
				...(card.link?.kind === 'matter' && card.link.snapshot ? { snapshot: card.link.snapshot } : {}),
			};
			// eslint-disable-next-line no-await-in-loop
			const pass = await evaluateConditions(automation.conditions, subject, now);
			if (!pass) {
				continue;
			}
			const ctx: AutomationContext = {
				automation,
				boardId,
				event: 'schedule',
				subject,
				actor: 'system',
				dryRun: false,
				loop: rootLoopState(),
			};
			void enqueue(boardId, () => runAutomation(automation, ctx).then(() => undefined));
		}
	}
}

async function allActiveBoardIds(): Promise<string[]> {
	try {
		const boards = await Boards.find({ archived: { $ne: true } }, { projection: { _id: 1 } }).toArray();
		return boards.map((b) => b._id);
	} catch {
		return [];
	}
}

/** 1. Run all scheduled automations due this minute. */
async function tickScheduledAutomations(now: Date): Promise<void> {
	const scheduled = await BoardsAutomations.findEnabledScheduled().toArray();
	for (const automation of scheduled) {
		if (!isScheduleDue(automation.schedule, now)) {
			continue;
		}
		try {
			// eslint-disable-next-line no-await-in-loop
			await runScheduledAutomation(automation, now);
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.automation.scheduled.failed', automationId: automation._id, err });
		}
	}
}

/**
 * 2. Synthesize the cron-only time events and dispatch them into the rule engine:
 *  - card.dueSoon : (dueDate − default 1d offset) lands in this minute, not complete.
 *  - card.overdue : dueDate lands in this minute, not complete.
 *  - deadline.due : a tracked deadline whose reminder is due this tick.
 *
 * Crossing-minute firing keeps it idempotent (each card/deadline crosses each boundary
 * once). The default dueSoon lead is 1 day; a rule can still scope tighter via conditions.
 */
async function tickSynthesizedEvents(now: Date): Promise<void> {
	const windowStart = new Date(now.getTime() - MINUTE_MS);

	// card.overdue — dueDate crossed in the last minute.
	try {
		const overdue = await BoardsCards.findDueBetween(windowStart, now).toArray();
		for (const card of overdue) {
			if (card.archived || card.dueComplete) {
				continue;
			}
			// eslint-disable-next-line no-await-in-loop
			await dispatchEvent(card.boardId, 'card.overdue', { boardId: card.boardId, cardId: card._id, actor: 'system' });
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.synth.overdue.failed', err });
	}

	// card.dueSoon — (dueDate − 1d) crossed in the last minute.
	try {
		const soonFrom = new Date(windowStart.getTime() + DAY_MS);
		const soonTo = new Date(now.getTime() + DAY_MS);
		const dueSoon = await BoardsCards.findDueBetween(soonFrom, soonTo).toArray();
		for (const card of dueSoon) {
			if (card.archived || card.dueComplete) {
				continue;
			}
			// eslint-disable-next-line no-await-in-loop
			await dispatchEvent(card.boardId, 'card.dueSoon', { boardId: card.boardId, cardId: card._id, actor: 'system' });
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.synth.dueSoon.failed', err });
	}

	// deadline.due — tracked deadlines whose reminder is due (reuses the M5 reminder index).
	try {
		const due = await BoardsDeadlines.findRemindersDue(now).toArray();
		for (const d of due) {
			// eslint-disable-next-line no-await-in-loop
			await dispatchEvent(d.boardId, 'deadline.due', {
				boardId: d.boardId,
				cardId: d.cardId,
				actor: 'system',
				deadlineKind: d.kind,
			});
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.synth.deadlineDue.failed', err });
	}
}

/** 3. Advance every due drip enrollment via the EXISTING M6 worker (no drip logic here). */
async function tickSequences(now: Date): Promise<{ advanced: number }> {
	let advanced = 0;
	try {
		const due = await BoardsSequenceEnrollments.findDueToRun(now).toArray();
		for (const enrollment of due) {
			try {
				// eslint-disable-next-line no-await-in-loop
				await advanceEnrollment('system', enrollment._id);
				advanced += 1;
			} catch (err) {
				SystemLogger.warn({ msg: 'boards.automation.sequence.advanceFailed', enrollmentId: enrollment._id, err });
			}
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.sequence.tickFailed', err });
	}
	return { advanced };
}

/** The whole per-minute tick. Each sub-step is independently best-effort. */
export async function runScheduledTick(now: Date = new Date()): Promise<void> {
	await tickScheduledAutomations(now);
	await tickSynthesizedEvents(now);
	await tickSequences(now);
}
