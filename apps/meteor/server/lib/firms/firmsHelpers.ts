import type { IUser } from '@rocket.chat/core-typings';
import type { Filter } from 'mongodb';

/**
 * MATTERCHAT: pure helpers for self-serve firms — no Meteor/model imports so
 * they stay unit-testable (see tests/unit/server/lib/firms/).
 */

export const FIRM_NAME_MIN = 2;
export const FIRM_NAME_MAX = 60;
export const MAX_INVITES_PER_CALL = 25;

/**
 * Firm invite-link hardening: the values the Firms_Invite_* select settings
 * offer. Days MUST stay a subset of findOrCreateInvite's possibleDays and
 * maxUses a subset of its possibleUses; 0 (unlimited) is deliberately absent
 * from both — every firm invite link is finite.
 */
export const FIRM_INVITE_ALLOWED_DAYS = [1, 3, 7, 15, 30];
export const FIRM_INVITE_ALLOWED_MAX_USES = [5, 10, 25, 50, 100];
export const FIRM_INVITE_DEFAULT_DAYS = 3;
export const FIRM_INVITE_DEFAULT_MAX_USES = 25;

const parseInviteLimit = (raw: unknown, allowed: number[], fallback: number): number => {
	const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
	return Number.isInteger(value) && allowed.includes(value) ? value : fallback;
};

/**
 * Resolves the firm invite-link limits from raw setting values. Select
 * settings store the chosen option's STRING key, and OVERWRITE_SETTING_* env
 * seeding can inject arbitrary values, so both inputs are parsed and checked
 * against the allowed lists; anything unrecognized falls back to the hardened
 * defaults (3 days / 25 uses) — never to unlimited, and never to a value
 * findOrCreateInvite would reject with invalid-number-of-days/-uses.
 */
export const resolveInviteLimits = (rawDays: unknown, rawMaxUses: unknown): { days: number; maxUses: number } => ({
	days: parseInviteLimit(rawDays, FIRM_INVITE_ALLOWED_DAYS, FIRM_INVITE_DEFAULT_DAYS),
	maxUses: parseInviteLimit(rawMaxUses, FIRM_INVITE_ALLOWED_MAX_USES, FIRM_INVITE_DEFAULT_MAX_USES),
});

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
