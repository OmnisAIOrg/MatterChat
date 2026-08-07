import type {
	IAutomation,
	IBoardCard,
	IMatterSnapshot,
	IBoardAutomationFilters,
	BoardAutomationTriggerEvent,
} from '@rocket.chat/core-typings';
import { BoardsAutomations, BoardsCards, BoardsLeads } from '@rocket.chat/models';

import { settings } from '../../settings';
import { SystemLogger } from '../../lib/logger/system';
import type { AutomationContext, AutomationFireSource, AutomationSubject, LoopGuardState } from './context';
import { rootLoopState } from './context';
import { admitAutomation, canCascade, withinDailyCap } from './loopGuard';
import { enqueue } from './queue';
import { runAutomation } from './runner';

/**
 * The dispatcher (M7 — 05-automation-engine.md §4.1). The single entry the event seam
 * (`emitBoardEvent`) and the cron call: it matches an event to enabled `kind:'rule'`
 * automations, cheap-pre-filters each on `trigger.filters`, resolves the subject ONCE,
 * and enqueues a serialized run per surviving rule. It also runs a single automation on
 * demand (a card/board button or a REST `run`/`dryRun`).
 *
 * Master kill switch: when `Boards_Automation_Enabled` is off, the dispatcher is inert —
 * nothing matches, nothing runs (the seam + cron both honor it). Everything is
 * best-effort: a dispatch failure is logged and swallowed so a board mutation that
 * emitted the event is never affected.
 */

function engineEnabled(): boolean {
	try {
		return settings.get('Boards_Automation_Enabled') === true;
	} catch {
		return false;
	}
}

/** Snapshot helper: pull the cached matter snapshot off a matter-linked card (no live load). */
function snapshotOf(card: IBoardCard | undefined): IMatterSnapshot | undefined {
	return card?.link?.kind === 'matter' ? card.link.snapshot : undefined;
}

/**
 * Resolve the run subject for an event payload. Prefers an explicit `cardId`/`leadId` on
 * the payload, else derives the lead from the card link (and vice-versa) so a rule typed
 * for either domain has what it needs. Reads are best-effort — a missing card/lead yields
 * a subject with just the boardId.
 */
export async function resolveSubject(boardId: string, payload: Record<string, unknown> | undefined): Promise<AutomationSubject> {
	const subject: AutomationSubject = { boardId };
	const cardId = typeof payload?.cardId === 'string' ? payload.cardId : undefined;
	const leadId = typeof payload?.leadId === 'string' ? payload.leadId : undefined;

	try {
		if (cardId) {
			const card = await BoardsCards.findOneById(cardId);
			if (card) {
				subject.card = card;
				subject.snapshot = snapshotOf(card);
				if (card.link?.kind === 'lead') {
					subject.lead = (await BoardsLeads.findOneById(card.link.leadId)) ?? undefined;
				}
			}
		}
		if (!subject.lead && leadId) {
			subject.lead = (await BoardsLeads.findOneById(leadId)) ?? undefined;
			// if the lead carries a card and we didn't already load one, load it for conditions.
			if (!subject.card && subject.lead?.cardId) {
				const card = await BoardsCards.findOneById(subject.lead.cardId);
				if (card) {
					subject.card = card;
					subject.snapshot = snapshotOf(card);
				}
			}
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.resolveSubject.failed', boardId, err });
	}

	return subject;
}

/**
 * Cheap pre-filter: every present key in `trigger.filters` must match the event payload
 * (or the resolved subject) before the (more expensive) conditions run. Returns true when
 * the rule survives the filter.
 */
export function matchesFilters(filters: IBoardAutomationFilters | undefined, payload: Record<string, unknown> | undefined, subject: AutomationSubject): boolean {
	if (!filters) {
		return true;
	}
	const p = payload ?? {};
	const checks: [unknown, unknown][] = [
		[filters.listId, subject.card?.listId ?? p.listId],
		[filters.fromListId, p.fromListId],
		[filters.toListId, p.toListId ?? subject.card?.listId],
		[filters.cardType, subject.card?.cardType ?? p.cardType],
		[filters.labelId, p.labelId],
		[filters.userId, p.userId],
		[filters.fieldId, p.fieldId],
		[filters.fromStage, p.fromStage],
		[filters.toStage, p.toStage],
		[filters.statusId, p.statusId ?? subject.lead?.statusId],
		[filters.deadlineKind, p.deadlineKind],
		[filters.source, subject.lead?.attribution?.source ?? p.source],
	];
	for (const [expected, actual] of checks) {
		if (expected !== undefined && expected !== null && String(expected) !== String(actual ?? '')) {
			return false;
		}
	}
	return true;
}

/**
 * Build a run context for a matched automation. `actor` defaults to the payload's actor
 * (the user who triggered the event); a cascade child carries `automation:<parentId>`.
 */
function buildContext(
	automation: IAutomation,
	boardId: string,
	event: AutomationFireSource,
	subject: AutomationSubject,
	payload: Record<string, unknown> | undefined,
	loop: LoopGuardState,
	actorOverride?: string,
): AutomationContext {
	const actor = actorOverride ?? (typeof payload?.actor === 'string' ? payload.actor : 'system');
	return {
		automation,
		boardId,
		event,
		...(payload ? { payload } : {}),
		subject,
		actor,
		dryRun: false,
		loop,
	};
}

/**
 * Dispatch an event into the engine. Finds enabled rules for `(boardId, event)`, pre-
 * filters + resolves the subject once, and enqueues a serialized run per surviving rule
 * onto the board's chain. `loop` carries the cascade accounting (a re-emit from a running
 * action passes its child loop state so depth/budget keep accumulating). Fire-and-forget:
 * resolves once everything is enqueued (NOT when the runs finish) so the emitting mutation
 * is never blocked.
 */
export async function dispatchEvent(
	boardId: string,
	event: BoardAutomationTriggerEvent,
	payload: Record<string, unknown> | undefined,
	loop: LoopGuardState = rootLoopState(),
): Promise<void> {
	if (!engineEnabled()) {
		return;
	}
	try {
		const rules = await BoardsAutomations.findEnabledRulesForEvent(boardId, event).toArray();
		if (rules.length === 0) {
			return;
		}

		// daily runaway guard for the board (root cascades only).
		if (loop.depth === 0 && !(await withinDailyCap(boardId))) {
			SystemLogger.warn({ msg: 'boards.automation.dailyCapReached', boardId });
			return;
		}

		const subject = await resolveSubject(boardId, payload);

		// depth cap reached mid-cascade: no further fan-out (the oscillation backstop).
		if (loop.depth > 0 && !canCascade({ loop } as AutomationContext)) {
			return;
		}

		for (const rule of rules) {
			if (!matchesFilters(rule.trigger?.filters, payload, subject)) {
				continue;
			}
			// per-cascade re-entry guard: an automation fires at most once per cascade
			// (cheapest A→B→A stop). Root-level (depth 0) runs are always admitted.
			if (loop.depth > 0 && !admitAutomation(loop, rule._id)) {
				continue;
			}
			const ctx = buildContext(rule, boardId, event, subject, payload, loop);
			void enqueue(boardId, () => runAutomation(rule, ctx).then(() => undefined));
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.dispatch.failed', boardId, event, err });
	}
}

/**
 * Run a SINGLE automation now — a card/board button click or a REST run/dryRun. Resolves
 * the subject from `cardId` (when given), serializes onto the board chain, and returns the
 * run result. `dryRun` plans without mutating. Unlike `dispatchEvent`, this AWAITS the run
 * (the caller wants the per-action results back).
 */
export async function runOne(
	automation: IAutomation,
	opts: { actor: string; cardId?: string; leadId?: string; dryRun?: boolean },
): Promise<{ runId: string; status: string; actionsRun: unknown[] }> {
	const boardId = automation.boardId ?? '';
	const payload: Record<string, unknown> = {
		actor: opts.actor,
		...(opts.cardId ? { cardId: opts.cardId } : {}),
		...(opts.leadId ? { leadId: opts.leadId } : {}),
	};
	const subject = await resolveSubject(boardId || (typeof payload.boardId === 'string' ? payload.boardId : ''), payload);
	const effectiveBoardId = subject.card?.boardId ?? boardId;

	const ctx: AutomationContext = {
		automation,
		boardId: effectiveBoardId,
		event: 'manual',
		payload,
		subject,
		actor: opts.actor,
		dryRun: Boolean(opts.dryRun),
		loop: rootLoopState(),
	};

	// serialize button/manual runs on the board chain too (consistency with rule runs);
	// dry-runs don't mutate so they can run inline, but we still chain for simplicity.
	const result = await new Promise<{ runId: string; status: string; actionsRun: unknown[] }>((resolve) => {
		void enqueue(effectiveBoardId || automation._id, async () => {
			// runAutomation never throws (it captures its own errors), but resolve defensively
			// so a thrown task can never hang the awaiting caller (the queue swallows errors).
			const r = await runAutomation(automation, ctx).catch(() => ({ runId: '', status: 'error', actionsRun: [] }));
			resolve(r);
		});
	});
	return result;
}

/** Re-export the subject resolver result type for the cron's synthesized-event path. */
export type { AutomationSubject };
