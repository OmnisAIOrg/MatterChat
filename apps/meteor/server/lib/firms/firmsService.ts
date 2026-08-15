import { Team } from '@rocket.chat/core-services';
import type { IUser, IRoom, ITeam } from '@rocket.chat/core-typings';
import { TeamType } from '@rocket.chat/core-typings';
import { Invites, Rooms, Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import {
	FIRM_NAME_MAX,
	FIRM_NAME_MIN,
	MAX_INVITES_PER_CALL,
	normalizeFirmName,
	partitionEmails,
	resolveFirmInviteUrl,
	slugifyFirmName,
	validateInviteOptions,
} from './firmsHelpers';
import type { ChannelSpec } from './firmTemplates';
import { normalizePracticeAreas, resolveChannelPlan } from './firmTemplates';
import { postFirmWelcome } from './firmWelcome';
import { createRoom } from '../rooms/createRoom';
import { findOrCreateInvite } from '../rooms/invites/findOrCreateInvite';
import * as Mailer from '../notifications/email/api';
import { settings } from '../../settings';

export {
	normalizeFirmName,
	slugifyFirmName,
	partitionEmails,
	userMatchesFirmScope,
	validateInviteOptions,
	INVITE_POSSIBLE_DAYS,
	INVITE_POSSIBLE_USES,
} from './firmsHelpers';

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

export type CreateFirmOptions = {
	/**
	 * Practice-area ids from the onboarding concierge. Unknown or malformed
	 * values are ignored (see resolveChannelPlan) — a stale client must not be
	 * able to fail a signup.
	 */
	practiceAreas?: unknown;
};

export const createFirm = async (userId: string, rawName: unknown, options: CreateFirmOptions = {}): Promise<FirmInfo> => {
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
	// Record the practice areas we actually seeded from (normalized, so what is
	// stored is what happened — not what the client claimed). The Firm Console
	// reads this back to show and re-run the selection.
	const practiceAreas = normalizePracticeAreas(options.practiceAreas);
	await Rooms.updateOne(
		{ _id: team.roomId },
		{
			$set: {
				'fname': name,
				'customFields.firmTeam': true,
				'customFields.firmName': name,
				'customFields.firmPracticeAreas': practiceAreas,
			},
		},
	);
	await Users.updateOne(
		{ _id: userId },
		{
			$set: { 'customFields.firmId': team._id, 'customFields.firmName': name, 'customFields.firmRole': 'owner' },
			// Setup is done; the onboarding gate keys on this (see firmsOnboarding.ts).
			$unset: { 'customFields.needsFirmSetup': '' },
		},
	);

	const plan = resolveChannelPlan(practiceAreas);
	await seedStarterChannels(userId, team, name, plan);

	// Close the loop: say what was built, in the room they are about to land in.
	// Best-effort — the firm is already usable if this fails.
	await postFirmWelcome(team, name, plan, user);

	return { firmId: team._id, name, roomId: team.roomId, isOwner: true };
};

/**
 * Create the starter channels inside the firm's team.
 *
 * Best-effort by design: the firm itself already exists and is usable, so a
 * channel that fails to create must not fail the signup the user is standing
 * in front of. Each is logged and skipped.
 */
async function seedStarterChannels(userId: string, team: ITeam, firmName: string, channels: ChannelSpec[]): Promise<void> {
	const owner = await Users.findOneById(userId);
	if (!owner) {
		return;
	}

	for (const channel of channels) {
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
		// Whether THIS call created the firm, which decides ownership below.
		let createdHere = false;

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
					void seedStarterChannels(userId, team as ITeam, name, resolveChannelPlan([])).catch((err) =>
						console.warn('[firms] background starter-channel seeding failed', err),
					);
				});

				teamId = team._id;
				firmName = name;
				createdHere = true;
			}
		}

		if (!teamId) {
			return null;
		}

		await Users.updateOne(
			{ _id: userId },
			{
				$set: {
					'customFields.firmId': teamId,
					...(firmName ? { 'customFields.firmName': firmName } : {}),
					'customFields.omnisOrgId': orgId,
					// The user who brought the firm into existence owns it.
					//
					// This used to set no role at all, which looked harmless and was
					// not: firm ownership is what authorizes inviting teammates and
					// mirroring the CasePro roster, and a workspace only ever
					// auto-promotes its very FIRST user to workspace-admin. So the
					// second org to sign up had a firm nobody owned and nobody could
					// administer — a structural dead-end that no amount of retrying
					// could clear. Ownership here is per-firm, so org number two
					// onboards exactly like org number one.
					...(createdHere ? { 'customFields.firmRole': 'owner' } : {}),
				},
				$unset: { 'customFields.needsFirmSetup': '' },
			},
		);

		// Everyone else defaults to member — but only if they have no role yet, so
		// re-linking an existing owner (or someone promoted later) never demotes
		// them on their next sign-in.
		if (!createdHere) {
			await Users.updateOne(
				{ '_id': userId, 'customFields.firmRole': { $exists: false } },
				{ $set: { 'customFields.firmRole': 'member' } },
			);
		}

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

/**
 * Resolve the caller's firm and assert they may administer its invite links:
 * the firm owner, or a workspace admin. Shared by invite create / list / revoke
 * so the three cannot drift apart.
 */
const requireFirmInviteAdmin = async (userId: string, method: string): Promise<{ user: IUser; firm: FirmInfo }> => {
	if (!isSelfServeFirmsEnabled()) {
		throw new Meteor.Error('error-not-allowed', 'Self-serve firms are disabled', { method });
	}
	const user = await getUserOrThrow(userId);
	const firm = await getFirmForUser(user);
	if (!firm) {
		throw new Meteor.Error('error-no-firm', 'You are not in a firm yet', { method });
	}
	if (!firm.isOwner && !user.roles?.includes('admin')) {
		throw new Meteor.Error('error-not-allowed', 'Only the firm owner can manage firm invites', { method });
	}
	return { user, firm };
};

export type InviteToFirmOptions = {
	/** Days until the link expires. Must be one of INVITE_POSSIBLE_DAYS; 0 = never. */
	days?: unknown;
	/** How many times it may be redeemed. Must be one of INVITE_POSSIBLE_USES; 0 = unlimited. */
	maxUses?: unknown;
};

export const inviteToFirm = async (
	userId: string,
	emails: unknown,
	options: InviteToFirmOptions = {},
): Promise<{ sent: string[]; invalid: string[]; inviteUrl: string; inviteId: string; days: number; maxUses: number }> => {
	const { user, firm } = await requireFirmInviteAdmin(userId, 'firms.invite');

	// Rejected outright rather than clamped to the nearest legal value: an
	// invite link's lifetime and use count are exactly the sort of thing a
	// caller must not be silently given more of than it asked for.
	const inviteOptions = validateInviteOptions(options.days, options.maxUses);
	if (!inviteOptions.ok) {
		throw new Meteor.Error(
			inviteOptions.field === 'days' ? 'error-invalid-invite-days' : 'error-invalid-invite-max-uses',
			`Invalid ${inviteOptions.field}: must be one of ${inviteOptions.allowed.join(', ')}`,
			{ method: 'firms.invite', field: inviteOptions.field },
		);
	}
	const { days, maxUses } = inviteOptions;

	const { valid, invalid } = partitionEmails(emails, Mailer.checkAddressFormat);
	if (valid.length === 0) {
		throw new Meteor.Error('error-email-send-failed', 'No valid email addresses', { method: 'firms.invite' });
	}
	if (valid.length > MAX_INVITES_PER_CALL) {
		throw new Meteor.Error('error-too-many-invites', `At most ${MAX_INVITES_PER_CALL} invites per request`, { method: 'firms.invite' });
	}

	// An invite link into the firm team's main channel. Redeeming it registers
	// the account, joins the team room, and (because the room is
	// customFields.firmTeam) adopts the user into the firm.
	const invite = await findOrCreateInvite(userId, { rid: firm.roomId, days, maxUses });
	if (!invite) {
		throw new Meteor.Error('error-invite-failed', 'Could not create the firm invite link', { method: 'firms.invite' });
	}
	// `findOrCreateInvite` already stamps the canonical URL from its own
	// getInviteUrl() (which honours Accounts_Registration_InviteUrlType and
	// DeepLink_Url), so we use that instead of hand-building one — with the
	// stock-rocket.chat-proxy fallback explained in resolveFirmInviteUrl.
	const inviteUrl = resolveFirmInviteUrl(invite.url, settings.get<string>('Site_Url'), invite._id);

	const fromEmail = settings.get<string>('From_Email');
	const siteName = settings.get<string>('Site_Name') || 'MatterChat';
	const inviterName = user.name || user.username || 'A teammate';
	const subject = `${inviterName} invited you to ${firm.name} on ${siteName}`;
	const expiryLine = days > 0 ? `<p>This invitation link expires in ${days} ${days === 1 ? 'day' : 'days'}.</p>` : '';
	const html =
		`<p>${inviterName} invited you to join <strong>${firm.name}</strong> on ${siteName} — secure messaging built for law firms.</p>` +
		`<p><a href="${inviteUrl}">Accept the invitation</a> to create your account and join the team.</p>` +
		`<p>If the button doesn't work, paste this link into your browser:<br/>${inviteUrl}</p>` +
		`${expiryLine}`;

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

	return { sent, invalid, inviteUrl, inviteId: invite._id, days, maxUses };
};

export type FirmInviteDTO = {
	_id: string;
	url: string;
	days: number;
	maxUses: number;
	uses: number;
	createdAt: string;
	expires: string | null;
	createdBy: string;
};

/**
 * The firm's live invite links.
 *
 * Scoped to the firm's team main room — that is the only room firm invites are
 * ever created against — and filtered to links that can still be redeemed, so
 * the list answers "who can walk in right now", which is the question an owner
 * revoking a link is actually asking. Expired and exhausted links are omitted
 * rather than shown as inert clutter.
 */
export const listFirmInvites = async (userId: string): Promise<FirmInviteDTO[]> => {
	const { firm } = await requireFirmInviteAdmin(userId, 'firms.invites.list');

	const now = new Date();
	const invites = await Invites.find(
		{
			rid: firm.roomId,
			$and: [
				{ $or: [{ expires: null }, { expires: { $exists: false } }, { expires: { $gt: now } }] },
				{ $or: [{ maxUses: 0 }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
			],
		},
		{ sort: { createdAt: -1 } },
	).toArray();

	const siteUrl = settings.get<string>('Site_Url');
	return invites.map((invite) => ({
		_id: invite._id,
		url: resolveFirmInviteUrl(invite.url, siteUrl, invite._id),
		days: invite.days,
		maxUses: invite.maxUses,
		uses: invite.uses,
		createdAt: invite.createdAt instanceof Date ? invite.createdAt.toISOString() : String(invite.createdAt),
		expires: invite.expires instanceof Date ? invite.expires.toISOString() : null,
		createdBy: invite.userId,
	}));
};

/**
 * Revoke an invite link — delete the invite document, so the token stops
 * resolving (validateInviteToken 404s) and anyone holding the link is out.
 *
 * The delete is scoped by `rid` to the firm's own team room, so an id belonging
 * to another firm's (or any other) invite is a not-found, never a cross-firm
 * delete. Note this only closes the door: people who already redeemed the link
 * remain members, which is the correct and expected behaviour.
 */
export const revokeFirmInvite = async (userId: string, rawInviteId: unknown): Promise<{ revoked: boolean }> => {
	const { firm } = await requireFirmInviteAdmin(userId, 'firms.invites.revoke');
	if (typeof rawInviteId !== 'string' || !rawInviteId.trim()) {
		throw new Meteor.Error('error-invalid-params', 'An invite id is required', { method: 'firms.invites.revoke' });
	}
	const result = await Invites.deleteOne({ _id: rawInviteId.trim(), rid: firm.roomId });
	if (!result.deletedCount) {
		throw new Meteor.Error('error-invite-not-found', 'No such invite link for your firm', { method: 'firms.invites.revoke' });
	}
	return { revoked: true };
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
