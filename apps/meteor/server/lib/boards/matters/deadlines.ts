import type {
	IBoardCard,
	IBoardDeadline,
	IMatterSnapshot,
	BoardDeadlineKind,
	BoardDeadlineStatus,
} from '@rocket.chat/core-typings';
import { BoardsCards, BoardsDeadlines, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

/**
 * The safety-critical SOL / deadline engine (M5, matters depth — see
 * matters-case-management.md §5 and differentiators.md §4: "No missed-SOL").
 *
 * Every deadline is its own `boards_deadlines` doc so it surfaces on Calendar /
 * Timeline regardless of the card's stage, escalates in tiers, and (for the
 * high-risk SOL / filing kinds) requires a mandatory acknowledgement.
 *
 * Mutation convention mirrors `./service` and `../service`: write the model, then
 * append a `BoardsActivities` audit row. CasePro reads are taken ONLY from the
 * already-assembled snapshot the caller passes in (the snapshot is produced by the
 * single `caseProClient`); this module never queries CasePro directly and never
 * throws on a missing/raw field — it degrades to the jurisdiction rules engine.
 */

// ---------------------------------------------------------------------------
// Jurisdiction SOL rules table
// ---------------------------------------------------------------------------

/**
 * A single SOL rule: how many years from the trigger date a personal-injury claim
 * must be filed in a given jurisdiction. The default rule (TX personal-injury, 2yr)
 * is applied whenever the matter's jurisdiction is unknown or unmatched — the firm
 * of record (The Nguyen Law Firm) is a Texas PI practice.
 */
export type SolRule = {
	/** stable id stamped onto the deadline's `computedRuleId` for auditability. */
	id: string;
	/** lowercase jurisdiction key(s) this rule matches (state name or 2-letter code). */
	jurisdictions: string[];
	/** claim type this rule is scoped to (PI default). */
	claimType: 'personal-injury';
	/** years to add to the base (incident) date. */
	years: number;
	/** human label for UI / activity logs. */
	label: string;
};

/**
 * The jurisdiction SOL rules table. Intentionally small + explicit (differentiators
 * §4 "jurisdiction rules table"); extend by appending rows. TX is the default.
 */
export const SOL_RULES: SolRule[] = [
	{ id: 'tx-pi-2y', jurisdictions: ['tx', 'texas'], claimType: 'personal-injury', years: 2, label: 'Texas PI — 2 years' },
	{ id: 'ca-pi-2y', jurisdictions: ['ca', 'california'], claimType: 'personal-injury', years: 2, label: 'California PI — 2 years' },
	{ id: 'ny-pi-3y', jurisdictions: ['ny', 'new york'], claimType: 'personal-injury', years: 3, label: 'New York PI — 3 years' },
	{ id: 'fl-pi-2y', jurisdictions: ['fl', 'florida'], claimType: 'personal-injury', years: 2, label: 'Florida PI — 2 years' },
	{ id: 'la-pi-1y', jurisdictions: ['la', 'louisiana'], claimType: 'personal-injury', years: 1, label: 'Louisiana PI — 1 year' },
];

/** The default rule when a jurisdiction is unknown/unmatched: Texas PI, 2 years. */
export const DEFAULT_SOL_RULE: SolRule = SOL_RULES[0];

/** Deadline kinds that demand a mandatory acknowledgement (the no-missed-SOL guardrail). */
const HIGH_RISK_KINDS: BoardDeadlineKind[] = ['SOL', 'filing'];

/** Days-out tiers the tickler escalates through as a deadline nears/passes. */
const ESCALATION_TIERS_DAYS = [90, 60, 30, 14, 7, 3, 1, 0] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Add whole calendar years to a date (SOL math), preserving month/day. */
function addYears(base: Date, years: number): Date {
	const d = new Date(base.getTime());
	d.setFullYear(d.getFullYear() + years);
	return d;
}

/** Whole-day difference (target − now), rounded down; negative once the date has passed. */
function daysUntil(target: Date, now: Date): number {
	return Math.floor((target.getTime() - now.getTime()) / DAY_MS);
}

// ---------------------------------------------------------------------------
// computeSol — jurisdiction rules engine
// ---------------------------------------------------------------------------

export type ComputeSolInput = {
	incidentDate: Date;
	/** state name or 2-letter code; unknown/unmatched falls back to the TX default. */
	jurisdiction?: string;
};

export type ComputeSolResult = {
	solDate: Date;
	rule: SolRule;
	computedRuleId: string;
	baseDate: Date;
	jurisdiction: string;
};

/**
 * Compute an SOL date from an incident date + jurisdiction using the rules table.
 * Never throws: an unknown jurisdiction degrades to the Texas-PI-2yr default rule
 * (the firm of record). The returned `computedRuleId` + `baseDate` are recorded on
 * the deadline so a lawyer can review/override the derivation.
 */
export function computeSol({ incidentDate, jurisdiction }: ComputeSolInput): ComputeSolResult {
	const key = (jurisdiction ?? '').trim().toLowerCase();
	const rule = (key && SOL_RULES.find((r) => r.jurisdictions.includes(key))) || DEFAULT_SOL_RULE;
	return {
		solDate: addYears(incidentDate, rule.years),
		rule,
		computedRuleId: rule.id,
		baseDate: incidentDate,
		jurisdiction: key || DEFAULT_SOL_RULE.jurisdictions[0],
	};
}

// ---------------------------------------------------------------------------
// createDeadline
// ---------------------------------------------------------------------------

export type CreateDeadlineFields = {
	cardId: string;
	kind: BoardDeadlineKind;
	dueDate: Date;
	label?: string;
	computedFrom?: IBoardDeadline['computedFrom'];
	computedRuleId?: string;
	jurisdiction?: string;
	baseDate?: Date;
	/** override the kind-derived high-risk default (SOL/filing => true). */
	highRisk?: boolean;
	notes?: string;
};

/**
 * Create a deadline on a matter card. High-risk kinds (SOL/filing) default to
 * `highRisk:true` (mandatory acknowledgement). `nextReminderAt` is seeded to the
 * first escalation tier that is still in the future so the tickler picks it up.
 * Denormalizes the card's `boardId` + `link.matterId` onto the deadline for the
 * board-wide / per-matter scans. Logs a `field.changed` audit row.
 */
export async function createDeadline(uid: string, fields: CreateDeadlineFields): Promise<IBoardDeadline> {
	const card = await BoardsCards.findOneById(fields.cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.matters.deadlines.create' });
	}

	const matterId = card.link?.kind === 'matter' ? card.link.matterId : undefined;
	const highRisk = fields.highRisk ?? HIGH_RISK_KINDS.includes(fields.kind);
	const now = new Date();

	const doc: Omit<IBoardDeadline, '_id' | '_updatedAt'> = {
		cardId: card._id,
		boardId: card.boardId,
		...(matterId ? { matterId } : {}),
		kind: fields.kind,
		...(fields.label ? { label: fields.label } : {}),
		dueDate: fields.dueDate,
		computedFrom: fields.computedFrom ?? 'manual',
		...(fields.computedRuleId ? { computedRuleId: fields.computedRuleId } : {}),
		...(fields.jurisdiction ? { jurisdiction: fields.jurisdiction } : {}),
		...(fields.baseDate ? { baseDate: fields.baseDate } : {}),
		status: 'open',
		escalationLevel: 0,
		highRisk,
		acknowledged: false,
		nextReminderAt: firstReminderAt(fields.dueDate, now),
		...(fields.notes ? { notes: fields.notes } : {}),
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId } = await BoardsDeadlines.insertOne(doc);
	const deadline = await BoardsDeadlines.findOneById(insertedId);
	if (!deadline) {
		throw new Meteor.Error('error-deadline-not-found', 'Deadline not found after create', {
			method: 'boards.matters.deadlines.create',
		});
	}

	await BoardsActivities.log({
		boardId: card.boardId,
		listId: card.listId,
		cardId: card._id,
		actor: uid,
		verb: 'field.changed',
		to: { deadlineCreated: insertedId, kind: fields.kind, dueDate: fields.dueDate, highRisk },
		ts: now,
	});

	return deadline;
}

/** Seed `nextReminderAt` to the soonest escalation tier still ahead of `now`. */
function firstReminderAt(dueDate: Date, now: Date): Date {
	const out = daysUntil(dueDate, now);
	// the first tier whose threshold is <= days-out is when we should next fire.
	const tier = ESCALATION_TIERS_DAYS.find((d) => out >= d);
	if (tier === undefined) {
		// already inside the closest tier (or overdue) — fire immediately.
		return now;
	}
	return new Date(dueDate.getTime() - tier * DAY_MS);
}

// ---------------------------------------------------------------------------
// ensureSolDeadlineForMatter
// ---------------------------------------------------------------------------

/**
 * Guarantee a matter card carries exactly one open SOL deadline, idempotently.
 * Source precedence (differentiators §4 / matters §5):
 *   1. CasePro `statute_of_limitations` carried on the snapshot (`computedFrom:'casepro'`),
 *   2. else compute from the snapshot's `incidentDate` + jurisdiction via the rules
 *      engine (`computedFrom:'rules-engine'`, recording rule id + base date).
 *
 * If a matter has neither a CasePro SOL nor an incident date, NO deadline is created
 * (we never fabricate a safety-critical date) and the function returns null. When an
 * open SOL deadline already exists we refresh its due date in place (a CasePro SOL
 * always wins over a previously computed one). Never throws on snapshot gaps.
 */
export async function ensureSolDeadlineForMatter(
	uid: string,
	card: IBoardCard,
	snapshot: IMatterSnapshot | undefined,
): Promise<IBoardDeadline | null> {
	if (card.link?.kind !== 'matter') {
		return null;
	}

	let dueDate: Date | undefined;
	let computedFrom: IBoardDeadline['computedFrom'] = 'rules-engine';
	let computedRuleId: string | undefined;
	let jurisdiction: string | undefined;
	let baseDate: Date | undefined;

	const caseproSol = snapshot?.solDate ? new Date(snapshot.solDate) : undefined;
	if (caseproSol && !Number.isNaN(caseproSol.getTime())) {
		dueDate = caseproSol;
		computedFrom = 'casepro';
	} else if (snapshot?.incidentDate) {
		const incident = new Date(snapshot.incidentDate);
		if (!Number.isNaN(incident.getTime())) {
			// The snapshot carries no explicit jurisdiction column, so the rules engine
			// degrades to the firm-of-record default (Texas PI, 2yr) via `computeSol`.
			const computed = computeSol({ incidentDate: incident });
			dueDate = computed.solDate;
			computedRuleId = computed.computedRuleId;
			jurisdiction = computed.jurisdiction;
			baseDate = computed.baseDate;
		}
	}

	if (!dueDate) {
		// no usable SOL source — never fabricate a safety-critical date.
		return null;
	}

	const existing = await BoardsDeadlines.findOneOpenByCardAndKind(card._id, 'SOL');
	if (existing) {
		// a CasePro SOL always supersedes a previously computed one; refresh in place.
		if (existing.dueDate.getTime() !== dueDate.getTime() || existing.computedFrom !== computedFrom) {
			await BoardsDeadlines.setDueDate(existing._id, dueDate, computedFrom);
			await BoardsActivities.log({
				boardId: card.boardId,
				listId: card.listId,
				cardId: card._id,
				actor: uid,
				verb: 'field.changed',
				to: { solDeadlineRefreshed: existing._id, dueDate, computedFrom },
				ts: new Date(),
			});
			const refreshed = await BoardsDeadlines.findOneById(existing._id);
			return refreshed ?? existing;
		}
		return existing;
	}

	return createDeadline(uid, {
		cardId: card._id,
		kind: 'SOL',
		dueDate,
		label: 'Statute of limitations',
		computedFrom,
		...(computedRuleId ? { computedRuleId } : {}),
		...(jurisdiction ? { jurisdiction } : {}),
		...(baseDate ? { baseDate } : {}),
		highRisk: true,
	});
}

// ---------------------------------------------------------------------------
// listDeadlines / acknowledge / setStatus
// ---------------------------------------------------------------------------

export type ListDeadlinesScope = { cardId?: string; boardId?: string; matterId?: string };

/**
 * List open deadlines by scope (card, board, or matter), soonest first. Exactly one
 * scope key is expected; if several are given `cardId` wins, then `matterId`, then
 * `boardId`. Read-only; no audit row.
 */
export async function listDeadlines(scope: ListDeadlinesScope): Promise<IBoardDeadline[]> {
	if (scope.cardId) {
		return BoardsDeadlines.findByCard(scope.cardId).toArray();
	}
	if (scope.matterId) {
		return BoardsDeadlines.findByMatter(scope.matterId).toArray();
	}
	if (scope.boardId) {
		return BoardsDeadlines.findByBoard(scope.boardId).toArray();
	}
	return [];
}

/**
 * Acknowledge a deadline (satisfies the mandatory-ack guardrail on high-risk kinds).
 * Logs a `field.changed` audit row carrying the acknowledging user.
 */
export async function acknowledgeDeadline(uid: string, deadlineId: string): Promise<IBoardDeadline> {
	const current = await BoardsDeadlines.findOneById(deadlineId);
	if (!current) {
		throw new Meteor.Error('error-deadline-not-found', 'Deadline not found', {
			method: 'boards.matters.deadlines.acknowledge',
		});
	}

	await BoardsDeadlines.acknowledge(deadlineId, uid);

	await BoardsActivities.log({
		boardId: current.boardId,
		cardId: current.cardId,
		actor: uid,
		verb: 'field.changed',
		to: { deadlineAcknowledged: deadlineId, kind: current.kind },
		ts: new Date(),
	});

	const deadline = await BoardsDeadlines.findOneById(deadlineId);
	if (!deadline) {
		throw new Meteor.Error('error-deadline-not-found', 'Deadline not found after acknowledge', {
			method: 'boards.matters.deadlines.acknowledge',
		});
	}
	return deadline;
}

/**
 * Set a deadline's lifecycle status (satisfied / waived / missed / re-open).
 * High-risk kinds (SOL/filing) cannot be resolved without a prior acknowledgement —
 * the no-missed-SOL guardrail forces an explicit human ack before close-out.
 */
export async function setDeadlineStatus(
	uid: string,
	deadlineId: string,
	status: BoardDeadlineStatus,
	waivedReason?: string,
): Promise<IBoardDeadline> {
	const current = await BoardsDeadlines.findOneById(deadlineId);
	if (!current) {
		throw new Meteor.Error('error-deadline-not-found', 'Deadline not found', {
			method: 'boards.matters.deadlines.setStatus',
		});
	}

	const resolving = status === 'satisfied' || status === 'waived';
	if (resolving && current.highRisk && !current.acknowledged) {
		throw new Meteor.Error('error-deadline-requires-ack', 'High-risk deadline must be acknowledged before it can be resolved', {
			method: 'boards.matters.deadlines.setStatus',
		});
	}

	await BoardsDeadlines.setStatus(deadlineId, status);
	if (status === 'waived' && waivedReason) {
		await BoardsDeadlines.updateOne({ _id: deadlineId }, { $set: { waivedReason }, $inc: { rev: 1 } });
	}

	await BoardsActivities.log({
		boardId: current.boardId,
		cardId: current.cardId,
		actor: uid,
		verb: 'field.changed',
		to: { deadlineStatus: status, deadlineId, ...(waivedReason ? { waivedReason } : {}) },
		ts: new Date(),
	});

	const deadline = await BoardsDeadlines.findOneById(deadlineId);
	if (!deadline) {
		throw new Meteor.Error('error-deadline-not-found', 'Deadline not found after setStatus', {
			method: 'boards.matters.deadlines.setStatus',
		});
	}
	return deadline;
}

// ---------------------------------------------------------------------------
// runDeadlineTick — the tickler (called from the cron)
// ---------------------------------------------------------------------------

export type DeadlineTickResult = {
	scanned: number;
	escalated: number;
	notified: number;
};

/**
 * The tickler tick: for every open deadline whose `nextReminderAt` has passed, bump
 * its escalation level to the tier matching how close the due date now is, notify the
 * owners, and schedule the next reminder at the following (tighter) tier. Overdue
 * deadlines escalate to the maximum tier and keep firing daily until resolved.
 *
 * Notification: there is no Boards-native notification collection until M8, so we
 * degrade gracefully — the escalation is recorded on the deadline (`escalationLevel`
 * + `lastNotifiedAt`) and a `field.changed` audit row stands in as the owner-visible
 * signal. TODO(M8): fan out to `boards_notifications` / the RC bell + email digest.
 */
export async function runDeadlineTick(now: Date = new Date()): Promise<DeadlineTickResult> {
	const due = await BoardsDeadlines.findRemindersDue(now).toArray();

	let escalated = 0;
	let notified = 0;
	for (const deadline of due) {
		const out = daysUntil(deadline.dueDate, now);
		const level = escalationLevelFor(out);
		const next = nextReminderAfter(deadline.dueDate, out, now);

		await BoardsDeadlines.bumpEscalation(deadline._id, level, now, next);
		escalated += 1;

		// Notify owners. No notification collection yet (M8) — record the signal as an
		// audit row so it is owner-visible on the card's Activity feed and never throws.
		await notifyDeadlineOwners(deadline, level, out, now);
		notified += 1;
	}

	return { scanned: due.length, escalated, notified };
}

/** Escalation tier index (0..n) for a given days-out value; overdue => max tier. */
function escalationLevelFor(daysOut: number): number {
	for (let i = 0; i < ESCALATION_TIERS_DAYS.length; i++) {
		if (daysOut >= ESCALATION_TIERS_DAYS[i]) {
			return i;
		}
	}
	// past the 0-day tier (overdue) — maximum escalation.
	return ESCALATION_TIERS_DAYS.length;
}

/** Compute the next reminder time: the next tighter tier, or +1 day once overdue. */
function nextReminderAfter(dueDate: Date, daysOut: number, now: Date): Date {
	const nextTier = ESCALATION_TIERS_DAYS.find((d) => d < daysOut);
	if (nextTier === undefined) {
		// inside the closest tier or overdue — keep nagging daily.
		return new Date(now.getTime() + DAY_MS);
	}
	return new Date(dueDate.getTime() - nextTier * DAY_MS);
}

/**
 * Owner-notify shim. Degrades gracefully: writes a `field.changed` audit row that the
 * card's Activity feed renders. Best-effort — a logging failure never aborts the tick.
 * TODO(M8): replace the body with a fan-out into `boards_notifications` + the bell/email.
 */
async function notifyDeadlineOwners(deadline: IBoardDeadline, level: number, daysOut: number, now: Date): Promise<void> {
	try {
		const card = await BoardsCards.findOneById(deadline.cardId);
		const owners = card?.assignees ?? [];
		await BoardsActivities.log({
			boardId: deadline.boardId,
			cardId: deadline.cardId,
			actor: 'casepro:sync',
			verb: 'field.changed',
			to: {
				deadlineReminder: deadline._id,
				kind: deadline.kind,
				escalationLevel: level,
				daysOut,
				owners,
				highRisk: deadline.highRisk ?? false,
				unacknowledged: deadline.highRisk ? !deadline.acknowledged : false,
			},
			ts: now,
		});
	} catch {
		// best-effort: a notify failure must never abort the rest of the tick.
	}
}
