/**
 * Chi Firm-Admin Copilot (F7) — the PURE decision layer.
 *
 * No Meteor, no models, no settings, no clock: every decision this feature makes is a function
 * of its arguments, so the security-critical part is unit-testable in isolation
 * (tests/unit/server/lib/chi/firmadmin/firmAdminHelpers.spec.ts). Same "pure module first"
 * pattern as chi/admin/helpers.ts and firms/firmsHelpers.ts.
 *
 * ## The property this module exists to guarantee
 *
 * A FIRM OWNER IS NOT A WORKSPACE ADMIN. A firm owner runs their own firm and must not be able
 * to read or change anything belonging to another firm; a workspace admin may act in any firm,
 * but only in ONE firm per operation — they cannot mix two firms in a single action either.
 * `authorizeFirmAction` is the single gate for that policy: every firm-admin tool routes through
 * it, and refusals are deliberately indistinguishable between "that user is in another firm" and
 * "that user is in no firm at all" so the refusal itself cannot be used to probe other firms.
 */

/* ── roles ─────────────────────────────────────────────────────────────────────────── */

/** The per-firm role stored at `customFields.firmRole`. Orthogonal to workspace ROLES. */
export type FirmRole = 'owner' | 'member';

export const FIRM_ROLES: readonly FirmRole[] = ['owner', 'member'];

/** Coerce an untrusted value (a user doc's customFields, a tool argument) to a firm role. */
export function parseFirmRole(value: unknown): FirmRole | null {
	if (typeof value !== 'string') {
		return null;
	}
	const v = value.trim().toLowerCase();
	return v === 'owner' || v === 'member' ? v : null;
}

/* ── authorization ─────────────────────────────────────────────────────────────────── */

/** Everything the policy is allowed to know about the caller. */
export type FirmActor = {
	userId: string;
	username?: string;
	/** Holds the workspace `admin` ROLE (re-checked server-side per call, never cached in chat). */
	isWorkspaceAdmin: boolean;
	/** The caller's own firm, or null when they are in none. */
	firmId: string | null;
	/** The caller's role INSIDE their own firm. */
	firmRole: FirmRole | null;
};

/** `read` = look at the firm's own roster/activity. `administer` = change membership or roles. */
export type FirmActionKind = 'read' | 'administer';

/** The user an action is aimed at, if there is one. `firmId` is the TARGET's firm. */
export type FirmTargetRef = { username?: string; firmId?: string | null };

export type FirmAuthRequest = {
	actor: FirmActor;
	action: FirmActionKind;
	/** The firm the operation runs against. Omitted/null ⇒ the actor's own firm. */
	firmId?: string | null;
	/** The user being acted on, when there is one. */
	target?: FirmTargetRef;
};

export type FirmAuthScope = 'workspace-admin' | 'firm-owner' | 'firm-member';

export type FirmDenialCode =
	/** The caller is in no firm and is not a workspace admin. */
	| 'actor-no-firm'
	/** Workspace admin who belongs to no firm and named none — nothing to scope to. */
	| 'no-firm-scope'
	/** The caller is in the firm but only its owner may make this change. */
	| 'not-firm-owner'
	/** The requested firm, or the target user, is outside the firm this call may touch. */
	| 'out-of-firm';

export type FirmAuthDecision =
	| { allowed: true; scope: FirmAuthScope; firmId: string }
	| { allowed: false; code: FirmDenialCode; reason: string };

/**
 * The refusal shown for ANY out-of-scope target. Deliberately identical whether the target sits
 * in another firm, sits in no firm, or does not exist at all (the tool layer reuses this string
 * for "no such user"), so a firm owner cannot enumerate the rest of the workspace by reading
 * error messages. It also never names the other firm.
 */
export function outOfFirmMessage(username?: string): string {
	const who = username ? `**@${username.replace(/^@/, '')}**` : 'That';
	return `${who} is not part of your firm, so I can't act on it. I only ever work inside your own firm.`;
}

const deny = (code: FirmDenialCode, reason: string): FirmAuthDecision => ({ allowed: false, code, reason });

/**
 * THE policy. One function, one place, for:
 *
 *  - a WORKSPACE ADMIN may act in any firm (but must name one if they are in none);
 *  - a FIRM OWNER may read and administer their OWN firm, and nothing else;
 *  - a plain FIRM MEMBER may read their own firm but administer nothing;
 *  - anyone with no firm and no admin role may do nothing;
 *  - and, for EVERYONE including workspace admins, the target user must belong to the very firm
 *    the operation is scoped to — so no single call can ever reach across two firms.
 */
export function authorizeFirmAction(request: FirmAuthRequest): FirmAuthDecision {
	const { actor, action, target } = request;

	if (!actor.isWorkspaceAdmin && !actor.firmId) {
		return deny('actor-no-firm', 'You are not in a firm yet, so there is no firm for me to work on.');
	}

	const scopeFirmId = request.firmId ?? actor.firmId ?? null;
	if (!scopeFirmId) {
		// Only reachable for a workspace admin who belongs to no firm and named none.
		return deny('no-firm-scope', 'Tell me which firm to work on — your own account is not in one.');
	}

	if (!actor.isWorkspaceAdmin) {
		if (scopeFirmId !== actor.firmId) {
			return deny('out-of-firm', outOfFirmMessage());
		}
		if (action === 'administer' && actor.firmRole !== 'owner') {
			return deny('not-firm-owner', 'Only your firm owner can change the firm roster — ask them to run this.');
		}
	}

	if (target) {
		const targetFirmId = target.firmId ?? null;
		if (!targetFirmId || targetFirmId !== scopeFirmId) {
			return deny('out-of-firm', outOfFirmMessage(target.username));
		}
	}

	const firmScope: FirmAuthScope = actor.firmRole === 'owner' ? 'firm-owner' : 'firm-member';
	return { allowed: true, scope: actor.isWorkspaceAdmin ? 'workspace-admin' : firmScope, firmId: scopeFirmId };
}

/* ── the last-owner floor ──────────────────────────────────────────────────────────── */

export type OwnerFloorChange = 'demote' | 'deactivate';

export type OwnerFloorInput = {
	/** User ids of the firm's currently ACTIVE owners (deactivated owners do not count). */
	activeOwnerIds: string[];
	targetUserId: string;
	targetUsername?: string;
	change: OwnerFloorChange;
};

export type OwnerFloorResult = { ok: true } | { ok: false; reason: string };

/**
 * A firm must never be left with no owner: without one, nobody can invite, promote, or run the
 * firm again, and only a workspace admin could dig it out. Refuses the change when the target is
 * the firm's ONLY remaining active owner — for demotion and for deactivation alike, including
 * an owner deactivating themselves.
 */
export function checkFirmOwnerFloor({ activeOwnerIds, targetUserId, targetUsername, change }: OwnerFloorInput): OwnerFloorResult {
	const owners = new Set(activeOwnerIds.filter(Boolean));
	if (!owners.has(targetUserId)) {
		// Not an active owner — the change cannot empty the owner set.
		return { ok: true };
	}
	if (owners.size > 1) {
		return { ok: true };
	}
	const who = targetUsername ? `**@${targetUsername.replace(/^@/, '')}**` : 'That account';
	const verb = change === 'demote' ? 'demote' : 'deactivate';
	return {
		ok: false,
		reason: `Refusing to ${verb} ${who}: they are the firm's only owner, and a firm with no owner cannot be administered by anyone. Promote another member to owner first, then run this again.`,
	};
}

/* ── "how far back" parsing ────────────────────────────────────────────────────────── */

export const DEFAULT_INACTIVITY_DAYS = 30;
export const MAX_INACTIVITY_DAYS = 365;
/** Months are treated as 30-day units so the answer never depends on which month it is run in. */
export const DAYS_PER_MONTH = 30;

const DAY_MS = 86_400_000;

export type CutoffResult = { ok: true; cutoff: Date; label: string; days: number | null } | { ok: false; error: string };

/** How many days one of the accepted unit words is worth. */
const UNIT_DAYS: Record<string, number> = {
	d: 1,
	day: 1,
	days: 1,
	w: 7,
	wk: 7,
	week: 7,
	weeks: 7,
	m: DAYS_PER_MONTH,
	mo: DAYS_PER_MONTH,
	month: DAYS_PER_MONTH,
	months: DAYS_PER_MONTH,
};

const ACCEPTED_FORMS = '"30 days", "6 weeks", "3 months", a plain number of days, or "today" / "this week" / "this month" / "this year"';

const startOfUTCDay = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const fromDays = (now: Date, days: number, label: string): CutoffResult => {
	if (!Number.isInteger(days) || days < 1) {
		return { ok: false, error: `That has to be at least 1 day — I got "${label}".` };
	}
	if (days > MAX_INACTIVITY_DAYS) {
		return { ok: false, error: `That is too far back — ${MAX_INACTIVITY_DAYS} days is the maximum (I got ${days}).` };
	}
	return { ok: true, cutoff: new Date(now.getTime() - days * DAY_MS), label: `${days} day${days === 1 ? '' : 's'}`, days };
};

/**
 * Parse a human "how far back" phrase into an absolute cutoff, relative to the `now` handed in —
 * the clock is ALWAYS a parameter, never read here, so every caller (and every test) is
 * deterministic. Calendar phrases resolve in UTC so the answer does not move with the server's
 * timezone. Anything after the cutoff counts as "recent"; anything before it (or never) is stale.
 */
export function parseSinceCutoff(input: unknown, now: Date): CutoffResult {
	if (input === undefined || input === null || (typeof input === 'string' && !input.trim())) {
		return fromDays(now, DEFAULT_INACTIVITY_DAYS, `${DEFAULT_INACTIVITY_DAYS}`);
	}

	if (typeof input === 'number') {
		return Number.isFinite(input)
			? fromDays(now, input, String(input))
			: { ok: false, error: `I couldn't read "${String(input)}" as a time span. Try ${ACCEPTED_FORMS}.` };
	}

	if (typeof input !== 'string') {
		return { ok: false, error: `I couldn't read that as a time span. Try ${ACCEPTED_FORMS}.` };
	}

	// Strip the conversational scaffolding a sentence carries ("in the last 7 days ago" is a
	// thing models emit) so the span itself is what gets parsed.
	const raw = input
		.trim()
		.toLowerCase()
		.replace(/^(?:(?:in|within|over|the|last|past)\s+)+/, '')
		.replace(/\s+ago$/, '')
		.trim();

	// Calendar phrases ("this month"), with or without the leading "this".
	const calendar = raw.replace(/^this\s+/, '');
	if (calendar === 'today' || calendar === 'day') {
		return { ok: true, cutoff: startOfUTCDay(now), label: 'today', days: null };
	}
	if (calendar === 'week') {
		const start = startOfUTCDay(now);
		// ISO week: Monday starts it. getUTCDay() is 0=Sunday, so shift by 6 and wrap.
		const offset = (start.getUTCDay() + 6) % 7;
		return { ok: true, cutoff: new Date(start.getTime() - offset * DAY_MS), label: 'this week', days: null };
	}
	if (calendar === 'month') {
		return { ok: true, cutoff: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), label: 'this month', days: null };
	}
	if (calendar === 'year') {
		return { ok: true, cutoff: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), label: 'this year', days: null };
	}

	const match = /^(\d+)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)?$/.exec(raw);
	if (!match) {
		return { ok: false, error: `I couldn't read "${input.trim()}" as a time span. Try ${ACCEPTED_FORMS}.` };
	}
	return fromDays(now, Number(match[1]) * (UNIT_DAYS[match[2] ?? 'days'] ?? 1), raw);
}

/** Whole days between `then` and `now` (negative clamped to 0). `null`/invalid ⇒ null. */
export function daysSince(then: Date | string | number | null | undefined, now: Date): number | null {
	if (then === null || then === undefined) {
		return null;
	}
	const t = new Date(then).getTime();
	if (!Number.isFinite(t)) {
		return null;
	}
	return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** "never", "today", "yesterday", "12 days ago" — the last-seen column of every report here. */
export function formatLastLogin(then: Date | string | number | null | undefined, now: Date): string {
	const days = daysSince(then, now);
	if (days === null) {
		return 'never logged in';
	}
	if (days === 0) {
		return 'last login today';
	}
	if (days === 1) {
		return 'last login yesterday';
	}
	return `last login ${days} days ago`;
}

/* ── channel matching ──────────────────────────────────────────────────────────────── */

export type FirmChannelRef = { _id?: string; name?: string; fname?: string; topic?: string };

/** Display label for a firm channel: the pretty name if it has one, else the slug. */
export const channelLabel = (room: FirmChannelRef): string => `#${room.fname || room.name || room._id || 'channel'}`;

/**
 * Does this channel match a plain-English description ("every litigation channel")? Every word
 * of the query must appear somewhere in the channel's slug, display name or topic. An empty
 * query matches everything — callers decide whether "everything" is an acceptable blast radius.
 */
export function matchesChannelQuery(room: FirmChannelRef, query: string): boolean {
	const words = query
		.toLowerCase()
		.split(/[^a-z0-9]+/i)
		.filter((w) => w && !['channel', 'channels', 'every', 'all', 'the'].includes(w));
	if (!words.length) {
		return true;
	}
	const haystack = `${room.name || ''} ${room.fname || ''} ${room.topic || ''}`.toLowerCase();
	return words.every((w) => haystack.includes(w));
}

/* ── formatters (pure in, markdown out) ────────────────────────────────────────────── */

const MAX_PREVIEW = 5;

/** "a, b, c +4 more" — the shared way every summary here shortens a long list. */
export function previewList(items: string[], max = MAX_PREVIEW): string {
	if (!items.length) {
		return 'none';
	}
	const shown = items.slice(0, max).join(', ');
	return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

export type FirmMemberRow = {
	username: string;
	name?: string;
	email?: string;
	role: FirmRole | null;
	active: boolean;
	lastLogin?: Date | string | number | null;
};

/** The firm roster, one member per line: who they are, their firm role, and when they last showed up. */
export function formatFirmMemberList(firmName: string, rows: FirmMemberRow[], now: Date): string {
	if (!rows.length) {
		return `**${firmName}** has no members on the roster yet.`;
	}
	const owners = rows.filter((r) => r.role === 'owner').length;
	const lines = rows.map((r) => {
		const bits = [
			`**@${r.username}**`,
			r.name || '(no name)',
			r.role ?? 'no firm role',
			r.email || 'no email',
			formatLastLogin(r.lastLogin, now),
		];
		return `- ${bits.join(' — ')}${r.active ? '' : ' — **DEACTIVATED**'}`;
	});
	return [
		`**${firmName}** — ${rows.length} member${rows.length === 1 ? '' : 's'} (${owners} owner${owners === 1 ? '' : 's'}):`,
		...lines,
	].join('\n');
}

export type FirmActivityRow = {
	username: string;
	name?: string;
	role: FirmRole | null;
	lastLogin?: Date | string | number | null;
};

export type FirmActivityMeta = {
	/** How far back we looked, e.g. "30 days" or "this month". */
	label: string;
	/** How many firm members were checked in total. */
	checked: number;
};

/** "Who has gone quiet": the members with no login since the cutoff, longest-silent first. */
export function formatFirmActivityReport(firmName: string, rows: FirmActivityRow[], meta: FirmActivityMeta, now: Date): string {
	if (!meta.checked) {
		return `**${firmName}** has no members on the roster yet, so there is no activity to report.`;
	}
	if (!rows.length) {
		return `Everyone in **${firmName}** has logged in within ${meta.label} — all ${meta.checked} member${meta.checked === 1 ? '' : 's'} accounted for.`;
	}
	const lines = rows.map((r) => {
		const bits = [`**@${r.username}**`, r.name || '(no name)', r.role ?? 'no firm role', formatLastLogin(r.lastLogin, now)];
		return `- ${bits.join(' — ')}`;
	});
	return [
		`**${firmName}** — ${rows.length} of ${meta.checked} member${meta.checked === 1 ? '' : 's'} have not logged in within ${meta.label}:`,
		...lines,
	].join('\n');
}

export type MembershipChange = {
	username: string;
	/** Channel labels the user was actually added to by this call. */
	added: string[];
	/** Channel labels they were already in (no-ops, reported so the count adds up). */
	alreadyIn: string[];
	failed: { channel: string; error: string }[];
};

/** What a bulk channel-membership change actually did — including the parts that did nothing. */
export function formatMembershipChange(change: MembershipChange): string {
	const { username, added, alreadyIn, failed } = change;
	if (!added.length && !alreadyIn.length && !failed.length) {
		return `Nothing to do — no channels in your firm matched, so **@${username}** was not added anywhere.`;
	}
	const parts = [
		`**@${username}**: added to ${added.length} channel${added.length === 1 ? '' : 's'}${added.length ? ` — ${previewList(added)}` : ''}.`,
	];
	if (alreadyIn.length) {
		parts.push(`Already a member of ${alreadyIn.length}: ${previewList(alreadyIn)}.`);
	}
	if (failed.length) {
		parts.push(`Failed on ${failed.length}:\n${failed.map((f) => `- ${f.channel}: ${f.error}`).join('\n')}`);
	}
	return parts.join('\n');
}

/**
 * The confirmation line for a bulk channel add. `channels` is null when the caller described the
 * channels instead of listing them — `needsConfirm` is synchronous and cannot query, so in that
 * case we name the filter rather than invent a count.
 */
export function summarizeChannelAddition(username: string, match: string, channels: string[] | null): string {
	const who = `@${username.replace(/^@/, '')}`;
	if (channels) {
		return `Add ${who} to ${channels.length} channel${channels.length === 1 ? '' : 's'} in your firm: ${previewList(channels)}`;
	}
	const filter = match.trim() ? `matching "${match.trim()}"` : '(EVERY channel in the firm)';
	return `Add ${who} to every channel in your firm ${filter}`;
}

/** The one-line result of a firm role change. */
export function formatRoleChange(firmName: string, username: string, from: FirmRole | null, to: FirmRole): string {
	const who = `**@${username.replace(/^@/, '')}**`;
	if (from === to) {
		return `${who} is already ${to === 'owner' ? 'an owner' : 'a member'} of **${firmName}** — nothing changed.`;
	}
	const verb = to === 'owner' ? 'promoted to OWNER of' : 'set back to MEMBER of';
	return `${who} is now ${verb} **${firmName}** (was ${from ?? 'unset'}).`;
}

/* ── channel export (F7) ─────────────────────────────────────────────────────────────── */

export type ChannelExportFormatChoice = 'html' | 'json';

/**
 * Which archive format the user asked for.
 *
 * HTML is the default because the person asking is a paralegal or an office manager who wants
 * to open the thing and read it, not parse it. JSON is offered because "export" in a legal
 * context sometimes means "hand it to the e-discovery vendor". Anything unrecognised falls back
 * to HTML rather than erroring — a wrong word must not cost the user the export.
 */
export function parseExportFormat(input: unknown): ChannelExportFormatChoice {
	const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
	if (raw === 'json' || raw === 'data' || raw === 'raw') {
		return 'json';
	}
	return 'html';
}

export type ChannelExportSummary = {
	channel: string;
	firmName: string;
	url: string;
	messages: number;
	format: ChannelExportFormatChoice;
	/** Human label for the range covered, when the export was limited to one. */
	rangeLabel?: string;
};

/** What Chi says once the archive exists. The link is the point, so it leads. */
export function formatChannelExport(summary: ChannelExportSummary): string {
	const range = summary.rangeLabel ? ` from the last ${summary.rangeLabel}` : '';
	const count = summary.messages === 1 ? '1 message' : `${summary.messages} messages`;
	return [
		`**${summary.channel}** in **${summary.firmName}** is exported — [download the archive](${summary.url}).`,
		`${count}${range}, as ${summary.format === 'json' ? 'JSON' : 'HTML'}, with any files that were shared in the channel.`,
		'The link needs a MatterChat login, so it is safe to pass to someone else in the firm and useless to anyone outside it.',
	].join('\n');
}

/** The confirm-gate line shown before an export runs. */
export function summarizeChannelExport(channel: string, rangeLabel?: string): string {
	const range = rangeLabel ? ` covering the last ${rangeLabel}` : ' covering its whole history';
	return `Export ${channel}${range}, including files shared in it, and produce a download link.`;
}
