/**
 * Chi smart notifications (F5) — TURNING A RULE VERDICT INTO A DELIVERY DECISION.
 *
 * PURE module: no meteor, no models, no settings, no clock. The engine next door
 * (./notificationRules) decides `interrupt | digest | silence`; this decides what that means
 * for the desktop, push and email branches of sendNotificationsOnMessage.
 *
 * ── THE RULE THAT MAKES THIS SAFE TO PUT ON THE HOT PATH ──────────────────────────────────
 *
 * The overlay is **SUBTRACTIVE, and only ever on an explicit match**. If the user has written
 * no rules, or has rules and none of them matched this message, the outcome is `none` and
 * Rocket.Chat's own per-subscription preferences decide, exactly as they do today.
 *
 * This is deliberately narrower than the engine's own baseline. `evaluateRules` returns
 * `digest` for ordinary channel traffic when nothing matches, which is the correct answer to
 * the question "does this deserve to interrupt?" — but shipping THAT as the delivery decision
 * would mean the first person to write a single rule ("silence #random") silently loses
 * desktop notifications everywhere else. A triage system gets exactly one chance to be
 * trusted. So the broad behaviour has to be asked for: a user who wants "only interrupt me
 * for the Hernandez matter" gets a conditionless `digest` rule alongside the narrow
 * `interrupt` one, and specificity ordering then does the right thing.
 *
 * Consequence worth stating plainly: turning this on changes nothing for anybody until they
 * write a rule, and then it only ever takes notifications away, never adds them.
 *
 * ── digest vs silence ─────────────────────────────────────────────────────────────────────
 *
 * Both suppress all three delivery channels here — there is no third state to put a message
 * into at this point in the pipeline. They differ downstream: a `digest` message still shows
 * up in Catch Me Up and the morning brief (it is simply unread), whereas `silence` is filtered
 * out of those too (server/lib/chi/digest/unreadDigest.ts). The distinction is carried on the
 * outcome so both halves read from one decision rather than re-deriving it.
 */
import type { NotificationEvent, NotificationRule } from './notificationRules';
import { evaluateRules, validRules } from './notificationRules';

export type TriageAction = 'none' | 'interrupt' | 'digest' | 'silence';

export type TriageOutcome = {
	action: TriageAction;
	suppressDesktop: boolean;
	suppressMobile: boolean;
	suppressEmail: boolean;
	/** The rule that decided, when one did. */
	ruleId?: string;
	/** One line, relayable verbatim by Chi when asked "why didn't I get pinged?". */
	reason?: string;
};

/** No opinion: the user has no rules, or none of them matched. Nothing is suppressed. */
export const TRIAGE_PASS: TriageOutcome = {
	action: 'none',
	suppressDesktop: false,
	suppressMobile: false,
	suppressEmail: false,
};

/** Where the rules live on a user document. Mirrors ./rulesStore's FIELD. */
type UserWithRules = { settings?: { chi?: { notificationRules?: unknown } } };

/**
 * Pull a receiver's rules straight off the user document the notification pipeline already
 * loaded — no extra query. Anything unreadable degrades to "no rules", never to a throw.
 */
export function readNotificationRules(receiver: unknown): NotificationRule[] {
	const rules = (receiver as UserWithRules | null | undefined)?.settings?.chi?.notificationRules;
	if (!rules) {
		return [];
	}
	return validRules(rules);
}

/**
 * Whether any rule needs to know the sender's roles.
 *
 * The caller uses this to decide whether to pay for a roles lookup at all. Almost no rule set
 * mentions a role, so almost every message skips that query entirely.
 */
export function rulesReferenceSenderRoles(rules: NotificationRule[]): boolean {
	return rules.some((rule) => typeof rule.senderRole === 'string' && rule.senderRole.trim().length > 0);
}

/** Rocket.Chat stores `utcOffset` in HOURS; the engine wants minutes to add to UTC. */
export function tzOffsetMinutes(utcOffset: unknown): number | undefined {
	if (typeof utcOffset !== 'number' || !Number.isFinite(utcOffset)) {
		return undefined;
	}
	// Guard the half-hour and three-quarter-hour zones (+5:30, +5:45) against truncation.
	const minutes = Math.round(utcOffset * 60);
	return Math.abs(minutes) <= 14 * 60 ? minutes : undefined;
}

/**
 * Whether a message is SILENCED for this user — i.e. should not appear even in a digest.
 *
 * This is the half of the decision the digest surfaces care about. `digest` messages still
 * belong in Catch Me Up and the morning brief (being held back from interrupting is the whole
 * point of them); only `silence` means "I never want to see this at all", which is what the
 * rules UI promises and what would otherwise be an empty promise.
 */
export function isSilenced(rules: NotificationRule[], event: NotificationEvent): boolean {
	return triage(rules, event).action === 'silence';
}

/**
 * The delivery decision for one receiver and one message.
 *
 * Returns {@link TRIAGE_PASS} unless a rule actually matched — see the file header for why
 * that restraint is the whole safety argument.
 */
export function triage(rules: NotificationRule[], event: NotificationEvent): TriageOutcome {
	if (!rules.length) {
		return TRIAGE_PASS;
	}
	const decision = evaluateRules(rules, event);
	if (!decision.matchedRuleIds.length) {
		return TRIAGE_PASS;
	}
	if (decision.action === 'interrupt') {
		return { ...TRIAGE_PASS, action: 'interrupt', ruleId: decision.ruleId, reason: decision.reason };
	}
	return {
		action: decision.action,
		suppressDesktop: true,
		suppressMobile: true,
		suppressEmail: true,
		ruleId: decision.ruleId,
		reason: decision.reason,
	};
}
