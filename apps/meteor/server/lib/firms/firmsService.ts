import { Team } from '@rocket.chat/core-services';
import type { IUser, IRoom, ITeam } from '@rocket.chat/core-typings';
import { TeamType } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import { FIRM_NAME_MAX, FIRM_NAME_MIN, MAX_INVITES_PER_CALL, normalizeFirmName, partitionEmails, slugifyFirmName } from './firmsHelpers';
import { createRoom } from '../rooms/createRoom';
import { findOrCreateInvite } from '../rooms/invites/findOrCreateInvite';
import * as Mailer from '../notifications/email/api';
import { settings } from '../../settings';

export { normalizeFirmName, slugifyFirmName, partitionEmails, userMatchesFirmScope } from './firmsHelpers';

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

/**
 * Starter channels seeded inside a brand-new firm.
 *
 * A firm with a single empty team room reads as "nothing happened" — which is
 * precisely the complaint that prompted this rework. Three channels named for
 * how a PI firm actually works give the workspace an obvious shape on first
 * load, and they are ordinary channels the firm can rename or delete.
 */
const STARTER_CHANNELS: { slug: string; display: string; topic: string }[] = [
	{ slug: 'general', display: 'General', topic: 'Firm-wide announcements and everything that has no better home.' },
	{ slug: 'intake', display: 'Intake', topic: 'New enquiries and prospective clients, before a matter exists.' },
	{ slug: 'referrals', display: 'Referrals', topic: 'Referrals in and out, and the relationships behind them.' },
];

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
	//
	// `fname` is the DISPLAY name. Team/room `name` must be a slug (it is the
	// URL and must be unique), but without an fname the sidebar shows
	// `smith-associates` — the user typed "Smith & Associates" and got what
	// looks like a channel someone else made. Setting fname is what makes the
	// firm read as the firm.
	await Rooms.updateOne(
		{ _id: team.roomId },
		{ $set: { 'fname': name, 'customFields.firmTeam': true, 'customFields.firmName': name } },
	);
	await Users.updateOne(
		{ _id: userId },
		{
			$set: { 'customFields.firmId': team._id, 'customFields.firmName': name, 'customFields.firmRole': 'owner' },
			// Setup is done; the onboarding gate keys on this (see firmsOnboarding.ts).
			$unset: { 'customFields.needsFirmSetup': '' },
		},
	);

	await seedStarterChannels(userId, team, name);

	return { firmId: team._id, name, roomId: team.roomId, isOwner: true };
};

/**
 * Create the starter channels inside the firm's team.
 *
 * Best-effort by design: the firm itself already exists and is usable, so a
 * channel that fails to create must not fail the signup the user is standing
 * in front of. Each is logged and skipped.
 */
async function seedStarterChannels(userId: string, team: ITeam, firmName: string): Promise<void> {
	const owner = await Users.findOneById(userId);
	if (!owner) {
		return;
	}

	for (const channel of STARTER_CHANNELS) {
		try {
			// Private, like the team itself — a law firm's channels should not be
			// discoverable by anyone who happens to be on the workspace.
			// `teamId` in the extra data is what puts the channel INSIDE the firm
			// rather than beside it.
			await createRoom('p', `${slugifyFirmName(firmName)}-${channel.slug}`, owner, [], false, false, {
				teamId: team._id,
				fname: channel.display,
				topic: channel.topic,
			} as Partial<IRoom>);
		} catch (err) {
			// Best-effort: the firm already exists and is usable. A channel that
			// fails to seed must not fail the signup the user is standing in
			// front of — worst case they create it themselves.
			console.warn(`[firms] could not seed the "${channel.slug}" channel for ${firmName}`, err);
		}
	}
}

/**
 * Find-or-create the firm that represents an Omnis (CentralAuth) organization,
 * and adopt the user into it.
 *
 * ## Why this exists
 *
 * Before this, MatterChat had TWO org models that never touched:
 *
 *   - self-serve firms, stamped as `customFields.firmId`;
 *   - CentralAuth's `profile.orgId`, which drove roster provisioning and
 *     nothing else.
 *
 * So a user who signed in through CentralAuth — already a member of an Omnis
 * org — carried no `firmId`, and was therefore prompted to "create your firm"
 * for a firm they were already in, and was treated as the *unstamped* cohort by
 * the directory scoping. One identity, two disagreeing answers to "who do you
 * work for".
 *
 * The org is now the source of truth when it is present: the firm is keyed on
 * `customFields.omnisOrgId`, so every member of one Omnis org lands in exactly
 * one MatterChat firm no matter who signs in first.
 *
 * Idempotent and never throws — this runs on the login path, and a firm-linking
 * hiccup must not stop someone signing in.
 */
export const ensureFirmForOrg = async (userId: string, orgId: string, orgName?: string): Promise<FirmInfo | null> => {
	if (!orgId) {
		return null;
	}
	try {
		const existingRoom = await Rooms.findOne(
			{ 'customFields.omnisOrgId': orgId },
			{ projection: { teamId: 1, _id: 1, 'customFields.firmName': 1 } },
		);

		let teamId = existingRoom?.teamId;
		let firmName = (existingRoom?.customFields as Record<string, unknown> | undefined)?.firmName as string | undefined;

		if (!teamId) {
			// First member of this org to sign in creates the firm. A concurrent
			// second login can lose this race, so the unique-name retry below
			// doubles as the reconciliation: the loser re-reads and adopts.
			const name = normalizeFirmName(orgName) || `Firm ${orgId.slice(0, 8)}`;
			const baseSlug = slugifyFirmName(name);
			let team: ITeam | null = null;
			for (let attempt = 0; attempt < 3 && !team; attempt++) {
				const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
				try {
					team = await Team.create(userId, {
						team: { name: candidate, type: TeamType.PRIVATE },
						room: { name: candidate, readOnly: false, extraData: {} },
					});
				} catch {
					// Name taken — either another firm, or the race above.
					const raced = await Rooms.findOne({ 'customFields.omnisOrgId': orgId }, { projection: { teamId: 1 } });
					if (raced?.teamId) {
						teamId = raced.teamId;
						break;
					}
				}
			}

			if (team) {
				await Rooms.updateOne(
					{ _id: team.roomId },
					{ $set: { 'fname': name, 'customFields.firmTeam': true, 'customFields.firmName': name, 'customFields.omnisOrgId': orgId } },
				);

				// Seed in the BACKGROUND. This function runs inline on the OIDC login
				// round-trip so the firm stamp exists before the client's first
				// users.info read — but three room creations do not need to be in
				// that critical path, and awaiting them would add their latency to
				// the first sign-in of every org. The channels appear a moment later;
				// the firm link, which is what gates the UI, is already committed.
				setImmediate(() => {
					void seedStarterChannels(userId, team as ITeam, name).catch((err) =>
						console.warn('[firms] background starter-channel seeding failed', err),
					);
				});

				teamId = team._id;
				firmName = name;
			}
		}

		if (!teamId) {
			return null;
		}

		// Adopt. The role is `member` unless they are the creator — org-level
		// ownership belongs to CentralAuth, not to whoever logged in first.
		await Users.updateOne(
			{ _id: userId },
			{
				$set: {
					'customFields.firmId': teamId,
					...(firmName ? { 'customFields.firmName': firmName } : {}),
					'customFields.omnisOrgId': orgId,
				},
				$unset: { 'customFields.needsFirmSetup': '' },
			},
		);

		const user = await Users.findOneById(userId);
		return user ? getFirmForUser(user) : null;
	} catch (err) {
		console.warn('[firms] could not link the Omnis org to a firm', err);
		return null;
	}
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
				// Joining by invite IS firm setup — without this the invitee is
				// still shown the "create your firm" wizard for a firm they just
				// joined, which is the exact confusion this rework removes.
				$unset: { 'customFields.needsFirmSetup': '' },
			},
		);
	} catch (e) {
		// adoption is best-effort; joining the room already succeeded
		console.warn('[firms] failed to stamp firm membership', e);
	}
};

export const inviteToFirm = async (userId: string, emails: unknown): Promise<{ sent: string[]; invalid: string[]; inviteUrl: string }> => {
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

	// A 15-day, unlimited-use invite link into the firm team's main channel.
	// Redeeming it registers the account, joins the team room, and (because the
	// room is customFields.firmTeam) adopts the user into the firm.
	const invite = await findOrCreateInvite(userId, { rid: firm.roomId, days: 15, maxUses: 0 });
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
		`<p>This invitation link expires in 15 days.</p>`;

	const sent: string[] = [];
	for (const email of valid) {
		try {
			await Mailer.send({ to: email, from: fromEmail, subject, html });
			sent.push(email);
		} catch (e) {
			console.warn(`[firms] invite email to ${email} failed`, e);
			invalid.push(email);
		}
	}

	return { sent, invalid, inviteUrl };
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
