import type { IUser } from '@rocket.chat/core-typings';
import type { Filter } from 'mongodb';

/**
 * MATTERCHAT: pure helpers for self-serve firms — no Meteor/model imports so
 * they stay unit-testable (see tests/unit/server/lib/firms/).
 */

export const FIRM_NAME_MIN = 2;
export const FIRM_NAME_MAX = 60;
export const MAX_INVITES_PER_CALL = 25;

/** Strips control chars, collapses whitespace. Returns null if unusable. */
export const normalizeFirmName = (raw: unknown): string | null => {
	if (typeof raw !== 'string') {
		return null;
	}

	const cleaned = raw
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (cleaned.length < FIRM_NAME_MIN || cleaned.length > FIRM_NAME_MAX) {
		return null;
	}
	return cleaned;
};

/** Team (room) names must be slug-safe; the pretty name lives in customFields. */
export const slugifyFirmName = (name: string): string => {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return base || 'firm';
};

export const partitionEmails = (emails: unknown, isValidEmail: (email: string) => boolean): { valid: string[]; invalid: string[] } => {
	const valid: string[] = [];
	const invalid: string[] = [];
	if (!Array.isArray(emails)) {
		return { valid, invalid };
	}
	const seen = new Set<string>();
	for (const raw of emails) {
		if (typeof raw !== 'string') {
			continue;
		}
		const email = raw.trim().toLowerCase();
		if (!email || seen.has(email)) {
			continue;
		}
		seen.add(email);
		if (isValidEmail(email)) {
			valid.push(email);
		} else {
			invalid.push(email);
		}
	}
	return { valid, invalid };
};

/**
 * MATTERCHAT: invite-link options.
 *
 * These MUST mirror `possibleDays` / `possibleUses` in
 * server/lib/rooms/invites/findOrCreateInvite.ts, which whitelists them and
 * throws on anything else. We validate up front so the caller gets a firm-shaped
 * error naming the offending field, instead of a generic invite error from two
 * layers down — and so a bad value never reaches the point of creating a room
 * invite the caller did not ask for.
 */
export const INVITE_POSSIBLE_DAYS: readonly number[] = [0, 1, 7, 15, 30];
export const INVITE_POSSIBLE_USES: readonly number[] = [0, 1, 5, 10, 25, 50, 100];

/** 15 days / unlimited uses — the behaviour firm invites had before they were configurable. */
export const FIRM_INVITE_DEFAULT_DAYS = 15;
export const FIRM_INVITE_DEFAULT_MAX_USES = 0;

export type InviteOptionsResult =
	| { ok: true; days: number; maxUses: number }
	| { ok: false; field: 'days' | 'maxUses'; allowed: readonly number[] };

/**
 * Coerce + whitelist the caller's requested expiry and use count.
 *
 * `undefined`/`null` mean "unspecified" and take the default. Numeric strings
 * are accepted because REST bodies and form fields carry them, but nothing else
 * is coerced: booleans, arrays and empty strings all become 0 or 1 under
 * `Number()`, which are legal whitelist values — silently accepting them would
 * turn a client bug into a permanent, unlimited-use invite link.
 */
const coerceInviteNumber = (raw: unknown): number | null => {
	if (typeof raw === 'number') {
		return Number.isInteger(raw) ? raw : null;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed || !/^\d+$/.test(trimmed)) {
			return null;
		}
		return Number(trimmed);
	}
	return null;
};

export const validateInviteOptions = (rawDays: unknown, rawMaxUses: unknown): InviteOptionsResult => {
	let days = FIRM_INVITE_DEFAULT_DAYS;
	if (rawDays !== undefined && rawDays !== null) {
		const coerced = coerceInviteNumber(rawDays);
		if (coerced === null || !INVITE_POSSIBLE_DAYS.includes(coerced)) {
			return { ok: false, field: 'days', allowed: INVITE_POSSIBLE_DAYS };
		}
		days = coerced;
	}

	let maxUses = FIRM_INVITE_DEFAULT_MAX_USES;
	if (rawMaxUses !== undefined && rawMaxUses !== null) {
		const coerced = coerceInviteNumber(rawMaxUses);
		if (coerced === null || !INVITE_POSSIBLE_USES.includes(coerced)) {
			return { ok: false, field: 'maxUses', allowed: INVITE_POSSIBLE_USES };
		}
		maxUses = coerced;
	}

	return { ok: true, days, maxUses };
};

/** The stock Rocket.Chat invite proxy. A de-branded fork must not email links to it. */
export const ROCKETCHAT_DEEPLINK_HOST = 'go.rocket.chat';

/**
 * Decide which invite URL goes in the email.
 *
 * `findOrCreateInvite` already stamps the canonical URL from `getInviteUrl()`,
 * which honours `Accounts_Registration_InviteUrlType` and `DeepLink_Url` — that
 * is the URL to prefer, and using it is the fix for the hand-built one this
 * previously shipped.
 *
 * The one exception is the stock default: `Accounts_Registration_InviteUrlType`
 * defaults to `proxy` and `DeepLink_Url` to `https://go.rocket.chat`, so on an
 * untouched workspace the canonical URL sends a law firm's invitees through
 * rocket.chat. That is a de-branding regression, not a fix, so in exactly that
 * case we fall back to the direct workspace link. An operator who sets their own
 * `DeepLink_Url`, or switches the type to `direct`, gets the canonical URL.
 */
export const resolveFirmInviteUrl = (canonicalUrl: unknown, siteUrl: unknown, inviteId: string): string => {
	const site = typeof siteUrl === 'string' ? siteUrl.replace(/\/+$/, '') : '';
	const direct = `${site}/invite/${inviteId}`;

	if (typeof canonicalUrl !== 'string' || !canonicalUrl.trim()) {
		return direct;
	}
	let host: string;
	try {
		host = new URL(canonicalUrl).hostname.toLowerCase();
	} catch {
		return direct;
	}
	if (host === ROCKETCHAT_DEEPLINK_HOST || host.endsWith(`.${ROCKETCHAT_DEEPLINK_HOST}`)) {
		return direct;
	}
	return canonicalUrl;
};

/** True when `user` falls inside the cohort described by a getFirmScopeExtraQuery fragment. */
export const userMatchesFirmScope = (
	user: { customFields?: Record<string, unknown> } | null | undefined,
	scope: Filter<IUser> | null | undefined,
): boolean => {
	if (!scope) {
		return true;
	}
	if (!user) {
		return false;
	}
	const cond = (scope as Record<string, unknown>)['customFields.firmId'];
	const userFirmId = user.customFields?.firmId;
	if (typeof cond === 'string') {
		return userFirmId === cond;
	}
	// the only other shape produced is { $exists: false } — the "no firm" cohort
	return !userFirmId;
};
