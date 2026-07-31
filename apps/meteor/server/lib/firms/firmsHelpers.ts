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
 * Firm invite links must always be FINITE (the 2026-07-30 audit found 15-day
 * unlimited-use links circulating). Stock findOrCreateInvite only accepts fixed
 * value sets (days ∈ [0,1,7,15,30], maxUses ∈ [0,1,5,10,25,50,100]; 0 means
 * unlimited/never-expires) — these lists mirror them but deliberately EXCLUDE 0
 * so no configuration can ever reopen unlimited firm invites.
 */
export const FIRM_INVITE_ALLOWED_DAYS = [1, 7, 15, 30] as const;
export const FIRM_INVITE_ALLOWED_USES = [1, 5, 10, 25, 50, 100] as const;
export const FIRM_INVITE_DEFAULT_DAYS = 7;
export const FIRM_INVITE_DEFAULT_MAX_USES = 25;

const toFiniteNumber = (raw: unknown): number | null => {
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
		return Number(raw);
	}
	return null;
};

/** Snap to the nearest allowed value; ties snap DOWN (the stricter choice). */
const snapToAllowed = (raw: unknown, allowed: readonly number[], fallback: number): number => {
	const value = toFiniteNumber(raw);
	if (value === null) {
		return fallback;
	}
	return allowed.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best));
};

/**
 * Resolve the admin-configurable firm-invite limits (Firms_Invite_Expiry_Days /
 * Firms_Invite_MaxUses) to values stock findOrCreateInvite accepts. Garbage
 * falls back to the defaults; 0 and negatives (Rocket.Chat's "unlimited" /
 * "never expires") snap UP to the smallest allowed value, never back to 0.
 */
export const resolveFirmInviteLimits = (rawDays: unknown, rawMaxUses: unknown): { days: number; maxUses: number } => ({
	days: snapToAllowed(rawDays, FIRM_INVITE_ALLOWED_DAYS, FIRM_INVITE_DEFAULT_DAYS),
	maxUses: snapToAllowed(rawMaxUses, FIRM_INVITE_ALLOWED_USES, FIRM_INVITE_DEFAULT_MAX_USES),
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
