/**
 * Chi Admin Assistant — the tool registry.
 *
 * Every tool is a THIN wrapper over the same internal functions the admin REST surface uses
 * (`saveUser`, `setUserActiveStatus`, `createRoom`, `addUserToRoom`, audited settings writes) —
 * Chi has no private powers. Two invariants enforced HERE, not in the prompt:
 *
 *  1. AUTHORITY IS THE SENDER'S: every tool executes AS the calling user, never as the bot or
 *     a service account. `runTool` re-checks the caller's authority at execution time: tools
 *     default to `access: 'admin'` (requires the admin ROLE); `access: 'user'` tools are open
 *     to every user but must scope any cross-user target through `resolveTargetUser`, which
 *     enforces the SAME permission ids the admin console/REST API enforce (e.g.
 *     users.setPreferences → 'edit-other-user-info'). Chi is a thin client over the existing
 *     RBAC layer — never a bypass. SHIPPING RULE: no new tool lands without declaring its
 *     `access` and routing cross-user targets through `resolveTargetUser`.
 *  2. DANGEROUS ⇒ CONFIRM: tools with a `needsConfirm` verdict do not run until the caller
 *     types `confirm` (service parks the exact call in confirm.ts — deterministic re-run).
 *
 * Results are plain strings for the model to relay; secret values are masked before they can
 * reach chat or audit. Every EXECUTED tool is mirrored to the audit channel by the service.
 */
import type { IUser } from '@rocket.chat/core-typings';
import { CustomSounds, ExternalWorkspaceConnections, Rooms, Settings, Subscriptions, Users } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

import { emitClientAction } from './actions';
import { CHI_WS_TOOLS } from './ws-tools';

import {
	BULK_CREATE_MAX,
	BULK_PREFS_MAX,
	DEFAULT_SOUND_IDS,
	auditArgs,
	deriveUsername,
	isSecretSetting,
	isSettingReadable,
	isSettingWritable,
	maskSecret,
	matchSound,
	normalizeSoundKey,
	parseBulkUsers,
} from './helpers';
import type { SoundOption } from './helpers';
import type { ToolDef } from './llm';
import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { hasRoleAsync } from '../../../../app/authorization/server/functions/hasRole';
import { addUserToRoom } from '../../../../app/lib/server/functions/addUserToRoom';
import { createRoom } from '../../../../app/lib/server/functions/createRoom';
import { saveUser } from '../../../../app/lib/server/functions/saveUser';
import { setUserActiveStatus } from '../../../../app/lib/server/functions/setUserActiveStatus';
import { notifyOnSettingChangedById } from '../../../../app/lib/server/lib/notifyListener';
import { settings } from '../../../../app/settings/server';
import { saveUserPreferences } from '../../../methods/saveUserPreferences';
import { updateAuditedByUser } from '../../../settings/lib/auditedSettingUpdates';

export type ChiToolAccess = 'admin' | 'user';

export type ChiTool = {
	def: ToolDef;
	/**
	 * Who may invoke it. 'admin' (the default) requires the workspace admin ROLE. 'user' tools
	 * are offered to every user — they must enforce per-target scoping themselves via
	 * `resolveTargetUser` (self is always allowed; anyone else needs the same permission id the
	 * admin console checks for that operation).
	 */
	access?: ChiToolAccess;
	/** Return a one-line plan summary when this call must be human-confirmed first. */
	needsConfirm?: (input: Record<string, unknown>) => string | undefined;
	execute: (input: Record<string, unknown>, actor: IUser) => Promise<string>;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

const tempPassword = (): string => `Mc-${Random.id(10)}!`;

async function requireUserByUsername(username: string): Promise<IUser> {
	const user = await Users.findOneByUsernameIgnoringCase<IUser>(username, {});
	if (!user) {
		throw new Error(`No user with username "${username}".`);
	}
	return user;
}

/**
 * Resolve the user a self-or-other tool acts on. No username (or the caller's own) → the caller
 * themselves, always allowed. Anyone else → the caller must hold the SAME permission id the
 * admin console/REST API enforces for that operation (users.setPreferences →
 * 'edit-other-user-info'; users.info full view → 'view-full-other-user-info').
 */
async function resolveTargetUser(actor: IUser, username: string, permissionForOthers: string): Promise<IUser> {
	if (!username || username.replace(/^@/, '').toLowerCase() === (actor.username || '').toLowerCase()) {
		return actor;
	}
	const target = await requireUserByUsername(username.replace(/^@/, ''));
	if (target._id === actor._id) {
		return actor;
	}
	if (!(await hasPermissionAsync(actor._id, permissionForOthers))) {
		throw new Error(
			`You can only do this for your own account — acting on @${target.username} needs the "${permissionForOthers}" permission (ask a workspace admin).`,
		);
	}
	return target;
}

/** Stock sounds + this workspace's uploaded custom sounds (what the Sound dropdown lists). */
async function availableSounds(): Promise<SoundOption[]> {
	const custom = await CustomSounds.find({}, { projection: { name: 1 }, limit: 200 }).toArray();
	return [...DEFAULT_SOUND_IDS.map((id) => ({ _id: id, name: id })), ...custom.map((s) => ({ _id: s._id, name: s.name || s._id }))];
}

/** Turn a human sound reference ("chime", "Notification.wav", "none") into the stored sound id. */
async function resolveSoundId(query: string): Promise<string> {
	if (!query) {
		throw new Error('sound is required.');
	}
	if (normalizeSoundKey(query) === 'none') {
		return 'none';
	}
	const options = await availableSounds();
	const match = matchSound(query, options);
	if (!match) {
		throw new Error(`No sound named "${query}". Available: none, ${options.map((o) => o._id).join(', ')}.`);
	}
	return match._id;
}

/** The per-user preference keys the notification tools read (the Account → Notifications surface). */
const NOTIFICATION_PREF_KEYS = [
	'newMessageNotification',
	'newRoomNotification',
	'notificationsSoundVolume',
	'masterVolume',
	'muteFocusedConversations',
	'desktopNotifications',
	'pushNotifications',
	'emailNotificationMode',
	'unreadAlert',
	'enableMobileRinging',
] as const;

/* ── the tools ─────────────────────────────────────────────────────────────────────── */

const listUsers: ChiTool = {
	def: {
		name: 'list_users',
		description: 'List workspace users, optionally filtered by a search term (username, name or email). Read-only.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Optional case-insensitive search term.' },
				include_inactive: { type: 'boolean', description: 'Also include deactivated users (default false).' },
			},
		},
	},
	async execute(input) {
		const q = str(input.query);
		const filter: Record<string, unknown> = { type: 'user' };
		if (!input.include_inactive) {
			filter.active = true;
		}
		if (q) {
			const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
			filter.$or = [{ username: re }, { name: re }, { 'emails.address': re }];
		}
		const users = await Users.find(filter, {
			projection: { username: 1, name: 1, emails: 1, roles: 1, active: 1 },
			sort: { username: 1 },
			limit: 30,
		}).toArray();
		if (!users.length) {
			return 'No matching users.';
		}
		const lines = users.map(
			(u) =>
				`- ${u.username} — ${u.name || '(no name)'} — ${u.emails?.[0]?.address || 'no email'} — roles: ${(u.roles || []).join(', ')}${u.active === false ? ' — DEACTIVATED' : ''}`,
		);
		return `${users.length} user(s):\n${lines.join('\n')}`;
	},
};

const createUser: ChiTool = {
	def: {
		name: 'create_user',
		description:
			'Create one workspace user. Generates a strong temporary password (returned so the admin can hand it over; the user must change it on first login). Email is marked verified so login is not blocked while workspace SMTP is down.',
		inputSchema: {
			type: 'object',
			properties: {
				email: { type: 'string' },
				name: { type: 'string', description: 'Full display name.' },
				username: { type: 'string', description: 'Optional; derived from the email when omitted.' },
				roles: { type: 'array', items: { type: 'string' }, description: 'Optional roles, default ["user"].' },
			},
			required: ['email'],
		},
	},
	needsConfirm(input) {
		const roles = strArr(input.roles);
		return roles.includes('admin') ? `Create user ${str(input.email)} WITH THE ADMIN ROLE` : undefined;
	},
	async execute(input, actor) {
		const email = str(input.email).toLowerCase();
		if (!email) {
			throw new Error('email is required.');
		}
		const username = str(input.username).toLowerCase() || deriveUsername(email);
		const roles = strArr(input.roles);
		const password = tempPassword();
		const userId = await saveUser(actor._id, {
			email,
			name: str(input.name) || username,
			username,
			password,
			roles: roles.length ? roles : ['user'],
			requirePasswordChange: true,
			verified: true,
			joinDefaultChannels: true,
			sendWelcomeEmail: false,
		});
		return `Created **${username}** (${email}), id ${userId}. Temporary password: \`${password}\` — share it privately; they must change it at first login.`;
	},
};

const bulkCreateUsers: ChiTool = {
	def: {
		name: 'bulk_create_users',
		description: `Create MANY users at once (max ${BULK_CREATE_MAX} per call). Input is a text blob, one user per line: "email", "email, Full Name" or "email, Full Name, username". Always requires the admin to confirm before running.`,
		inputSchema: {
			type: 'object',
			properties: {
				users_blob: { type: 'string', description: 'One user per line.' },
				roles: { type: 'array', items: { type: 'string' }, description: 'Roles for every created user, default ["user"].' },
			},
			required: ['users_blob'],
		},
	},
	needsConfirm(input) {
		const { rows, errors } = parseBulkUsers(str(input.users_blob));
		if (!rows.length) {
			return undefined; // nothing parseable — let execute() report the errors without a confirm dance
		}
		const preview = rows
			.slice(0, 5)
			.map((r) => r.email)
			.join(', ');
		const more = rows.length > 5 ? ` +${rows.length - 5} more` : '';
		const errNote = errors.length ? ` (${errors.length} line(s) will be skipped)` : '';
		return `Create ${rows.length} user(s): ${preview}${more}${errNote}`;
	},
	async execute(input, actor) {
		const { rows, errors } = parseBulkUsers(str(input.users_blob));
		if (!rows.length) {
			return `Nothing to create. Problems:\n${errors.map((e) => `- ${e}`).join('\n') || '- empty input'}`;
		}
		if (rows.length > BULK_CREATE_MAX) {
			throw new Error(`Refusing: ${rows.length} users exceeds the per-call cap of ${BULK_CREATE_MAX}. Split the list.`);
		}
		const roles = strArr(input.roles);
		const created: string[] = [];
		const failed: string[] = [...errors.map((e) => `- (parse) ${e}`)];
		for (const row of rows) {
			try {
				const password = tempPassword();
				await saveUser(actor._id, {
					email: row.email,
					name: row.name || row.username || deriveUsername(row.email),
					username: row.username || deriveUsername(row.email),
					password,
					roles: roles.length ? roles : ['user'],
					requirePasswordChange: true,
					verified: true,
					joinDefaultChannels: true,
					sendWelcomeEmail: false,
				});
				created.push(`- ${row.username} (${row.email}) — temp password: \`${password}\``);
			} catch (err) {
				failed.push(`- ${row.email}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		return [
			`Created ${created.length}/${rows.length} user(s).`,
			created.length ? `\n**Created (temp passwords — share privately):**\n${created.join('\n')}` : '',
			failed.length ? `\n**Skipped/failed:**\n${failed.join('\n')}` : '',
		].join('');
	},
};

const setUserRoles: ChiTool = {
	def: {
		name: 'set_user_roles',
		description: 'Replace a user\'s role list (e.g. ["user"], ["user","admin"], ["bot"]). Granting admin requires confirmation.',
		inputSchema: {
			type: 'object',
			properties: {
				username: { type: 'string' },
				roles: { type: 'array', items: { type: 'string' } },
			},
			required: ['username', 'roles'],
		},
	},
	needsConfirm(input) {
		return strArr(input.roles).includes('admin')
			? `Grant the ADMIN role to ${str(input.username)} (roles → ${strArr(input.roles).join(', ')})`
			: undefined;
	},
	async execute(input, actor) {
		const target = await requireUserByUsername(str(input.username));
		const roles = strArr(input.roles);
		if (!roles.length) {
			throw new Error('roles must be a non-empty list.');
		}
		await saveUser(actor._id, { _id: target._id, roles });
		return `Roles for **${target.username}** are now: ${roles.join(', ')}.`;
	},
};

const setUserActive: ChiTool = {
	def: {
		name: 'set_user_active',
		description: 'Activate or deactivate a user account. Deactivation requires confirmation.',
		inputSchema: {
			type: 'object',
			properties: {
				username: { type: 'string' },
				active: { type: 'boolean' },
			},
			required: ['username', 'active'],
		},
	},
	needsConfirm(input) {
		return input.active === false ? `DEACTIVATE the account of ${str(input.username)}` : undefined;
	},
	async execute(input, actor) {
		const target = await requireUserByUsername(str(input.username));
		if (target._id === actor._id) {
			throw new Error('Refusing to change the active status of the requesting admin.');
		}
		await setUserActiveStatus(target._id, input.active !== false, true, actor._id);
		return `**${target.username}** is now ${input.active !== false ? 'active' : 'deactivated'}.`;
	},
};

const resetUserPassword: ChiTool = {
	def: {
		name: 'reset_user_password',
		description:
			'Set a fresh temporary password for a user (returned to the admin to hand over; user must change it at first login). Use when someone is locked out — workspace email/SMTP is not required. Requires confirmation.',
		inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
	},
	needsConfirm(input) {
		return `Reset the password for ${str(input.username)} (a new temporary password will be minted)`;
	},
	async execute(input, actor) {
		const target = await requireUserByUsername(str(input.username));
		const password = tempPassword();
		await saveUser(actor._id, { _id: target._id, password, requirePasswordChange: true });
		return `New temporary password for **${target.username}**: \`${password}\` — share it privately; they must change it at first login.`;
	},
};

const createChannel: ChiTool = {
	def: {
		name: 'create_channel',
		description: 'Create a channel. Private by default; pass private=false for a public channel. Optionally add members (usernames).',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Channel name (no #).' },
				private: { type: 'boolean', description: 'Default true.' },
				members: { type: 'array', items: { type: 'string' }, description: 'Usernames to add at creation.' },
				read_only: { type: 'boolean' },
			},
			required: ['name'],
		},
	},
	async execute(input, actor) {
		const name = str(input.name).replace(/^#/, '');
		if (!name) {
			throw new Error('name is required.');
		}
		const members = strArr(input.members);
		const isPublic = input.private === false;
		const result = isPublic
			? await createRoom('c', name, actor, members, false, input.read_only === true)
			: await createRoom('p', name, actor, members, false, input.read_only === true);
		return `Created ${isPublic ? 'public' : 'private'} channel **#${name}** (rid ${result.rid})${members.length ? ` with ${members.length} member(s)` : ''}.`;
	},
};

const addUsersToChannel: ChiTool = {
	def: {
		name: 'add_users_to_channel',
		description: 'Add existing users (usernames) to an existing channel (by channel name).',
		inputSchema: {
			type: 'object',
			properties: {
				channel: { type: 'string', description: 'Channel name (no #).' },
				usernames: { type: 'array', items: { type: 'string' } },
			},
			required: ['channel', 'usernames'],
		},
	},
	async execute(input, actor) {
		const name = str(input.channel).replace(/^#/, '');
		const room = await Rooms.findOneByName(name);
		if (!room) {
			throw new Error(`No channel named "#${name}".`);
		}
		const added: string[] = [];
		const failed: string[] = [];
		for (const username of strArr(input.usernames)) {
			try {
				const user = await requireUserByUsername(username);
				await addUserToRoom(room._id, { _id: user._id, username: user.username }, { _id: actor._id, username: actor.username });
				added.push(username);
			} catch (err) {
				failed.push(`${username} (${err instanceof Error ? err.message : String(err)})`);
			}
		}
		return `#${name}: added ${added.length ? added.join(', ') : 'nobody'}${failed.length ? `; failed: ${failed.join('; ')}` : ''}.`;
	},
};

const workspaceInfo: ChiTool = {
	def: {
		name: 'workspace_info',
		description: 'Read-only workspace snapshot: user/channel counts and key toggles (registration, email verification, Slack, SMTP host).',
		inputSchema: { type: 'object', properties: {} },
	},
	async execute() {
		const [users, activeUsers, channels] = await Promise.all([
			Users.col.countDocuments({ type: 'user' }),
			Users.col.countDocuments({ type: 'user', active: true }),
			Rooms.col.countDocuments({ t: { $in: ['c', 'p'] } }),
		]);
		const rows = [
			`- Site: ${settings.get('Site_Url')} ("${settings.get('Site_Name')}")`,
			`- Users: ${activeUsers} active / ${users} total; channels: ${channels}`,
			`- Registration form: ${settings.get('Accounts_RegistrationForm')}`,
			`- Email verification required: ${settings.get('Accounts_EmailVerification')}`,
			`- SMTP host: ${settings.get('SMTP_Host') || '(unset)'} (from: ${settings.get('From_Email') || '(unset)'})`,
			`- Slack connector enabled: ${settings.get('Slack_Enabled')}`,
		];
		return rows.join('\n');
	},
};

const slackStatus: ChiTool = {
	def: {
		name: 'slack_status',
		description:
			'Read-only Slack integration health: connector settings (secrets shown masked/set-or-empty), and how many users have connected Slack workspaces.',
		inputSchema: { type: 'object', properties: {} },
	},
	async execute(_input, actor) {
		const connections = await ExternalWorkspaceConnections.col.countDocuments({ provider: 'slack' });
		const mine = await ExternalWorkspaceConnections.col.findOne({ provider: 'slack', userId: actor._id });
		const rows = [
			`- Slack_Enabled: ${settings.get('Slack_Enabled')}`,
			`- Slack_OAuth_Client_Id: ${settings.get('Slack_OAuth_Client_Id') || '(empty)'}`,
			`- Slack_OAuth_Client_Secret: ${settings.get('Slack_OAuth_Client_Secret') ? 'set' : 'EMPTY — OAuth cannot start'}`,
			`- Slack_Signing_Secret: ${settings.get('Slack_Signing_Secret') || process.env.SLACK_SIGNING_SECRET ? 'set' : 'EMPTY — inbound events are dropped'}`,
			`- Connected Slack workspaces (all users): ${connections}`,
			`- Your own Slack connection: ${mine ? `${(mine as { status?: string }).status || 'present'}` : 'not connected'}`,
			`- Inbound events endpoint: ${settings.get('Site_Url')}/_slack/events (must be the Slack app's Event Subscriptions Request URL)`,
		];
		return rows.join('\n');
	},
};

const slackConfigure: ChiTool = {
	def: {
		name: 'slack_configure',
		description:
			'Provision the Slack connector: enable/disable it and/or set the Slack app credentials (client id, client secret, signing secret). Values come from api.slack.com → the app → Basic Information. Requires confirmation.',
		inputSchema: {
			type: 'object',
			properties: {
				enabled: { type: 'boolean' },
				client_id: { type: 'string' },
				client_secret: { type: 'string' },
				signing_secret: { type: 'string' },
			},
		},
	},
	needsConfirm(input) {
		const parts: string[] = [];
		if (typeof input.enabled === 'boolean') {
			parts.push(`Slack_Enabled → ${input.enabled}`);
		}
		if (str(input.client_id)) {
			parts.push('set client id');
		}
		if (str(input.client_secret)) {
			parts.push('set client secret');
		}
		if (str(input.signing_secret)) {
			parts.push('set signing secret');
		}
		return parts.length ? `Slack connector change: ${parts.join(', ')}` : undefined;
	},
	async execute(input, actor) {
		const changes: [string, string | boolean][] = [];
		if (typeof input.enabled === 'boolean') {
			changes.push(['Slack_Enabled', input.enabled]);
		}
		if (str(input.client_id)) {
			changes.push(['Slack_OAuth_Client_Id', str(input.client_id)]);
		}
		if (str(input.client_secret)) {
			changes.push(['Slack_OAuth_Client_Secret', str(input.client_secret)]);
		}
		if (str(input.signing_secret)) {
			changes.push(['Slack_Signing_Secret', str(input.signing_secret)]);
		}
		if (!changes.length) {
			return 'Nothing to change — pass enabled and/or credentials.';
		}
		const audited = updateAuditedByUser({ _id: actor._id, username: actor.username || actor._id, ip: '', useragent: 'chi-admin-assistant' });
		for (const [id, value] of changes) {
			const result = await audited(Settings.updateValueNotHiddenById, id, value);
			if (result.modifiedCount || result.matchedCount) {
				await notifyOnSettingChangedById(id);
			}
		}
		return `Slack connector updated: ${changes.map(([id, v]) => `${id}=${isSecretSetting(id) ? maskSecret(v) : String(v)}`).join(', ')}. Users connect via ${Meteor.absoluteUrl('_slack/oauth/start')} (each person clicks it while signed in).`;
	},
};

const slackConnectLink: ChiTool = {
	def: {
		name: 'slack_connect_link',
		description: 'Get the per-user "Connect Slack" link and the checklist for making Slack inbound work. Read-only.',
		inputSchema: { type: 'object', properties: {} },
	},
	async execute() {
		return [
			`Connect link (each user opens it while signed in): ${Meteor.absoluteUrl('_slack/oauth/start')}`,
			`Inbound checklist: Slack app → Event Subscriptions → Request URL = ${settings.get('Site_Url')}/_slack/events; subscribe user events message.im, message.mpim, message.channels, message.groups; keep the app's signing secret in the workspace settings.`,
		].join('\n');
	},
};

const slackSetupGuide: ChiTool = {
	def: {
		name: 'slack_setup_guide',
		description:
			'The complete Slack onboarding runbook (admin app setup + per-user connect + troubleshooting). Use it to WALK an admin through bringing their Slack org into MatterChat step by step, or to diagnose "messages not arriving" complaints. Read-only. Pair with connector_status/slack_configure to check and apply as you go.',
		inputSchema: { type: 'object', properties: {} },
	},
	async execute() {
		const site = String(settings.get('Site_Url') || 'https://app.matterchat.com').replace(/\/+$/, '');
		return [
			'SLACK ONBOARDING RUNBOOK (full guide: docs/SLACK-CONNECT-GUIDE.md in the repo)',
			'',
			'MENTAL MODEL: two lanes. (1) Workspace view — each user browses/sends their own Slack inside MatterChat. (2) Bridged rooms — a Slack conversation mirrored into a real MatterChat channel (both ways; external senders appear via the Bridge bot with their name).',
			'',
			'ADMIN SETUP (once):',
			'1. api.slack.com/apps → Create App (or open the existing one).',
			`2. OAuth & Permissions → Redirect URL: ${site}/_slack/oauth/callback ; User Token Scopes: channels:read channels:history groups:read groups:history im:read im:history im:write mpim:read mpim:history chat:write users:read team:read (+ reactions:read reactions:write for reaction sync).`,
			`3. Event Subscriptions → ON → Request URL: ${site}/_slack/events (must show Verified — needs step 4's signing secret saved FIRST) → under "Subscribe to events on behalf of users" add ALL FOUR: message.im, message.mpim, message.channels, message.groups (+ reaction_added/reaction_removed).`,
			'   ⚠️ #1 MISTAKE: putting message.im under BOT events — bots never see personal DMs; inbound will silently never arrive. Must be USER events.',
			'4. Copy Client ID + Client Secret + Signing Secret from Basic Information → apply here via the slack_configure tool (or Admin → Settings → Slack). Reinstall the Slack app if prompted.',
			'',
			`EACH USER (30s): left rail ＋ → Connect Slack (or ${site}/_slack/oauth/start) → Allow. RECONNECT RULE: after ANY scope/event change, every already-connected user must Disconnect → Connect again — grants only refresh on a new authorization.`,
			'',
			'TROUBLESHOOT (most common first): outbound-works-inbound-dead = user events missing/under bot events → fix + reinstall + everyone reconnects; Request URL won’t verify = signing secret mismatch; events fine but a user gets nothing = that user connected before the change → reconnect; no DM sound/banner = browser notification permission; bridged room silent from the other side = fixed 2026-07-21, update the build.',
			'',
			'CHECK AS YOU GO: connector_status shows settings/secrets presence + who is connected; workspace_info shows the site URL the Slack app must point at.',
		].join('\n');
	},
};

const searchSettings: ChiTool = {
	def: {
		name: 'search_settings',
		description:
			'Search workspace settings by id/group/section substring (e.g. "Teams", "notification", "SMTP"). Returns matching setting ids with group and value (secret values masked). Read-only — the discovery tool to use BEFORE get_setting/set_setting when the exact id is unknown.',
		inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
	},
	async execute(input) {
		const q = str(input.query);
		if (q.length < 2) {
			throw new Error('query must be at least 2 characters.');
		}
		const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
		const rows = await Settings.find(
			{ $or: [{ _id: re }, { group: re }, { section: re }] },
			{ projection: { _id: 1, group: 1, section: 1, type: 1, value: 1 }, sort: { _id: 1 }, limit: 40 },
		).toArray();
		if (!rows.length) {
			return `No settings matching "${q}". Note: per-user notification PREFERENCES are stored on user profiles, not workspace settings — use get_user_preferences / set_user_notification_sound for those.`;
		}
		const lines = rows.map((r) => {
			const masked = isSecretSetting(r._id) || r.type === 'password';
			return `- ${r._id} [${r.group || '-'}${r.section ? `/${r.section}` : ''}] = ${masked ? maskSecret(r.value) : JSON.stringify(r.value)}`;
		});
		return `${rows.length} setting(s):\n${lines.join('\n')}${rows.length === 40 ? '\n(capped at 40 — narrow the query)' : ''}`;
	},
};

const connectorStatus: ChiTool = {
	def: {
		name: 'connector_status',
		description:
			'External-workspace connector health for slack, teams and google (gchat): connector settings for that provider (secrets masked) + how many users have connected + whether the asking admin has connected. Read-only.',
		inputSchema: {
			type: 'object',
			properties: { provider: { type: 'string', description: 'slack | teams | google; omit for all three.' } },
		},
	},
	async execute(input, actor) {
		const wanted = str(input.provider).toLowerCase();
		const providers = ['slack', 'teams', 'google'].filter((p) => !wanted || p === wanted);
		if (!providers.length) {
			throw new Error('provider must be slack, teams or google.');
		}
		const out: string[] = [];
		for (const provider of providers as import('@rocket.chat/core-typings').ExternalProvider[]) {
			const prefix = provider.charAt(0).toUpperCase() + provider.slice(1);
			const rows = await Settings.find(
				{ _id: { $regex: `^${prefix}_` } },
				{ projection: { _id: 1, type: 1, value: 1 }, sort: { _id: 1 }, limit: 15 },
			).toArray();
			const connections = await ExternalWorkspaceConnections.col.countDocuments({ provider });
			const mine = await ExternalWorkspaceConnections.col.findOne({ provider, userId: actor._id });
			out.push(`**${provider}**`);
			for (const r of rows) {
				const masked = isSecretSetting(r._id) || r.type === 'password';
				out.push(`- ${r._id} = ${masked ? maskSecret(r.value) : JSON.stringify(r.value)}`);
			}
			out.push(`- connected users: ${connections}; you: ${mine ? (mine as { status?: string }).status || 'connected' : 'not connected'}`);
		}
		return out.join('\n');
	},
};

const getSetting: ChiTool = {
	def: {
		name: 'get_setting',
		description:
			'Read one workspace setting by exact id (any setting; secret values always come back masked). Use search_settings first when unsure of the id. Read-only.',
		inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
	},
	async execute(input) {
		const id = str(input.id);
		if (!isSettingReadable(id)) {
			throw new Error(`Setting id looks empty/invalid.`);
		}
		const value = settings.get(id);
		if (value === undefined) {
			throw new Error(`No setting "${id}".`);
		}
		return `${id} = ${isSecretSetting(id) ? maskSecret(value) : JSON.stringify(value)}`;
	},
};

const setSetting: ChiTool = {
	def: {
		name: 'set_setting',
		description:
			'Change ANY workspace setting by exact id — the same power the admin settings UI has. Only works when "Allow settings writes" is enabled in Chi Assistant admin settings; always requires an in-chat confirm; every write is audited. Use search_settings first when unsure of the id.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, value: { description: 'New value (string or boolean).' } },
			required: ['id', 'value'],
		},
	},
	needsConfirm(input) {
		const id = str(input.id);
		return `Set ${id} → ${isSecretSetting(id) ? maskSecret(input.value) : JSON.stringify(input.value)}`;
	},
	async execute(input, actor) {
		if (!settings.get('Chi_Assistant_Allow_Settings_Writes')) {
			throw new Error('Settings writes are disabled — enable "Allow settings writes" under Admin → Chi Assistant first.');
		}
		const id = str(input.id);
		if (!isSettingWritable(id)) {
			throw new Error(`Setting id looks empty/invalid.`);
		}
		const value = typeof input.value === 'boolean' ? input.value : str(input.value);
		const audited = updateAuditedByUser({ _id: actor._id, username: actor.username || actor._id, ip: '', useragent: 'chi-admin-assistant' });
		const result = await audited(Settings.updateValueNotHiddenById, id, value);
		if (result.modifiedCount || result.matchedCount) {
			await notifyOnSettingChangedById(id);
		}
		return `${id} is now ${isSecretSetting(id) ? maskSecret(value) : JSON.stringify(value)}.`;
	},
};

const getUserPreferences: ChiTool = {
	def: {
		name: 'get_user_preferences',
		description:
			'Read a user\'s notification/profile preferences (notification sound, desktop/mobile alerts, email mode — the Account → Notifications surface). Omit username to read your own. Reading ANOTHER user needs the view-full-other-user-info permission (admins have it). Read-only.',
		inputSchema: {
			type: 'object',
			properties: { username: { type: 'string', description: 'Defaults to the requesting user.' } },
		},
	},
	access: 'user',
	async execute(input, actor) {
		const target = await resolveTargetUser(actor, str(input.username), 'view-full-other-user-info');
		const stored =
			((await Users.findOneById<IUser>(target._id, { projection: { 'settings.preferences': 1 } }))?.settings?.preferences ?? {}) as Record<
				string,
				unknown
			>;
		const lines = NOTIFICATION_PREF_KEYS.map((key) => {
			const own = stored[key];
			const value = own !== undefined ? own : settings.get(`Accounts_Default_User_Preferences_${key}`);
			const suffix = own === undefined ? ' (workspace default)' : '';
			return `- ${key}: ${value === undefined ? '(unset)' : JSON.stringify(value)}${suffix}`;
		});
		return `Preferences for **${target.username}**:\n${lines.join('\n')}\nChange the sound with set_user_notification_sound.`;
	},
};

const setUserNotificationSound: ChiTool = {
	def: {
		name: 'set_user_notification_sound',
		description:
			'Set a user\'s default new-message notification sound — the exact "Sound" dropdown under Account → Notifications (admin: Users → user → Preferences). Omit username to change your own; changing ANOTHER user needs the edit-other-user-info permission (admins have it). Accepts a sound name/id ("chime", "ding", "Notification.wav"); "none" silences it.',
		inputSchema: {
			type: 'object',
			properties: {
				username: { type: 'string', description: 'Defaults to the requesting user.' },
				sound: { type: 'string', description: 'Sound name or id; "none" to silence.' },
			},
			required: ['sound'],
		},
	},
	access: 'user',
	async execute(input, actor) {
		const target = await resolveTargetUser(actor, str(input.username), 'edit-other-user-info');
		const soundId = await resolveSoundId(str(input.sound));
		await saveUserPreferences({ newMessageNotification: soundId }, target._id);
		return `Default notification sound for **${target.username}** is now **${soundId}** (applies immediately, no re-login needed).`;
	},
};

const bulkSetUserNotificationSound: ChiTool = {
	def: {
		name: 'bulk_set_user_notification_sound',
		description: `Set the default new-message notification sound for MANY users at once: pass usernames, or all=true for every active user (max ${BULK_PREFS_MAX}). Needs the edit-other-user-info permission for any user other than yourself. Always requires confirmation before running.`,
		inputSchema: {
			type: 'object',
			properties: {
				usernames: { type: 'array', items: { type: 'string' } },
				all: { type: 'boolean', description: 'Target every active user instead of a list.' },
				sound: { type: 'string', description: 'Sound name or id; "none" to silence.' },
			},
			required: ['sound'],
		},
	},
	access: 'user',
	needsConfirm(input) {
		const sound = str(input.sound);
		if (input.all === true) {
			return `Set the default notification sound to "${sound}" for ALL active users`;
		}
		const names = strArr(input.usernames);
		if (!names.length) {
			return undefined; // nothing parseable — let execute() explain without a confirm dance
		}
		const preview = names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5} more` : '');
		return `Set the default notification sound to "${sound}" for ${names.length} user(s): ${preview}`;
	},
	async execute(input, actor) {
		const soundId = await resolveSoundId(str(input.sound));
		const failed: string[] = [];
		let targets: Pick<IUser, '_id' | 'username'>[] = [];
		if (input.all === true) {
			targets = await Users.find<IUser>(
				{ type: 'user', active: true },
				{ projection: { username: 1 }, limit: BULK_PREFS_MAX + 1 },
			).toArray();
		} else {
			for (const username of strArr(input.usernames)) {
				try {
					targets.push(await requireUserByUsername(username.replace(/^@/, '')));
				} catch (err) {
					failed.push(`- ${username}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
		if (!targets.length) {
			return `Nothing to do — pass usernames or all=true.${failed.length ? `\nProblems:\n${failed.join('\n')}` : ''}`;
		}
		if (targets.length > BULK_PREFS_MAX) {
			throw new Error(`Refusing: ${targets.length} users exceeds the per-call cap of ${BULK_PREFS_MAX}. Split the list.`);
		}
		if (targets.some((t) => t._id !== actor._id) && !(await hasPermissionAsync(actor._id, 'edit-other-user-info'))) {
			throw new Error('Changing OTHER users needs the "edit-other-user-info" permission — you can only change your own sound.');
		}
		const done: string[] = [];
		for (const t of targets) {
			try {
				await saveUserPreferences({ newMessageNotification: soundId }, t._id);
				done.push(t.username || t._id);
			} catch (err) {
				failed.push(`- ${t.username || t._id}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		return [
			`Default notification sound set to **${soundId}** for ${done.length}/${targets.length} user(s).`,
			failed.length ? `\n**Skipped/failed:**\n${failed.join('\n')}` : '',
		].join('');
	},
};

const openConversation: ChiTool = {
	def: {
		name: 'open_conversation',
		description:
			'Navigate the user\'s screen to one of THEIR conversations — a channel, private group, or direct message they belong to. Use whenever they ask to "go to", "open", "take me to", or "show me" a chat/person. Matches by name against the conversations they\'re in; opens the best match.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Channel / group / person name to open (e.g. "general", "acme-slack-general", a username).' },
			},
			required: ['query'],
		},
	},
	access: 'user',
	async execute(input, actor) {
		const query = str(input.query)
			.replace(/^[#@]/, '')
			.trim();
		if (!query) {
			return 'Tell me which conversation to open.';
		}
		// ONLY the caller's own subscriptions — Chi opens what the user already has access to, nothing else.
		const subs = await Subscriptions.find<{ rid: string; name?: string; fname?: string; t: string }>(
			{ 'u._id': actor._id, 'open': { $ne: false } },
			{ projection: { rid: 1, name: 1, fname: 1, t: 1 } },
		).toArray();
		const q = query.toLowerCase();
		const norm = (s?: string): string => (s || '').toLowerCase();
		const match =
			subs.find((s) => norm(s.name) === q || norm(s.fname) === q) ||
			subs.find((s) => norm(s.name).startsWith(q) || norm(s.fname).startsWith(q)) ||
			subs.find((s) => norm(s.name).includes(q) || norm(s.fname).includes(q));
		if (!match) {
			return `You're not in a conversation matching "${query}", so there's nothing for me to open. I can only take you to chats you already belong to.`;
		}
		const name = match.name || match.fname || query;
		emitClientAction({ type: 'navigate', rid: match.rid, name, t: match.t });
		return `Opening **${name}**.`;
	},
};

const DESKTOP_RELEASES_URL = 'https://github.com/OmnisAIOrg/MatterChat-Desktop-releases/releases/latest';

const getDesktopApp: ChiTool = {
	def: {
		name: 'get_desktop_app',
		description:
			'Give the user the MatterChat DESKTOP app: the download link and step-by-step install instructions for macOS / Windows / Linux. Use whenever they ask to download / get / install the desktop (or Mac / Windows) app.',
		inputSchema: {
			type: 'object',
			properties: {
				platform: { type: 'string', description: 'Optional: "mac" | "windows" | "linux" to tailor the steps.' },
			},
		},
	},
	access: 'user',
	async execute(input) {
		const platform = str(input.platform).toLowerCase();
		const steps: Record<string, string> = {
			mac: '**macOS** (Apple Silicon): on the releases page download `MatterChat-<version>-arm64-mac.zip`, unzip it, drag **MatterChat.app** into your Applications folder, then open it.',
			windows: '**Windows**: download `MatterChat-Setup-<version>.exe` and run it — it installs and launches automatically.',
			linux: '**Linux**: download the `.AppImage` (`chmod +x` then run) or the `.deb` (`sudo dpkg -i matterchat-desktop_*.deb`).',
		};
		const wanted = platform.includes('mac')
			? [steps.mac]
			: platform.includes('win')
				? [steps.windows]
				: platform.includes('lin')
					? [steps.linux]
					: [steps.mac, steps.windows, steps.linux];
		return [
			'**MatterChat Desktop** — grab it here:',
			DESKTOP_RELEASES_URL,
			'',
			...wanted,
			'',
			'It signs in with your usual MatterChat account and auto-updates after the first install.',
		].join('\n');
	},
};

/* ── registry + runner ─────────────────────────────────────────────────────────────── */

export const CHI_ADMIN_TOOLS: ChiTool[] = [
	listUsers,
	createUser,
	bulkCreateUsers,
	setUserRoles,
	setUserActive,
	resetUserPassword,
	createChannel,
	addUsersToChannel,
	workspaceInfo,
	slackStatus,
	slackConfigure,
	slackConnectLink,
	searchSettings,
	connectorStatus,
	slackSetupGuide,
	getSetting,
	setSetting,
	getUserPreferences,
	setUserNotificationSound,
	bulkSetUserNotificationSound,
	openConversation,
	getDesktopApp,
	// v0.18.0 — the workspace capability layer (navigation · search · conversation
	// intelligence · notifications · message actions · tasks · deadlines). All
	// caller-scoped 'user' tools; see ws-tools.ts.
	...CHI_WS_TOOLS,
];

export const toolAccess = (tool: ChiTool): ChiToolAccess => tool.access ?? 'admin';

/** The tool surface offered to a caller: admins see everything, everyone else only 'user' tools. */
export const toolDefs = ({ isAdmin }: { isAdmin: boolean }): ToolDef[] =>
	CHI_ADMIN_TOOLS.filter((t) => isAdmin || toolAccess(t) === 'user').map((t) => t.def);

export const findTool = (name: string): ChiTool | undefined => CHI_ADMIN_TOOLS.find((t) => t.def.name === name);

export type ToolRunResult = { ok: boolean; content: string };

/**
 * Execute one tool AS the calling user. Re-checks the caller's authority on EVERY call (the
 * conversation may outlive a demotion): admin-scoped tools require the admin role; 'user'
 * tools run for anyone and scope their own targets. Never throws — errors become
 * tool-visible strings.
 */
export async function runTool(name: string, input: Record<string, unknown>, actor: IUser): Promise<ToolRunResult> {
	const tool = findTool(name);
	if (!tool) {
		return { ok: false, content: `Unknown tool "${name}".` };
	}
	if (toolAccess(tool) === 'admin' && !(await hasRoleAsync(actor._id, 'admin'))) {
		return { ok: false, content: 'That action needs the workspace admin role — the requesting user does not have it.' };
	}
	try {
		const content = await tool.execute(input, actor);
		return { ok: true, content };
	} catch (err) {
		return { ok: false, content: err instanceof Error ? err.message : String(err) };
	}
}

/** One-line audit rendering of a tool call (args masked). */
export const describeToolCall = (name: string, input: Record<string, unknown>): string => `${name} ${auditArgs(input)}`;
