/**
 * Chi smart notifications — THE RULE ENGINE.
 *
 * PURE module: no meteor, no models, no settings, no clock of its own beyond a caller-supplied
 * `at`. Everything here is a total function over plain data so the triage decision — the one
 * thing that can lose a user's trust forever by hiding something important — is exhaustively
 * testable (tests/unit/server/lib/chi/notify/notificationRules.spec.ts).
 *
 * The user states rules as sentences ("only interrupt me for the Hernandez matter", "nothing
 * after 7pm unless it's from a partner"). The MODEL parses the sentence; this module only ever
 * sees the structured result. Tools gather, the model reasons — there is no LLM call in here.
 *
 * ── THE DECISION ──────────────────────────────────────────────────────────────────────────
 * `interrupt` = ring/badge/push now · `digest` = collect it for the periodic digest ·
 * `silence` = never surface it.
 *
 * ── BASELINE (no rule applies) ────────────────────────────────────────────────────────────
 *  • a direct mention or a DM  → `interrupt`. ALWAYS. This is a hard floor, not a default.
 *  • anything else             → `digest`. Ambient channel traffic is what the feature exists
 *                                to collect. (Rocket.Chat's own per-subscription notification
 *                                preferences still gate whether a message reaches this engine
 *                                at all; this is an overlay on top of them, not a replacement.)
 *
 * ── MENTION PROTECTION ────────────────────────────────────────────────────────────────────
 * When the caller was directly mentioned (or it is a DM), a matching `digest` rule is IGNORED
 * unless that rule sets `includeMentions: true`. Rationale: digest rules are broad and ambient
 * ("quiet hours", "#random is noisy") and are written without thinking about mentions — letting
 * one quietly swallow "@you the hearing moved to 9am" is exactly the failure that destroys
 * trust in a triage system. A `silence` rule DOES apply to a mention: silencing is narrow and
 * deliberate ("never notify me about the Wilson case, period"), so we honour it. That asymmetry
 * is intentional and is tested.
 *
 * ── PRECEDENCE when several rules match (in order) ────────────────────────────────────────
 *  1. MORE SPECIFIC WINS — the rule declaring more conditions. This is what makes
 *     "nothing after 7pm" + "unless it's from a partner" work in either authoring order.
 *  2. Tie → the MORE PERMISSIVE action wins: interrupt > digest > silence. Conservative bias:
 *     when two equally specific rules disagree, err toward interrupting.
 *  3. Tie → the LATER rule in the list wins (most recently added reflects current intent).
 *
 * Authoring ORDER is therefore not the primary lever — specificity is. Malformed or partial
 * rules are silently ignored rather than throwing, so one bad row can never break triage.
 */

export type NotificationAction = 'interrupt' | 'digest' | 'silence';

/** A time-of-day window on the user's own clock. `from` inclusive, `to` exclusive, "HH:MM" 24h. */
export type TimeWindow = { from: string; to: string };

export type NotificationRule = {
	id: string;
	action: NotificationAction;
	/** Exact room id (what an integration would prefer). */
	roomId?: string;
	/** Room name, matched case-insensitively: exact first, then substring. */
	channel?: string;
	/** Sender username, case-insensitive, leading @ optional. */
	sender?: string;
	/** A role the sender holds, e.g. "partner", "admin". Case-insensitive. */
	senderRole?: string;
	/** Word/phrase in the message body. Case-insensitive, whole-word (see `keywordMatches`). */
	keyword?: string;
	/** Time-of-day window; may cross midnight (19:00 → 08:00). */
	window?: TimeWindow;
	/**
	 * "Applies to every message." The one condition that constrains nothing.
	 *
	 * It exists because the delivery overlay only ever acts on a rule that MATCHED (see
	 * ./triageDecision), so "only interrupt me for the Hernandez matter" needs a way to say
	 * out loud that everything else is digest material. Its specificity is zero, so any rule
	 * with a real condition beats it — which is exactly the behaviour that sentence describes.
	 *
	 * Deliberately explicit rather than "a rule with no conditions": an empty rule is
	 * something you arrive at by accident, and this is only ever something you meant.
	 */
	everything?: boolean;
	/** Let a `digest` rule also cover direct mentions / DMs. Only set on explicit user intent. */
	includeMentions?: boolean;
	createdAt?: number;
};

export type NotificationEvent = {
	roomId?: string;
	roomName?: string;
	/** Rocket.Chat room type: 'c' channel, 'p' private group, 'd' direct message. */
	roomType?: string;
	senderUsername?: string;
	senderRoles?: string[];
	text?: string;
	/** The caller was named (@them, @all, @here — the caller decides what counts). */
	isMention?: boolean;
	isDM?: boolean;
	/** When the message arrived. Defaults to now. */
	at?: Date;
	/**
	 * Minutes to ADD to UTC to get the user's local clock (e.g. -300 for America/New_York in
	 * winter). Supplied by the caller so this module stays deterministic and machine-TZ-free.
	 */
	tzOffsetMinutes?: number;
};

export type NotificationDecision = {
	action: NotificationAction;
	/** One line the assistant can relay verbatim: why this message did (or did not) interrupt. */
	reason: string;
	/** The rule that decided, when one did. */
	ruleId?: string;
	/** Every rule whose conditions matched — including ones mention-protection then skipped. */
	matchedRuleIds: string[];
};

/** Hard cap per user. High enough for real triage, low enough that the list stays inspectable. */
export const MAX_RULES_PER_USER = 20;

const MAX_FIELD_LEN = 100;
const MAX_KEYWORD_LEN = 120;

export const NOTIFICATION_ACTIONS: NotificationAction[] = ['interrupt', 'digest', 'silence'];

/* ─────────────────────────── small helpers ─────────────────────────── */

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Room/user names as typed: drop a leading # or @, casefold. */
const normName = (v: unknown): string => str(v).replace(/^[#@]+/, '').toLowerCase();

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HHMM_RX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Read a time-of-day out of whatever the model passed: "19:00", "7:30", "7pm", "7:30 PM",
 * "19", "noon", "midnight". Returns canonical "HH:MM", or undefined if it is not a time.
 */
export function parseTimeOfDay(input: unknown): string | undefined {
	if (typeof input !== 'string') {
		return undefined;
	}
	const s = input.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
	if (!s) {
		return undefined;
	}
	if (s === 'noon' || s === 'midday') {
		return '12:00';
	}
	if (s === 'midnight') {
		return '00:00';
	}
	const exact = HHMM_RX.exec(s);
	if (exact) {
		return `${String(Number(exact[1])).padStart(2, '0')}:${exact[2]}`;
	}
	const ampm = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/.exec(s);
	if (ampm) {
		let h = Number(ampm[1]);
		if (h < 1 || h > 12) {
			return undefined;
		}
		if (ampm[3] === 'pm' && h !== 12) {
			h += 12;
		}
		if (ampm[3] === 'am' && h === 12) {
			h = 0;
		}
		return `${String(h).padStart(2, '0')}:${ampm[2] || '00'}`;
	}
	const bare = /^(\d{1,2})$/.exec(s);
	if (bare) {
		const h = Number(bare[1]);
		return h <= 23 ? `${String(h).padStart(2, '0')}:00` : undefined;
	}
	return undefined;
}

/** "HH:MM" → minutes since local midnight. Assumes an already-canonical string. */
const toMinutes = (hhmm: string): number => {
	const m = HHMM_RX.exec(hhmm);
	return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};

export const crossesMidnight = (w: TimeWindow): boolean => toMinutes(w.from) > toMinutes(w.to);

/**
 * The classic off-by-one, pinned down: `from` is INCLUSIVE, `to` is EXCLUSIVE, and a window
 * whose end is numerically before its start wraps through midnight. 19:00→08:00 therefore
 * contains 19:00 and 23:59 and 00:00 and 07:59, and does NOT contain 08:00 or 18:59.
 * A zero-length window (from === to) never matches — `buildRule` rejects it up front.
 */
export function inWindow(minutesOfDay: number, w: TimeWindow): boolean {
	const from = toMinutes(w.from);
	const to = toMinutes(w.to);
	if (from < 0 || to < 0 || from === to) {
		return false;
	}
	return from < to ? minutesOfDay >= from && minutesOfDay < to : minutesOfDay >= from || minutesOfDay < to;
}

/** The event's minute-of-day on the USER's clock (tzOffsetMinutes is minutes to add to UTC). */
export function eventMinutesOfDay(event: NotificationEvent): number {
	const at = event.at instanceof Date && !Number.isNaN(event.at.getTime()) ? event.at : new Date();
	const utc = at.getUTCHours() * 60 + at.getUTCMinutes();
	const tz = typeof event.tzOffsetMinutes === 'number' && Number.isFinite(event.tzOffsetMinutes) ? Math.trunc(event.tzOffsetMinutes) : 0;
	return (((utc + tz) % 1440) + 1440) % 1440;
}

/**
 * Case-insensitive, WHOLE-WORD (or whole-phrase) matching: keyword "SOL" hits "the SOL date"
 * and "SOL." but NOT "solution" or "resolve". Boundaries are only applied on ends that are
 * word characters, so ":partyparrot:" or "$5,000" still match literally.
 */
export function keywordMatches(keyword: string, text: string | undefined): boolean {
	const k = str(keyword);
	if (!k || !text) {
		return false;
	}
	const left = /^\w/.test(k) ? '\\b' : '';
	const right = /\w$/.test(k) ? '\\b' : '';
	return new RegExp(`${left}${escapeRx(k)}${right}`, 'i').test(text);
}

/* ─────────────────────────── validation ─────────────────────────── */

const isAction = (v: unknown): v is NotificationAction => NOTIFICATION_ACTIONS.includes(v as NotificationAction);

const isValidWindow = (v: unknown): v is TimeWindow => {
	if (!v || typeof v !== 'object') {
		return false;
	}
	const w = v as Partial<TimeWindow>;
	if (!isNonEmptyString(w.from) || !isNonEmptyString(w.to)) {
		return false;
	}
	const from = parseTimeOfDay(w.from);
	const to = parseTimeOfDay(w.to);
	return Boolean(from && to && from === w.from.trim() && to === w.to.trim() && from !== to);
};

/** Conditions a rule may declare. Order is the order `describeRule` renders them in. */
const CONDITION_KEYS = ['channel', 'roomId', 'sender', 'senderRole', 'keyword', 'window'] as const;

/**
 * Structural validity. Anything that fails is IGNORED by the engine rather than throwing —
 * a half-written row left by an older version, a hand-edited user document, a future field:
 * none of them may take triage down.
 */
export function isValidRule(rule: unknown): rule is NotificationRule {
	if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
		return false;
	}
	const r = rule as Record<string, unknown>;
	if (!isNonEmptyString(r.id) || !isAction(r.action)) {
		return false;
	}
	for (const key of ['roomId', 'channel', 'sender', 'senderRole', 'keyword'] as const) {
		if (r[key] !== undefined && !isNonEmptyString(r[key])) {
			return false;
		}
	}
	if (r.window !== undefined && !isValidWindow(r.window)) {
		return false;
	}
	if (r.includeMentions !== undefined && typeof r.includeMentions !== 'boolean') {
		return false;
	}
	if (r.everything !== undefined && typeof r.everything !== 'boolean') {
		return false;
	}
	// A rule must say what it applies to. `everything: true` is a valid answer to that; an
	// absence of conditions is not, because that is what a half-built rule looks like.
	return r.everything === true || CONDITION_KEYS.some((k) => r[k] !== undefined);
}

/** How many conditions a rule declares — the primary precedence key. */
export function specificity(rule: NotificationRule): number {
	return CONDITION_KEYS.reduce((n, k) => (rule[k] === undefined ? n : n + 1), 0);
}

/* ─────────────────────────── building a rule from loose input ─────────────────────────── */

export type RuleDraft = {
	id: string;
	action?: unknown;
	roomId?: unknown;
	channel?: unknown;
	sender?: unknown;
	senderRole?: unknown;
	keyword?: unknown;
	from?: unknown;
	to?: unknown;
	everything?: unknown;
	includeMentions?: unknown;
	createdAt?: number;
};

export type BuildResult = { ok: true; rule: NotificationRule } | { ok: false; error: string };

/**
 * Turn whatever the model passed into a clean, valid rule — or an error string the tool can
 * hand straight back to the user. Validation is deliberately strict: a rule the user cannot
 * predict is worse than no rule.
 */
export function buildRule(draft: RuleDraft): BuildResult {
	if (!isNonEmptyString(draft.id)) {
		return { ok: false, error: 'Internal error: a rule needs an id.' };
	}
	if (draft.action !== undefined && typeof draft.action !== 'string') {
		return { ok: false, error: `action must be one of ${NOTIFICATION_ACTIONS.join(', ')}.` };
	}
	const action = str(draft.action).toLowerCase();
	if (!isAction(action)) {
		return {
			ok: false,
			error: `I need to know what to do with these messages: "interrupt" (notify you right away), "digest" (collect them for your digest) or "silence" (never show them)${
				action ? ` — I don't understand "${action}".` : '.'
			}`,
		};
	}

	const rule: NotificationRule = { id: str(draft.id), action };

	let fieldError: string | undefined;
	/** Trim/validate one optional text field; returns undefined when absent or unusable. */
	const text = (v: unknown, label: string, max: number, stripSigil = false): string | undefined => {
		if (v === undefined || v === null) {
			return undefined;
		}
		if (typeof v !== 'string') {
			fieldError ??= `${label} must be text.`;
			return undefined;
		}
		let s = v.trim();
		if (stripSigil) {
			s = s.replace(/^[#@]+/, '').trim();
		}
		if (!s) {
			return undefined;
		}
		if (s.length > max) {
			fieldError ??= `${label} is too long (max ${max} characters).`;
			return undefined;
		}
		return s;
	};

	rule.roomId = text(draft.roomId, 'roomId', MAX_FIELD_LEN);
	rule.channel = text(draft.channel, 'channel', MAX_FIELD_LEN, true);
	rule.sender = text(draft.sender, 'sender', MAX_FIELD_LEN, true);
	rule.senderRole = text(draft.senderRole, 'sender role', MAX_FIELD_LEN);
	rule.keyword = text(draft.keyword, 'keyword', MAX_KEYWORD_LEN);
	if (fieldError) {
		return { ok: false, error: fieldError };
	}
	for (const key of ['roomId', 'channel', 'sender', 'senderRole', 'keyword'] as const) {
		if (rule[key] === undefined) {
			delete rule[key];
		}
	}

	const hasFrom = isNonEmptyString(draft.from);
	const hasTo = isNonEmptyString(draft.to);
	if (hasFrom !== hasTo) {
		return { ok: false, error: 'A time window needs both a start and an end, e.g. from "19:00" to "08:00".' };
	}
	if (hasFrom && hasTo) {
		const from = parseTimeOfDay(draft.from);
		const to = parseTimeOfDay(draft.to);
		if (!from) {
			return { ok: false, error: `I couldn't read the start time "${str(draft.from)}" — use 24-hour HH:MM, like 19:00.` };
		}
		if (!to) {
			return { ok: false, error: `I couldn't read the end time "${str(draft.to)}" — use 24-hour HH:MM, like 08:00.` };
		}
		if (from === to) {
			return { ok: false, error: 'A time window can\'t start and end at the same time. For "all day", leave the times off entirely.' };
		}
		rule.window = { from, to };
	}

	if (draft.everything !== undefined && typeof draft.everything !== 'boolean') {
		return { ok: false, error: 'everything must be true or false.' };
	}
	if (draft.everything === true) {
		rule.everything = true;
	}
	if (draft.includeMentions !== undefined && typeof draft.includeMentions !== 'boolean') {
		return { ok: false, error: 'include_mentions must be true or false.' };
	}
	if (draft.includeMentions === true) {
		rule.includeMentions = true;
	}
	if (typeof draft.createdAt === 'number' && Number.isFinite(draft.createdAt)) {
		rule.createdAt = draft.createdAt;
	}

	if (!isValidRule(rule)) {
		return {
			ok: false,
			error:
				'A rule needs at least one condition: a channel, a sender, a sender role, a keyword/phrase, a time window — or "everything", if it really is meant to cover every message.',
		};
	}
	return { ok: true, rule };
}

/** Canonical shape of a rule's conditions+action, for duplicate detection. */
const signature = (r: NotificationRule): string =>
	[
		r.action,
		normName(r.channel),
		str(r.roomId),
		normName(r.sender),
		str(r.senderRole).toLowerCase(),
		str(r.keyword).toLowerCase(),
		r.window ? `${r.window.from}-${r.window.to}` : '',
		r.everything ? 'all' : '',
		r.includeMentions ? 'm' : '',
	].join('|');

export type ListResult = { ok: true; rules: NotificationRule[] } | { ok: false; error: string };

/** Append a rule, enforcing the per-user cap and rejecting exact duplicates. Pure. */
export function appendRule(rules: unknown, rule: NotificationRule): ListResult {
	const current = validRules(rules);
	if (current.length >= MAX_RULES_PER_USER) {
		return {
			ok: false,
			error: `You already have the maximum of ${MAX_RULES_PER_USER} notification rules. Remove one first — say "list my notification rules".`,
		};
	}
	const dupe = current.find((r) => signature(r) === signature(rule));
	if (dupe) {
		return { ok: false, error: `You already have that rule — ${describeRule(dupe)}` };
	}
	return { ok: true, rules: [...current, rule] };
}

export type RemoveResult = { ok: true; rules: NotificationRule[]; removed: NotificationRule } | { ok: false; error: string };

/** Remove by rule id, or by the 1-based position shown in the rendered list. Pure. */
export function removeRule(rules: unknown, ref: string): RemoveResult {
	const current = validRules(rules);
	if (!current.length) {
		return { ok: false, error: 'You have no notification rules to remove.' };
	}
	const key = str(ref).replace(/^#/, '');
	if (!key) {
		return { ok: false, error: 'Which rule? Give me its number from the list, or its id.' };
	}
	let index = current.findIndex((r) => r.id === key);
	if (index < 0 && /^\d+$/.test(key)) {
		const n = Number(key);
		if (n >= 1 && n <= current.length) {
			index = n - 1;
		}
	}
	if (index < 0) {
		return { ok: false, error: `I couldn't find rule "${ref}". You have ${current.length}; say "list my notification rules" to see them numbered.` };
	}
	const removed = current[index];
	return { ok: true, rules: current.filter((_, i) => i !== index), removed };
}

/** Every structurally valid rule in a stored value, in order. Never throws. */
export function validRules(rules: unknown): NotificationRule[] {
	return Array.isArray(rules) ? rules.filter(isValidRule) : [];
}

/* ─────────────────────────── matching + evaluation ─────────────────────────── */

/** Does every condition this rule declares hold for this event? (Conditions AND together.) */
export function matchesRule(rule: NotificationRule, event: NotificationEvent): boolean {
	if (!isValidRule(rule)) {
		return false;
	}
	if (rule.roomId !== undefined && rule.roomId !== event.roomId) {
		return false;
	}
	if (rule.channel !== undefined) {
		const want = normName(rule.channel);
		const have = normName(event.roomName);
		if (!have || (have !== want && !have.includes(want))) {
			return false;
		}
	}
	if (rule.sender !== undefined && normName(rule.sender) !== normName(event.senderUsername)) {
		return false;
	}
	if (rule.senderRole !== undefined) {
		const want = str(rule.senderRole).toLowerCase();
		const roles = Array.isArray(event.senderRoles) ? event.senderRoles : [];
		if (!roles.some((r) => str(r).toLowerCase() === want)) {
			return false;
		}
	}
	if (rule.keyword !== undefined && !keywordMatches(rule.keyword, event.text)) {
		return false;
	}
	if (rule.window !== undefined && !inWindow(eventMinutesOfDay(event), rule.window)) {
		return false;
	}
	return true;
}

const ACTION_RANK: Record<NotificationAction, number> = { interrupt: 0, digest: 1, silence: 2 };

/** Precedence: specificity desc → most permissive action → later rule. See the file header. */
function pickWinner(candidates: NotificationRule[]): NotificationRule {
	let best = candidates[0];
	for (let i = 1; i < candidates.length; i++) {
		const r = candidates[i];
		const s = specificity(r);
		const bs = specificity(best);
		if (s > bs) {
			best = r;
			continue;
		}
		if (s < bs) {
			continue;
		}
		const a = ACTION_RANK[r.action];
		const ba = ACTION_RANK[best.action];
		if (a < ba) {
			best = r;
			continue;
		}
		if (a > ba) {
			continue;
		}
		best = r; // equal specificity, equal action → the later rule is the one we report
	}
	return best;
}

const DIRECT = (event: NotificationEvent): boolean => event.isDM === true || event.roomType === 'd';

/**
 * The whole feature in one function. Never throws; malformed rules are ignored; with no rules
 * at all a mention or DM ALWAYS returns `interrupt`.
 */
export function evaluateRules(rules: unknown, event: NotificationEvent): NotificationDecision {
	const list = validRules(rules);
	const direct = DIRECT(event);
	const mentioned = event.isMention === true;
	const protectedEvent = direct || mentioned;

	const matched = list.filter((r) => matchesRule(r, event));
	const matchedRuleIds = matched.map((r) => r.id);

	// Mention protection: a broad `digest` rule may not quietly swallow a message aimed at you.
	const applicable = matched.filter((r) => !(protectedEvent && r.action === 'digest' && r.includeMentions !== true));

	if (!applicable.length) {
		if (protectedEvent) {
			const swallowed = matched.length > 0;
			return {
				action: 'interrupt',
				matchedRuleIds,
				reason: swallowed
					? `A digest rule matched, but ${
							direct && !mentioned ? 'this is a direct message' : 'you were mentioned directly'
					  } — Chi never downgrades that to the digest unless the rule says to.`
					: `No rule applies and ${direct && !mentioned ? 'this is a direct message' : 'you were mentioned directly'}, so it interrupts you.`,
			};
		}
		return { action: 'digest', matchedRuleIds, reason: 'No rule matched — collected into your digest.' };
	}

	const winner = pickWinner(applicable);
	return { action: winner.action, ruleId: winner.id, matchedRuleIds, reason: `Your rule: ${describeRule(winner)}` };
}

/* ─────────────────────────── rendering ─────────────────────────── */

const ACTION_PHRASE: Record<NotificationAction, string> = {
	interrupt: 'Interrupt me',
	digest: 'Send to digest',
	silence: 'Silence',
};

/** One human-readable line per rule — what the rules list renders, and what confirmations echo. */
export function describeRule(rule: unknown): string {
	if (!isValidRule(rule)) {
		return 'Unreadable rule (ignored).';
	}
	const parts: string[] = [];
	if (rule.everything) {
		parts.push('every message');
	}
	if (rule.channel) {
		parts.push(`in #${normName(rule.channel)}`);
	}
	if (rule.roomId) {
		parts.push(`in room ${rule.roomId}`);
	}
	if (rule.sender) {
		parts.push(`from @${normName(rule.sender)}`);
	}
	if (rule.senderRole) {
		parts.push(`from anyone with the "${rule.senderRole}" role`);
	}
	if (rule.keyword) {
		parts.push(`mentioning "${rule.keyword}"`);
	}
	if (rule.window) {
		parts.push(`between ${rule.window.from} and ${rule.window.to}${crossesMidnight(rule.window) ? ' (overnight)' : ''}`);
	}
	const suffix = rule.includeMentions ? ' (even when you are mentioned directly)' : '';
	return `${ACTION_PHRASE[rule.action]} — ${parts.join(', ')}${suffix}`;
}

/** The numbered list the `list_notification_rules` tool renders. */
export function describeRules(rules: unknown): string[] {
	return validRules(rules).map((r, i) => `${i + 1}. ${describeRule(r)}  \`${r.id}\``);
}
