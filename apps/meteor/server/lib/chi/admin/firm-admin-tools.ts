/**
 * Chi Firm-Admin Copilot (F7) — run YOUR firm in plain English.
 *
 * The five things a firm owner actually does — see the roster, put someone into the right
 * channels, find who has gone quiet, promote/demote, and switch an account off — exposed as Chi
 * tools.
 *
 * ## Why these are all `access: 'user'`
 *
 * A FIRM OWNER IS NOT A WORKSPACE ADMIN. `runTool` re-checks the workspace `admin` ROLE for any
 * tool marked `access: 'admin'`, so marking these 'admin' would hide the entire feature from the
 * very people it is for. They are therefore 'user' tools that enforce their own scope, exactly
 * like the `resolveTargetUser` pattern in tools.ts — except the permission being checked is
 * "same firm", not a workspace permission id.
 *
 * ## The scoping contract (do not weaken it)
 *
 *  1. Every tool derives its scope firm from `authorizeFirmAction` (pure, in
 *     ../firmadmin/firmAdminHelpers.ts) and NEVER from the raw tool input.
 *  2. Every user lookup that can act on someone else goes through `requireFirmMember`, which
 *     answers identically for "in another firm", "in no firm" and "does not exist" — a firm
 *     owner cannot probe the rest of the workspace through error messages.
 *  3. Every channel lookup enumerates `Rooms.findByTeamId(scopeFirmId)` and filters in memory.
 *     Channel names from the model are matched against that list, never queried globally, so a
 *     name collision with another firm's channel is unreachable by construction.
 *  4. A workspace admin may name any firm — but only ONE per call, and the target must live in
 *     that same firm, so no single call ever spans two firms.
 *
 * Audit is automatic: the service posts an audit entry after every executed tool.
 */
import type { IRoom, IUser } from '@rocket.chat/core-typings';
import { Rooms, Subscriptions, Users } from '@rocket.chat/models';

import type { ChiTool } from './tools';
import { hasRoleAsync } from '../../authorization/hasRole';
import type { FirmInfo } from '../../firms/firmsService';
import { getFirmForUser } from '../../firms/firmsService';
import { addUserToRoom } from '../../rooms/addUserToRoom';
import { setUserActiveStatus } from '../../users/setUserActiveStatus';
import type { FirmActionKind, FirmActor, FirmMemberRow, FirmRole } from '../firmadmin/firmAdminHelpers';
import {
	authorizeFirmAction,
	channelLabel,
	checkFirmOwnerFloor,
	formatFirmActivityReport,
	formatFirmMemberList,
	formatMembershipChange,
	formatRoleChange,
	matchesChannelQuery,
	outOfFirmMessage,
	parseFirmRole,
	parseSinceCutoff,
	summarizeChannelAddition,
} from '../firmadmin/firmAdminHelpers';

/** Hard cap on one roster read — a firm is a law firm, not a workspace. */
const FIRM_ROSTER_MAX = 500;
/** Hard cap on one bulk channel add, so a single sentence cannot fan out unboundedly. */
const MAX_CHANNEL_ADDS = 50;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const cf = (user: Pick<IUser, 'customFields'> | null | undefined): Record<string, unknown> =>
	(user?.customFields as Record<string, unknown> | undefined) ?? {};
const firmIdOf = (user: Pick<IUser, 'customFields'> | null | undefined): string | null => {
	const id = cf(user).firmId;
	return typeof id === 'string' && id ? id : null;
};
const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── caller context ────────────────────────────────────────────────────────────────── */

type FirmCtx = {
	actor: IUser;
	/** Everything the pure policy is allowed to see about the caller. */
	ref: FirmActor;
	/** The caller's OWN firm (null for a workspace admin who belongs to none). */
	own: FirmInfo | null;
};

async function firmContext(actor: IUser): Promise<FirmCtx> {
	// Re-read the role here rather than trusting actor.roles: the conversation can outlive a
	// demotion, and this is the switch between "one firm" and "any firm".
	const isWorkspaceAdmin = await hasRoleAsync(actor._id, 'admin');
	const own = await getFirmForUser(actor);
	let firmRole: FirmRole | null = null;
	if (own) {
		firmRole = own.isOwner ? 'owner' : 'member';
	}
	return {
		actor,
		own,
		ref: { userId: actor._id, username: actor.username, isWorkspaceAdmin, firmId: own?.firmId ?? null, firmRole },
	};
}

/** Display name of a firm we are not necessarily a member of (workspace-admin path). */
async function firmDisplayName(ctx: FirmCtx, firmId: string): Promise<string> {
	if (ctx.own?.firmId === firmId) {
		return ctx.own.name;
	}
	const main = await Rooms.findOne({ teamId: firmId, teamMain: true }, { projection: { fname: 1, name: 1, customFields: 1 } });
	const pretty = (main?.customFields as Record<string, unknown> | undefined)?.firmName;
	return (typeof pretty === 'string' && pretty) || main?.fname || main?.name || firmId;
}

/**
 * Turn the optional `firm` argument into a firm id. Non-admins may only ever name their own firm
 * (by id or name); anyone else naming another firm gets the standard out-of-firm refusal, so the
 * argument is not a way around the policy.
 */
async function resolveRequestedFirmId(ctx: FirmCtx, raw: string): Promise<string | null> {
	if (!raw) {
		return null;
	}
	if (!ctx.ref.isWorkspaceAdmin) {
		if (ctx.own && (raw === ctx.own.firmId || raw.toLowerCase() === ctx.own.name.toLowerCase())) {
			return ctx.own.firmId;
		}
		throw new Error(outOfFirmMessage());
	}
	const byId = await Rooms.findOne({ teamId: raw, teamMain: true }, { projection: { teamId: 1 } });
	if (byId?.teamId) {
		return byId.teamId;
	}
	const re = { $regex: escapeRx(raw), $options: 'i' };
	const byName = await Rooms.findOne(
		{ 'customFields.firmTeam': true, '$or': [{ fname: re }, { name: re }, { 'customFields.firmName': re }] },
		{ projection: { teamId: 1 } },
	);
	if (!byName?.teamId) {
		throw new Error(`I couldn't find a firm called "${raw}".`);
	}
	return byName.teamId;
}

/** Resolve + authorize the firm this call runs against. Throws the policy's own refusal text. */
async function resolveScope(
	ctx: FirmCtx,
	input: Record<string, unknown>,
	action: FirmActionKind,
): Promise<{ firmId: string; firmName: string }> {
	const requested = await resolveRequestedFirmId(ctx, str(input.firm));
	const decision = authorizeFirmAction({ actor: ctx.ref, action, firmId: requested });
	if (!decision.allowed) {
		throw new Error(decision.reason);
	}
	return { firmId: decision.firmId, firmName: await firmDisplayName(ctx, decision.firmId) };
}

const MEMBER_PROJECTION = {
	username: 1,
	name: 1,
	emails: 1,
	active: 1,
	roles: 1,
	lastLogin: 1,
	customFields: 1,
} as const;

/**
 * The one way a firm tool is allowed to name another human. "No such account", "in another firm"
 * and "in no firm" all produce the SAME refusal — the difference is exactly the information a
 * firm owner must not be able to extract about the rest of the workspace.
 */
async function requireFirmMember(ctx: FirmCtx, rawUsername: string, firmId: string, action: FirmActionKind): Promise<IUser> {
	const username = rawUsername.replace(/^@/, '').trim();
	if (!username) {
		throw new Error('Which member? Give me their username.');
	}
	const user = await Users.findOneByUsernameIgnoringCase<IUser>(username, { projection: MEMBER_PROJECTION });
	const decision = authorizeFirmAction({
		actor: ctx.ref,
		action,
		firmId,
		target: { username, firmId: user ? firmIdOf(user) : null },
	});
	if (!decision.allowed) {
		throw new Error(decision.reason);
	}
	if (!user) {
		// Unreachable in practice (a missing user has no firm, so the gate above already
		// refused) — kept so the function can never return undefined.
		throw new Error(outOfFirmMessage(username));
	}
	return user;
}

/** The firm's currently active owners — the input to the last-owner floor. */
async function activeOwnerIds(firmId: string): Promise<string[]> {
	const owners = await Users.find<Pick<IUser, '_id'>>(
		{ 'customFields.firmId': firmId, 'customFields.firmRole': 'owner', 'active': true },
		{ projection: { _id: 1 }, limit: FIRM_ROSTER_MAX },
	).toArray();
	return owners.map((o) => o._id);
}

async function firmRoster(firmId: string, includeInactive: boolean): Promise<IUser[]> {
	return Users.find<IUser>(
		{ 'customFields.firmId': firmId, 'type': 'user', ...(includeInactive ? {} : { active: true }) },
		{ projection: MEMBER_PROJECTION, sort: { username: 1 }, limit: FIRM_ROSTER_MAX },
	).toArray();
}

const toMemberRow = (u: IUser): FirmMemberRow => ({
	username: u.username || u._id,
	name: u.name,
	email: u.emails?.[0]?.address,
	role: parseFirmRole(cf(u).firmRole),
	active: u.active !== false,
	lastLogin: u.lastLogin ?? null,
});

/* ── the tools ─────────────────────────────────────────────────────────────────────── */

const listFirmMembers: ChiTool = {
	def: {
		name: 'list_firm_members',
		description:
			"List the people in YOUR firm — name, username, firm role (owner/member), email and when they last logged in. Read-only. Any member of the firm may run it; it only ever shows the caller's own firm (a workspace admin may pass `firm` to look at another one).",
		inputSchema: {
			type: 'object',
			properties: {
				firm: { type: 'string', description: 'Workspace admins only: another firm by name or id. Omit for your own firm.' },
				include_inactive: { type: 'boolean', description: 'Also list deactivated accounts (default false).' },
				query: { type: 'string', description: 'Optional case-insensitive filter on username, name or email.' },
			},
		},
	},
	access: 'user',
	async execute(input, actor) {
		const ctx = await firmContext(actor);
		const { firmId, firmName } = await resolveScope(ctx, input, 'read');
		const rows = (await firmRoster(firmId, input.include_inactive === true)).map(toMemberRow);
		const q = str(input.query).toLowerCase();
		const filtered = q ? rows.filter((r) => `${r.username} ${r.name || ''} ${r.email || ''}`.toLowerCase().includes(q)) : rows;
		return formatFirmMemberList(firmName, filtered, new Date());
	},
};

const addMemberToChannels: ChiTool = {
	def: {
		name: 'add_member_to_channels',
		description:
			'Add ONE person in your firm to MANY of your firm\'s channels at once — either every channel matching a description ("every litigation channel") or an explicit list. Only ever touches channels inside your own firm. Firm owners only; always asks for confirmation first.',
		inputSchema: {
			type: 'object',
			properties: {
				username: { type: 'string', description: 'The firm member to add.' },
				match: {
					type: 'string',
					description:
						'Plain-English channel filter, e.g. "litigation". Every word must appear in the channel name or topic. Empty means EVERY firm channel.',
				},
				channels: { type: 'array', items: { type: 'string' }, description: 'Optional explicit channel names instead of a filter.' },
				preview: { type: 'boolean', description: 'Just list which channels would match; changes nothing.' },
				firm: { type: 'string', description: 'Workspace admins only: act inside another firm.' },
			},
			required: ['username'],
		},
	},
	access: 'user',
	needsConfirm(input) {
		if (input.preview === true) {
			return undefined; // read-only dry run
		}
		const username = str(input.username);
		if (!username) {
			return undefined; // let execute() explain, without a confirm dance
		}
		const explicit = strArr(input.channels);
		return summarizeChannelAddition(username, str(input.match), explicit.length ? explicit : null);
	},
	async execute(input, actor) {
		const ctx = await firmContext(actor);
		// Administration, not reading — a plain firm member is refused here even though they may
		// read the same roster. `preview` is gated the same way on purpose: the channel list of a
		// firm includes private rooms the previewer may not be in, so it is owner-only too.
		const { firmId, firmName } = await resolveScope(ctx, input, 'administer');
		const target = await requireFirmMember(ctx, str(input.username), firmId, 'administer');

		// ONLY rooms belonging to this firm's team are ever considered — cross-firm channels are
		// not filtered out, they are never fetched.
		const teamRooms = await Rooms.findByTeamId(firmId, { projection: { _id: 1, name: 1, fname: 1, topic: 1 } }).toArray();
		const explicit = strArr(input.channels).map((c) => c.replace(/^#/, '').toLowerCase());
		const candidates: IRoom[] = explicit.length
			? teamRooms.filter((r) => explicit.includes((r.name || '').toLowerCase()) || explicit.includes((r.fname || '').toLowerCase()))
			: teamRooms.filter((r) => matchesChannelQuery(r, str(input.match)));

		if (input.preview === true) {
			if (!candidates.length) {
				return `No channel in **${firmName}** matches that.`;
			}
			return `${candidates.length} channel(s) in **${firmName}** match:\n${candidates.map((r) => `- ${channelLabel(r)}`).join('\n')}`;
		}
		if (candidates.length > MAX_CHANNEL_ADDS) {
			throw new Error(`Refusing: ${candidates.length} channels exceeds the per-call cap of ${MAX_CHANNEL_ADDS}. Narrow the filter.`);
		}

		const added: string[] = [];
		const alreadyIn: string[] = [];
		const failed: { channel: string; error: string }[] = [];
		for (const room of candidates) {
			const label = channelLabel(room);
			try {
				if (await Subscriptions.countByRoomIdAndUserId(room._id, target._id)) {
					alreadyIn.push(label);
					continue;
				}
				await addUserToRoom(room._id, { _id: target._id, username: target.username }, { _id: actor._id, username: actor.username });
				added.push(label);
			} catch (err) {
				failed.push({ channel: label, error: err instanceof Error ? err.message : String(err) });
			}
		}
		return formatMembershipChange({ username: target.username || target._id, added, alreadyIn, failed });
	},
};

const firmActivityReport: ChiTool = {
	def: {
		name: 'firm_activity_report',
		description:
			'Who in your firm has gone quiet: the members with no login since a cutoff you describe ("30 days", "6 weeks", "this month"). Read-only, and scoped to your own firm.',
		inputSchema: {
			type: 'object',
			properties: {
				since: {
					type: 'string',
					description:
						'How far back to look: "30 days", "6 weeks", "3 months", a plain number of days, or "today"/"this week"/"this month"/"this year". Default 30 days.',
				},
				include_inactive: { type: 'boolean', description: 'Also include already-deactivated accounts (default false).' },
				firm: { type: 'string', description: 'Workspace admins only: report on another firm.' },
			},
		},
	},
	access: 'user',
	async execute(input, actor) {
		const now = new Date();
		const parsed = parseSinceCutoff(input.since ?? input.days, now);
		if (!parsed.ok) {
			throw new Error(parsed.error);
		}
		const ctx = await firmContext(actor);
		const { firmId, firmName } = await resolveScope(ctx, input, 'read');
		const roster = await firmRoster(firmId, input.include_inactive === true);
		const stale = roster
			.filter((u) => !u.lastLogin || new Date(u.lastLogin).getTime() < parsed.cutoff.getTime())
			.sort((a, b) => new Date(a.lastLogin ?? 0).getTime() - new Date(b.lastLogin ?? 0).getTime())
			.map((u) => ({
				username: u.username || u._id,
				name: u.name,
				role: parseFirmRole(cf(u).firmRole),
				lastLogin: u.lastLogin ?? null,
			}));
		return formatFirmActivityReport(firmName, stale, { label: parsed.label, checked: roster.length }, now);
	},
};

const setFirmMemberRole: ChiTool = {
	def: {
		name: 'set_firm_member_role',
		description:
			"Promote a member of your firm to firm OWNER, or set an owner back to MEMBER. Firm owners only, inside their own firm, and always confirmed first. Refuses to demote the firm's last owner.",
		inputSchema: {
			type: 'object',
			properties: {
				username: { type: 'string' },
				role: { type: 'string', description: '"owner" or "member".' },
				firm: { type: 'string', description: 'Workspace admins only: act inside another firm.' },
			},
			required: ['username', 'role'],
		},
	},
	access: 'user',
	needsConfirm(input) {
		const role = parseFirmRole(input.role);
		const who = str(input.username) || 'that member';
		return role === 'owner'
			? `Make @${who.replace(/^@/, '')} an OWNER of the firm (full control of the firm roster)`
			: `Set @${who.replace(/^@/, '')} back to a plain firm MEMBER`;
	},
	async execute(input, actor) {
		const role = parseFirmRole(input.role);
		if (!role) {
			throw new Error('role must be "owner" or "member".');
		}
		const ctx = await firmContext(actor);
		const { firmId, firmName } = await resolveScope(ctx, input, 'administer');
		const target = await requireFirmMember(ctx, str(input.username), firmId, 'administer');
		const current = parseFirmRole(cf(target).firmRole);
		if (current === role) {
			return formatRoleChange(firmName, target.username || target._id, current, role);
		}
		if (role === 'member') {
			const floor = checkFirmOwnerFloor({
				activeOwnerIds: await activeOwnerIds(firmId),
				targetUserId: target._id,
				targetUsername: target.username,
				change: 'demote',
			});
			if (!floor.ok) {
				throw new Error(floor.reason);
			}
		}
		await Users.updateOne({ '_id': target._id, 'customFields.firmId': firmId }, { $set: { 'customFields.firmRole': role } });
		return formatRoleChange(firmName, target.username || target._id, current, role);
	},
};

const deactivateFirmMember: ChiTool = {
	def: {
		name: 'deactivate_firm_member',
		description:
			"Switch off (or back on, with reactivate=true) the account of someone in YOUR firm — the offboarding action. Firm owners only, inside their own firm, always confirmed first. Refuses to deactivate the firm's last owner, including yourself.",
		inputSchema: {
			type: 'object',
			properties: {
				username: { type: 'string' },
				reactivate: { type: 'boolean', description: 'Turn the account back ON instead of off.' },
				firm: { type: 'string', description: 'Workspace admins only: act inside another firm.' },
			},
			required: ['username'],
		},
	},
	access: 'user',
	needsConfirm(input) {
		const who = `@${(str(input.username) || 'that member').replace(/^@/, '')}`;
		return input.reactivate === true
			? `REACTIVATE the account of ${who}`
			: `DEACTIVATE the account of ${who} — they lose access immediately`;
	},
	async execute(input, actor) {
		const ctx = await firmContext(actor);
		const { firmId, firmName } = await resolveScope(ctx, input, 'administer');
		const target = await requireFirmMember(ctx, str(input.username), firmId, 'administer');
		const activate = input.reactivate === true;

		if (!activate) {
			// A firm owner must not be able to switch off a workspace admin who happens to sit in
			// their firm — that is a workspace-level account, not a firm one.
			if (!ctx.ref.isWorkspaceAdmin && target.roles?.includes('admin')) {
				throw new Error(`**@${target.username}** is a workspace administrator — only another workspace admin can deactivate that account.`);
			}
			const floor = checkFirmOwnerFloor({
				activeOwnerIds: await activeOwnerIds(firmId),
				targetUserId: target._id,
				targetUsername: target.username,
				change: 'deactivate',
			});
			if (!floor.ok) {
				throw new Error(floor.reason);
			}
			if (target.active === false) {
				return `**@${target.username}** is already deactivated.`;
			}
		} else if (target.active !== false) {
			return `**@${target.username}** is already active.`;
		}

		await setUserActiveStatus(target._id, activate, true, actor._id);
		return `**@${target.username}** in **${firmName}** is now ${activate ? 'ACTIVE again' : 'DEACTIVATED'}.`;
	},
};

/* ── registry ──────────────────────────────────────────────────────────────────────── */

/**
 * All five are `access: 'user'` on purpose — the scope check that matters is "same firm", which
 * `runTool`'s admin-role gate cannot express and which would lock firm owners out entirely.
 */
export const CHI_FIRM_ADMIN_TOOLS: ChiTool[] = [
	listFirmMembers,
	addMemberToChannels,
	firmActivityReport,
	setFirmMemberRole,
	deactivateFirmMember,
];
