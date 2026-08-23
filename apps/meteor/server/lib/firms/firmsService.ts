import { Team } from '@rocket.chat/core-services';
import type { IRoom, IUser, ITeam } from '@rocket.chat/core-typings';
import { TeamType } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import type { FirmInviteDeliveryStatus } from './firmsHelpers';
import {
	FIRM_NAME_MAX,
	FIRM_NAME_MIN,
	MAX_INVITES_PER_CALL,
	normalizeFirmName,
	partitionEmails,
	planInviteDelivery,
	resolveFirmInviteLimits,
	slugifyFirmName,
} from './firmsHelpers';
import { firmCohortFromScope, firmRoomScopeQuery, withPreservedRoomFirmId } from './firmsRoomScope';
import { findOrCreateInvite } from '../../../app/invites/server/functions/findOrCreateInvite';
import * as Mailer from '../../../app/mailer/server/api';
import { settings } from '../../../app/settings/server';
import { isSMTPConfigured } from '../../../app/utils/server/functions/isSMTPConfigured';

export { normalizeFirmName, slugifyFirmName, partitionEmails, userMatchesFirmScope } from './firmsHelpers';
export { firmCohortFromScope, firmRoomScopeQuery, roomMatchesFirmScope, withPreservedRoomFirmId } from './firmsRoomScope';

/**
 * MATTERCHAT: Self-serve firms.
 *
 * A "firm" is a private Team plus a `customFields.firmId` stamp on each member's
 * user doc (firmId === the team's _id). This is deliberately NOT tenancy — the
 * multiworkspace spike rejected a tenant rewrite — it is a membership boundary
 * used to (a) group a self-served org into its own private team on signup,
 * (b) route email invites into that team, and (c) scope the user directory /
 * search surfaces so firms don't see each other (see getFirmScopeExtraQuery).
 *
 * Everything is gated on the `Firms_SelfServe_Enabled` setting; with it off,
 * nothing here runs and the workspace behaves exactly as before.
 */

export const isSelfServeFirmsEnabled = (): boolean => settings.get<boolean>('Firms_SelfServe_Enabled') === true;

export type FirmInfo = {
	firmId: string;
	name: string;
	roomId: string;
	isOwner: boolean;
};

const getUserOrThrow = async (userId: string): Promise<IUser> => {
	const user = await Users.findOneById(userId);
	if (!user) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'firms' });
	}
	return user;
};

export const getFirmForUser = async (user: IUser): Promise<FirmInfo | null> => {
	const firmId = (user.customFields as Record<string, unknown> | undefined)?.firmId;
	if (typeof firmId !== 'string' || !firmId) {
		return null;
	}
	const team = await Team.getOneById<ITeam>(firmId);
	if (!team) {
		return null;
	}
	const prettyName = (user.customFields as Record<string, unknown> | undefined)?.firmName;
	return {
		firmId,
		name: typeof prettyName === 'string' && prettyName ? prettyName : team.name,
		roomId: team.roomId,
		isOwner: (user.customFields as Record<string, unknown> | undefined)?.firmRole === 'owner',
	};
};

export const createFirm = async (userId: string, rawName: unknown): Promise<FirmInfo> => {
	if (!isSelfServeFirmsEnabled()) {
		throw new Meteor.Error('error-not-allowed', 'Self-serve firms are disabled', { method: 'firms.create' });
	}
	const name = normalizeFirmName(rawName);
	if (!name) {
		throw new Meteor.Error('error-invalid-firm-name', `Firm name must be ${FIRM_NAME_MIN}-${FIRM_NAME_MAX} characters`, {
			method: 'firms.create',
		});
	}
	const user = await getUserOrThrow(userId);
	if ((user.customFields as Record<string, unknown> | undefined)?.firmId) {
		throw new Meteor.Error('error-already-in-firm', 'You already belong to a firm', { method: 'firms.create' });
	}

	// Team names are unique; retry with numeric suffixes so two "Smith Law"
	// firms can both sign up (the pretty name is not required to be unique).
	const baseSlug = slugifyFirmName(name);
	let team: ITeam | null = null;
	let lastError: unknown;
	for (let attempt = 0; attempt < 5 && !team; attempt++) {
		const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
		try {
			team = await Team.create(userId, {
				team: { name: candidate, type: TeamType.PRIVATE },
				room: { name: candidate, readOnly: false, extraData: {} },
			});
		} catch (e: unknown) {
			lastError = e;
			const message = e instanceof Error ? e.message : String(e);
			if (!/exists|taken|duplicate/i.test(message)) {
				throw e;
			}
		}
	}
	if (!team) {
		throw lastError instanceof Error ? lastError : new Meteor.Error('error-firm-create-failed', 'Could not create the firm team');
	}

	// Mark the team main room as a firm room so invite redemption can adopt
	// joiners into the firm (see useInviteToken), and stamp the creator.
	// The firmId stamp must happen HERE (not in the beforeCreateRoom callback):
	// Team.create runs BEFORE the owner's customFields.firmId is written below,
	// so the callback sees an unstamped owner and would leave the firm's own
	// home room globally enumerable.
	await Rooms.updateOne(
		{ _id: team.roomId },
		{ $set: { 'customFields.firmTeam': true, 'customFields.firmName': name, 'customFields.firmId': team._id } },
	);
	await Users.updateOne(
		{ _id: userId },
		{ $set: { 'customFields.firmId': team._id, 'customFields.firmName': name, 'customFields.firmRole': 'owner' } },
	);

	return { firmId: team._id, name, roomId: team.roomId, isOwner: true };
};

/** Stamp a user into a firm (used by invite redemption). Never throws. */
export const adoptUserIntoFirm = async (userId: string, teamId: string, firmName?: string): Promise<void> => {
	try {
		await Users.updateOne(
			{ '_id': userId, 'customFields.firmId': { $exists: false } },
			{
				$set: {
					'customFields.firmId': teamId,
					'customFields.firmRole': 'member',
					...(firmName ? { 'customFields.firmName': firmName } : {}),
				},
			},
		);
	} catch (e) {
		// adoption is best-effort; joining the room already succeeded
		console.warn('[firms] failed to stamp firm membership', e);
	}
};

export type FirmInviteResult = {
	/** Handed to the mail transport. NOT a delivery receipt — see planInviteDelivery. */
	queued: string[];
	/** Malformed addresses, rejected before any send was attempted. */
	invalid: string[];
	/** Valid addresses that could not even be handed off (no mail transport, or the mailer threw). */
	undelivered: string[];
	emailDelivery: FirmInviteDeliveryStatus;
	/** Always usable — the fallback whenever emailDelivery !== 'queued'. */
	inviteUrl: string;
};

export const inviteToFirm = async (userId: string, emails: unknown): Promise<FirmInviteResult> => {
	if (!isSelfServeFirmsEnabled()) {
		throw new Meteor.Error('error-not-allowed', 'Self-serve firms are disabled', { method: 'firms.invite' });
	}
	const user = await getUserOrThrow(userId);
	const firm = await getFirmForUser(user);
	if (!firm) {
		throw new Meteor.Error('error-no-firm', 'You are not in a firm yet', { method: 'firms.invite' });
	}
	if (!firm.isOwner && !user.roles?.includes('admin')) {
		throw new Meteor.Error('error-not-allowed', 'Only the firm owner can invite teammates', { method: 'firms.invite' });
	}

	const { valid, invalid } = partitionEmails(emails, Mailer.checkAddressFormat);
	if (valid.length === 0) {
		throw new Meteor.Error('error-email-send-failed', 'No valid email addresses', { method: 'firms.invite' });
	}
	if (valid.length > MAX_INVITES_PER_CALL) {
		throw new Meteor.Error('error-too-many-invites', `At most ${MAX_INVITES_PER_CALL} invites per request`, { method: 'firms.invite' });
	}

	// A FINITE invite link into the firm team's main channel — expiry and max
	// redemptions come from the Firms_Invite_* settings, snapped to the value
	// sets stock findOrCreateInvite accepts and never unlimited (see
	// resolveFirmInviteLimits). Redeeming it registers the account, joins the
	// team room, and (because the room is customFields.firmTeam) adopts the
	// user into the firm. Stock validateInviteToken enforces both limits at
	// redemption; once a link expires or exhausts its uses, the next call here
	// mints a fresh one (findOrCreateInvite's dedupe query skips dead invites).
	const { days, maxUses } = resolveFirmInviteLimits(
		settings.get<number>('Firms_Invite_Expiry_Days'),
		settings.get<number>('Firms_Invite_MaxUses'),
	);
	const invite = await findOrCreateInvite(userId, { rid: firm.roomId, days, maxUses });
	if (!invite) {
		throw new Meteor.Error('error-invite-failed', 'Could not create the firm invite link', { method: 'firms.invite' });
	}
	const siteUrl = settings.get<string>('Site_Url')?.replace(/\/+$/, '') ?? '';
	const inviteUrl = `${siteUrl}/invite/${invite._id}`;

	const fromEmail = settings.get<string>('From_Email');
	const siteName = settings.get<string>('Site_Name') || 'MatterChat';
	const inviterName = user.name || user.username || 'A teammate';
	const subject = `${inviterName} invited you to ${firm.name} on ${siteName}`;
	const html =
		`<p>${inviterName} invited you to join <strong>${firm.name}</strong> on ${siteName} — secure messaging built for law firms.</p>` +
		`<p><a href="${inviteUrl}">Accept the invitation</a> to create your account and join the team.</p>` +
		`<p>If the button doesn't work, paste this link into your browser:<br/>${inviteUrl}</p>` +
		`<p>This invitation link expires in ${days} ${days === 1 ? 'day' : 'days'} and can be used up to ${maxUses} ${maxUses === 1 ? 'time' : 'times'}.</p>`;

	// Delivery honesty (2026-07-30 smoke defect): `Mailer.send` resolves once the
	// message is QUEUED (`sendNoWrap` ends in `setImmediate(() => Email.sendAsync…)`),
	// so awaiting it can never observe an SMTP failure — the old `sent` array was
	// structurally incapable of meaning "delivered" and its catch arm was dead code
	// for delivery errors. Prod has a live example of this (the M365 tenant block),
	// where a firm owner saw "invites sent" and no teammate ever received anything.
	// So: pre-flight the transport, report `queued` (handed off) vs `undelivered`
	// (never even attempted), and always hand back inviteUrl for manual distribution.
	const { toSend, undelivered, emailDelivery } = planInviteDelivery(valid, isSMTPConfigured());
	if (emailDelivery === 'unavailable') {
		console.warn(
			`[firms] no mail transport configured (SMTP_Host/MAIL_URL unset) — ${undelivered.length} firm invite email(s) NOT sent; share ${inviteUrl} manually`,
		);
	}

	const queued: string[] = [];
	for (const email of toSend) {
		try {
			await Mailer.send({ to: email, from: fromEmail, subject, html });
			queued.push(email);
		} catch (e) {
			console.warn(`[firms] invite email to ${email} could not be queued`, e);
			undelivered.push(email);
		}
	}

	return { queued, invalid, undelivered, emailDelivery, inviteUrl };
};

/**
 * ADMIN-ONLY firm (re)assignment — the supported way to correct a mis-stamped
 * account, move someone between firms, or un-stamp one entirely.
 *
 * It exists because there was NO such path (2026-07-30 smoke observation):
 * membership was writable only by firms.create, invite redemption, the OIDC org
 * stamp, or a direct DB write, and `users.update` with a customFields payload
 * silently no-opped while answering `success: true`. That silent door is now
 * closed (assertNoFirmOwnedCustomFields) and this is the loud one.
 *
 * Deliberately NOT gated on `Firms_SelfServe_Enabled`: an operator has to be able
 * to fix cohorts BEFORE the feature is switched on for a workspace.
 *
 * `firmId` accepts any non-empty id, not just a firm team's — OmnisAI org
 * cohorts stamp a CentralizedAuth orgId that has no team behind it. When no team
 * matches, the write still happens and `firmTeamFound: false` says so rather
 * than the call failing or pretending.
 *
 * Membership of the firm's team room is NOT changed here (stamping is the
 * cohort, joining is a room operation) — add or remove the user from the firm
 * team separately when they should also see its channel.
 */
export const setUserFirm = async (
	actorId: string,
	params: { userId?: unknown; username?: unknown; firmId?: unknown; firmName?: unknown; firmRole?: unknown },
): Promise<{
	userId: string;
	username?: string;
	firmId: string | null;
	firmName: string | null;
	firmRole: string | null;
	firmTeamFound: boolean;
}> => {
	const actor = await getUserOrThrow(actorId);
	if (!actor.roles?.includes('admin')) {
		throw new Meteor.Error('error-not-allowed', 'Only an admin can change firm membership', { method: 'firms.setUserFirm' });
	}

	const { userId, username, firmId, firmName, firmRole } = params;
	if (typeof userId !== 'string' && typeof username !== 'string') {
		throw new Meteor.Error('error-invalid-params', 'Provide userId or username', { method: 'firms.setUserFirm' });
	}
	const target =
		typeof userId === 'string' ? await Users.findOneById(userId) : await Users.findOneByUsernameIgnoringCase(username as string);
	if (!target) {
		throw new Meteor.Error('error-invalid-user', 'User not found', { method: 'firms.setUserFirm' });
	}

	// null / '' clears the stamp; the whole firm-owned key set goes with it so no
	// orphan firmName/firmRole/firmIdSource survives to confuse a later read.
	if (firmId === null || firmId === '') {
		await Users.updateOne(
			{ _id: target._id },
			{
				$unset: {
					'customFields.firmId': 1,
					'customFields.firmName': 1,
					'customFields.firmRole': 1,
					'customFields.firmIdSource': 1,
				},
			},
		);
		return { userId: target._id, username: target.username, firmId: null, firmName: null, firmRole: null, firmTeamFound: false };
	}

	if (typeof firmId !== 'string' || !firmId.trim()) {
		throw new Meteor.Error('error-invalid-firm', 'firmId must be a non-empty string, or null to clear', {
			method: 'firms.setUserFirm',
		});
	}
	const resolvedFirmId = firmId.trim();

	const role = firmRole === undefined ? 'member' : firmRole;
	if (role !== 'member' && role !== 'owner') {
		throw new Meteor.Error('error-invalid-firm-role', "firmRole must be 'member' or 'owner'", { method: 'firms.setUserFirm' });
	}

	const team = await Team.getOneById<ITeam>(resolvedFirmId);
	const teamRoom = team ? await Rooms.findOneById(team.roomId, { projection: { customFields: 1, name: 1 } }) : null;
	const teamFirmName = (teamRoom?.customFields as Record<string, unknown> | undefined)?.firmName;
	const explicitName = normalizeFirmName(firmName);
	const resolvedName = explicitName ?? (typeof teamFirmName === 'string' && teamFirmName ? teamFirmName : (team?.name ?? null));

	await Users.updateOne(
		{ _id: target._id },
		{
			$set: {
				'customFields.firmId': resolvedFirmId,
				'customFields.firmRole': role,
				'customFields.firmIdSource': 'admin',
				...(resolvedName ? { 'customFields.firmName': resolvedName } : {}),
			},
			...(resolvedName ? {} : { $unset: { 'customFields.firmName': 1 } }),
		},
	);

	return {
		userId: target._id,
		username: target.username,
		firmId: resolvedFirmId,
		firmName: resolvedName,
		firmRole: role,
		firmTeamFound: Boolean(team),
	};
};

/**
 * Directory/search scoping. Returns a Mongo filter fragment to append to user
 * searches, or null when no scoping should be applied (feature off, scoping
 * off, or the requester is an admin).
 *
 * Cohorts: users WITH a firmId only see their own firm; users WITHOUT a firmId
 * (accounts predating self-serve firms) only see other unstamped users. Admins
 * always see everyone.
 */
export const getFirmScopeExtraQuery = async (userId: string | null | undefined): Promise<Filter<IUser> | null> => {
	if (!userId || !isSelfServeFirmsEnabled() || settings.get<boolean>('Firms_Scoped_Directory') !== true) {
		return null;
	}
	const user = await Users.findOneById(userId, { projection: { roles: 1, customFields: 1 } });
	if (!user || user.roles?.includes('admin')) {
		return null;
	}
	const firmId = (user.customFields as Record<string, unknown> | undefined)?.firmId;
	if (typeof firmId === 'string' && firmId) {
		return { 'customFields.firmId': firmId } as Filter<IUser>;
	}
	return { 'customFields.firmId': { $exists: false } } as Filter<IUser>;
};

/**
 * The caller's firm cohort, collapsed from getFirmScopeExtraQuery:
 * `undefined` = no scoping (feature off / scoping off / admin), `string` = the
 * caller's firmId, `null` = unstamped caller. Shared by the Firm Feed and the
 * room-enumeration scope so there is exactly ONE cohort definition.
 */
export const getCallerFirmCohort = async (userId: string | null | undefined): Promise<string | null | undefined> =>
	firmCohortFromScope(await getFirmScopeExtraQuery(userId));

/**
 * Room-enumeration scoping (spotlight, directory, channels.list, teams
 * autocomplete…). Returns a Mongo filter fragment to compose INSIDE a `$and`
 * of room searches, or null when no scoping applies. NOTE the room cohort
 * semantics differ from the user directory: rooms with NO firmId are
 * legacy/workspace-wide and stay visible to every cohort. Pass the caller's
 * subscribed room ids as `memberRoomIds` on surfaces that list rooms the
 * caller is already in — membership always wins over the firm stamp.
 */
export const getFirmRoomScopeExtraQuery = async (
	userId: string | null | undefined,
	memberRoomIds?: string[],
): Promise<Filter<IRoom> | null> => firmRoomScopeQuery(await getCallerFirmCohort(userId), memberRoomIds);

/**
 * Guard for `saveRoomSettings roomCustomFields` (wholesale replace of
 * room.customFields, gated only by edit-room): non-admins always keep the
 * room's existing firm-owned keys (firmId / firmTeam / firmName) — they can
 * neither strip them (making a firm room globally enumerable, disabling firm
 * adoption on invite redemption, and exempting the room from the
 * tightenFirmInvites sweep) nor forge another firm's. Admins pass through
 * untouched, so an admin can deliberately un-stamp a room to make it
 * workspace-wide.
 *
 * Runs REGARDLESS of Firms_SelfServe_Enabled (2026-07-30 fixer). The feature
 * flag gates the FEATURE, not the forgery guard: while it is off (staging today)
 * any owner could plant a `customFields.firmId` that migration v340 then keeps
 * (it only fills absent stamps) and that this very function later PRESERVES
 * once the flag is turned on. Matches stampRoomFirmId.ts, which strips an
 * inbound firmId at creation before its own feature-flag early-return.
 */
export const sanitizeRoomCustomFieldsForActor = async (
	actorId: string,
	room: Pick<IRoom, 'customFields'>,
	incoming: Record<string, any>,
): Promise<Record<string, any>> => {
	const actor = await Users.findOneById(actorId, { projection: { roles: 1 } });
	if (actor?.roles?.includes('admin')) {
		return incoming;
	}
	return withPreservedRoomFirmId(room.customFields as Record<string, unknown> | undefined, incoming);
};
