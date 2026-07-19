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
