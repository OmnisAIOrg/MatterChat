import type { IRoom, IUser } from '@rocket.chat/core-typings';
import type { Filter } from 'mongodb';

/**
 * MATTERCHAT: pure helpers for firm-scoped ROOM enumeration — no Meteor/model
 * imports so they stay unit-testable (see tests/unit/server/lib/firms/).
 *
 * Room cohort semantics (deliberately DIFFERENT from the user cohorts of
 * getFirmScopeExtraQuery, where a firm member sees ONLY their own firm):
 *
 *  - a room WITHOUT `customFields.firmId` is legacy / workspace-wide and stays
 *    visible to EVERY cohort (firm members included);
 *  - a room WITH a firmId is only enumerable by members of that firm;
 *  - admins, the firms-feature-off case and the scoping-off case see everything.
 *
 * This scopes DISCOVERY only. Membership-based access is untouched: every
 * caller composes the scope with (or alongside) the caller's own subscription
 * ids, so a user already in a room keeps seeing it regardless of firmId.
 */

/**
 * Collapse a `getFirmScopeExtraQuery` fragment into the caller's firm cohort
 * (same collapse the Firm Feed uses):
 *  - `undefined` → no scoping at all (feature off, scoping off, or admin);
 *  - `string`    → the caller's firmId;
 *  - `null`      → unstamped caller (account predating self-serve firms).
 */
export const firmCohortFromScope = (scope: Filter<IUser> | null | undefined): string | null | undefined => {
	if (!scope) {
		return undefined;
	}
	const cond = (scope as Record<string, unknown>)['customFields.firmId'];
	return typeof cond === 'string' ? cond : null;
};

/**
 * Mongo filter fragment restricting a room query to the caller's cohort, or
 * null when no scoping applies. Compose it INSIDE a `$and` so no sibling `$or`
 * (nor a caller-supplied query) can bypass it.
 *
 * `memberRoomIds` (the caller's subscribed room ids) keeps rooms the caller is
 * already a member of visible even when they carry another firm's stamp —
 * scoping is discovery-only, never a membership change.
 */
export const firmRoomScopeQuery = (cohort: string | null | undefined, memberRoomIds?: string[]): Filter<IRoom> | null => {
	if (cohort === undefined) {
		return null;
	}
	return {
		$or: [
			{ 'customFields.firmId': { $exists: false } },
			...(cohort ? [{ 'customFields.firmId': cohort }] : []),
			...(memberRoomIds?.length ? [{ _id: { $in: memberRoomIds } }] : []),
		],
	} as Filter<IRoom>;
};

/** Post-filter twin of `firmRoomScopeQuery` for single-doc lookups. */
export const roomMatchesFirmScope = (
	room: { customFields?: Record<string, unknown> } | null | undefined,
	cohort: string | null | undefined,
): boolean => {
	if (cohort === undefined) {
		return true;
	}
	if (!room) {
		return false;
	}
	const roomFirmId = room.customFields?.firmId;
	if (typeof roomFirmId !== 'string' || !roomFirmId) {
		// unstamped/legacy rooms stay workspace-wide
		return true;
	}
	return roomFirmId === cohort;
};

/**
 * Room customFields keys that are firm-owned SECURITY metadata, never
 * caller-writable:
 *  - `firmId`    — the enumeration cohort (firmsRoomScope queries key on it);
 *  - `firmTeam`  — marks a room as a firm's HOME team room. Forging it makes
 *    invite redemption adopt every redeemer into a cohort of the forger's
 *    choosing (useInviteToken); stripping it silently disables firm adoption
 *    AND exempts the room's invites from the tightenFirmInvites sweep;
 *  - `firmName`  — the display name adoptUserIntoFirm brands the redeemer with.
 */
export const FIRM_OWNED_ROOM_CUSTOM_FIELDS = ['firmId', 'firmTeam', 'firmName'] as const;

/**
 * `saveRoomSettings roomCustomFields` replaces room.customFields WHOLESALE, so
 * anyone with edit-room could strip or forge the firm stamp. This forces the
 * incoming object to keep the room's existing firm-owned keys (or none of
 * them). Never mutates its inputs.
 */
export const withPreservedRoomFirmId = (
	existing: Record<string, unknown> | undefined,
	incoming: Record<string, unknown>,
): Record<string, unknown> => {
	const result: Record<string, unknown> = { ...incoming };
	for (const key of FIRM_OWNED_ROOM_CUSTOM_FIELDS) {
		const existingValue = existing?.[key];
		// `undefined` and `null` both mean "the room does not carry this key" —
		// anything the caller sent for it is a forgery attempt and is dropped.
		if (existingValue === undefined || existingValue === null) {
			delete result[key];
		} else {
			result[key] = existingValue;
		}
	}
	return result;
};
