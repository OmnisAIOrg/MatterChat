/**
 * Chi — the WORKSPACE capability layer (the "AI Operating System" tools).
 *
 * These turn Chi from an admin-ops bot into a self-driving workspace: it NAVIGATES the app,
 * RETRIEVES across the user's chats/files/people, EXECUTES message + notification + task actions,
 * and REASONS (catch-me-up, summaries) — all AS THE CALLER, over only what they can already see.
 *
 * Two rules, same as the admin tools (tools.ts):
 *  1. AUTHORITY IS THE CALLER'S. Every read/write scopes to the caller's own subscriptions/boards.
 *     All of these are `access: 'user'` (open to everyone) and never touch data the caller lacks
 *     access to. The one outward-facing write — posting a message — is `needsConfirm`.
 *  2. TOOLS GATHER, THE MODEL REASONS. Summaries/answers are produced by the tool-loop model from
 *     the raw transcript/state a tool returns — no nested model calls here.
 *
 * Context: `getChiContext()` supplies the room the user is currently viewing, so "summarize THIS
 * channel" / "who's in here" resolve without the caller naming it (the DM path has no context, so
 * those tools require an explicit channel there).
 */
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Messages, Rooms, Subscriptions, Uploads, Users } from '@rocket.chat/models';

import { emitClientAction } from './actions';
import type { ChiTool } from './tools';
import { getChiContext } from './turnctx';
import { MAX_DIGEST_CHANNELS, MAX_MESSAGES_PER_CHANNEL } from '../digest/digestHelpers';
import { gatherUnreadDigest } from '../digest/unreadDigest';
import { settings } from '../../../settings';
import { executeSetReaction } from '../../messaging/reactions/setReaction';
import { sendMessage } from '../../messages/sendMessage';
import { readMessages } from '../../readMessages';
import { completeCard, createCard } from '../../boards/service';
import { getListsForBoard, getMyDayCards, listBoardsForUser, searchCards } from '../../boards/reads';
import { listDeadlines } from '../../boards/matters/deadlines';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const norm = (s?: string): string => (s || '').toLowerCase();
const rx = (q: string): RegExp => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const rel = (d?: Date | string | number): string => {
	if (!d) return '';
	const t = new Date(d).getTime();
	if (!Number.isFinite(t)) return '';
	const days = Math.round((t - Date.now()) / 86_400_000);
	if (days === 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days === -1) return 'yesterday';
	return days > 0 ? `in ${days}d` : `${-days}d ago`;
};

type Sub = { rid: string; name?: string; fname?: string; t: string; unread?: number; userMentions?: number; alert?: boolean; disableNotifications?: boolean };

async function callerSubs(uid: string): Promise<Sub[]> {
	return Subscriptions.find<Sub>(
		{ 'u._id': uid, 'open': { $ne: false } },
		{ projection: { rid: 1, name: 1, fname: 1, t: 1, unread: 1, userMentions: 1, alert: 1, disableNotifications: 1 } },
	).toArray();
}

/** Resolve a room the caller belongs to by name, or (empty query) the room they're currently viewing. */
async function resolveRoom(uid: string, query: string, subs?: Sub[]): Promise<Sub | null> {
	const list = subs ?? (await callerSubs(uid));
	const q = norm(str(query).replace(/^[#@]/, ''));
	if (!q) {
		const ctx = getChiContext();
		if (ctx?.rid) return list.find((s) => s.rid === ctx.rid) ?? { rid: ctx.rid, name: ctx.roomName, t: ctx.roomType || 'c' };
		return null;
	}
	return (
		list.find((s) => norm(s.name) === q || norm(s.fname) === q) ||
		list.find((s) => norm(s.name).startsWith(q) || norm(s.fname).startsWith(q)) ||
		list.find((s) => norm(s.name).includes(q) || norm(s.fname).includes(q)) ||
		null
	);
}

const roomLabel = (s: { name?: string; fname?: string; t?: string }): string => `${s.t === 'd' ? '@' : '#'}${s.name || s.fname || 'conversation'}`;

/* ─────────────────────────── NAVIGATION ─────────────────────────── */

const goTo: ChiTool = {
	def: {
		name: 'go_to',
		description:
			'Navigate the user to a top-level app surface: "home"/"my day" (the My Day home), "boards" (kanban boards), "directory"/"people" (the company directory), "activity", or "admin"/"settings" (admin console — admins only). Use for "take me home", "open my boards", "show the directory".',
		inputSchema: {
			type: 'object',
			properties: { surface: { type: 'string', description: 'home | boards | directory | activity | admin' } },
			required: ['surface'],
		},
	},
	access: 'user',
	async execute(input) {
		const s = norm(str(input.surface));
		const map: Record<string, { path: string; label: string }> = {
			home: { path: '/home', label: 'Home (My Day)' },
			'my day': { path: '/home', label: 'My Day' },
			myday: { path: '/home', label: 'My Day' },
			boards: { path: '/boards', label: 'Boards' },
			board: { path: '/boards', label: 'Boards' },
			directory: { path: '/directory', label: 'the Directory' },
			people: { path: '/directory', label: 'the Directory' },
			team: { path: '/directory', label: 'the Directory' },
			activity: { path: '/admin/rooms', label: 'Activity' },
			admin: { path: '/admin/settings', label: 'the Admin console' },
			settings: { path: '/admin/settings', label: 'Settings' },
		};
		const hit = map[s];
		if (!hit) return `I can take you to: home, boards, directory, or admin. Which one?`;
		emitClientAction({ type: 'route', path: hit.path, label: hit.label });
		return `Opening **${hit.label}**.`;
	},
};

const openProfile: ChiTool = {
	def: {
		name: 'open_profile',
		description: 'Open a direct message with a person (their profile/DM). Use for "message X", "open a DM with X", "go to X\'s profile".',
		inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
	},
	access: 'user',
	async execute(input) {
		const username = str(input.username).replace(/^@/, '');
		if (!username) return 'Who would you like to message?';
		const user = await Users.findOneByUsernameIgnoringCase<Pick<IUser, '_id' | 'username' | 'name'>>(username, { projection: { username: 1, name: 1 } });
		if (!user?.username) return `I couldn't find a user named "${username}".`;
		emitClientAction({ type: 'route', path: `/direct/${user.username}`, label: `DM with ${user.name || user.username}` });
		return `Opening a direct message with **${user.name || user.username}**.`;
	},
};

/* ─────────────────────────── SEARCH ─────────────────────────── */

const searchMessages: ChiTool = {
	def: {
		name: 'search_messages',
		description:
			'Search the text of messages across the conversations the user belongs to (optionally limited to one channel). Returns matching messages with their room, author and date. Use for "find where we discussed X", "search messages about Y", "when did we talk about Z".',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				channel: { type: 'string', description: 'Optional: limit to this channel/DM name.' },
				limit: { type: 'number' },
			},
			required: ['query'],
		},
	},
	access: 'user',
	async execute(input, actor) {
		const query = str(input.query);
		if (!query) return 'What should I search for?';
		const subs = await callerSubs(actor._id);
		let rids = subs.map((s) => s.rid);
		const chan = str(input.channel);
		if (chan) {
			const room = await resolveRoom(actor._id, chan, subs);
			if (!room) return `You're not in a conversation matching "${chan}".`;
			rids = [room.rid];
		}
		if (!rids.length) return 'You have no conversations to search.';
		const nameByRid = new Map(subs.map((s) => [s.rid, roomLabel(s)]));
		const hits = await Messages.find<Pick<IMessage, 'msg' | 'u' | 'ts' | 'rid'>>(
			{ rid: { $in: rids }, t: { $exists: false }, msg: rx(query) },
			{ sort: { ts: -1 }, limit: Math.min(num(input.limit, 12), 25), projection: { msg: 1, u: 1, ts: 1, rid: 1 } },
		).toArray();
		if (!hits.length) return `No messages matching "${query}" in ${chan ? `#${chan}` : 'your conversations'}.`;
		return [
			`${hits.length} message(s) matching "${query}":`,
			...hits.map((m) => `• ${nameByRid.get(m.rid) || '#room'} — @${m.u?.username} (${rel(m.ts)}): ${(m.msg || '').replace(/\n/g, ' ').slice(0, 140)}`),
		].join('\n');
	},
};

const findChannels: ChiTool = {
	def: {
		name: 'find_channels',
		description: 'Find channels/conversations by name — the ones the user is in, plus public channels they could join. Use for "what channels are about X", "find the marketing channel".',
		inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
	},
	access: 'user',
	async execute(input, actor) {
		const query = str(input.query).replace(/^#/, '');
		if (!query) return 'What channel are you looking for?';
		const subs = await callerSubs(actor._id);
		const mine = subs.filter((s) => s.t !== 'd' && (norm(s.name).includes(norm(query)) || norm(s.fname).includes(norm(query))));
		const myRids = new Set(subs.map((s) => s.rid));
		const publics = await Rooms.find<Pick<IRoom, '_id' | 'name' | 'fname' | 't' | 'usersCount'>>(
			{ t: 'c', name: rx(query), teamMain: { $ne: true } },
			{ projection: { name: 1, fname: 1, t: 1, usersCount: 1 }, limit: 12 },
		).toArray();
		const joinable = publics.filter((r) => !myRids.has(r._id));
		const lines: string[] = [];
		if (mine.length) lines.push('In your conversations:', ...mine.slice(0, 10).map((s) => `• ${roomLabel(s)}${s.unread ? ` (${s.unread} unread)` : ''}`));
		if (joinable.length) lines.push('Public channels you could join:', ...joinable.slice(0, 8).map((r) => `• #${r.name} (${r.usersCount || 0} members)`));
		return lines.length ? lines.join('\n') : `No channels matching "${query}".`;
	},
};

const findPeople: ChiTool = {
	def: {
		name: 'find_people',
		description: 'Find teammates in the workspace directory by name or username. Returns who they are and their online status. Use for "who is X", "find someone named Y", "who works here".',
		inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
	},
	access: 'user',
	async execute(input) {
		const query = str(input.query).replace(/^@/, '');
		if (!query) return 'Who are you looking for?';
		const users = await Users.find<Pick<IUser, 'username' | 'name' | 'status' | 'statusText'>>(
			{ active: { $ne: false }, type: 'user', username: { $exists: true }, $or: [{ username: rx(query) }, { name: rx(query) }] },
			{ projection: { username: 1, name: 1, status: 1, statusText: 1 }, limit: Math.min(num(input.limit, 12), 20) },
		).toArray();
		if (!users.length) return `No one in the directory matches "${query}".`;
		return [
			`${users.length} teammate(s) matching "${query}":`,
			...users.map((u) => `• ${u.name || u.username} (@${u.username}) — ${u.status || 'offline'}${u.statusText ? ` · ${u.statusText}` : ''}`),
		].join('\n');
	},
};

const whoIs: ChiTool = {
	def: {
		name: 'who_is',
		description: 'Look up one person: their name, status, roles, and the conversations you share with them. Use for "who is @X", "what do I share with X".',
		inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
	},
	access: 'user',
	async execute(input, actor) {
		const username = str(input.username).replace(/^@/, '');
		if (!username) return 'Who do you want to look up?';
		const user = await Users.findOneByUsernameIgnoringCase<Pick<IUser, '_id' | 'username' | 'name' | 'status' | 'statusText' | 'roles'>>(username, {
			projection: { username: 1, name: 1, status: 1, statusText: 1, roles: 1 },
		});
		if (!user) return `No user named "${username}".`;
		const [mine, theirs] = await Promise.all([callerSubs(actor._id), callerSubs(user._id)]);
		const theirRids = new Set(theirs.map((s) => s.rid));
		const shared = mine.filter((s) => s.t !== 'd' && theirRids.has(s.rid)).slice(0, 8).map((s) => roomLabel(s));
		return [
			`**${user.name || user.username}** (@${user.username})`,
			`Status: ${user.status || 'offline'}${user.statusText ? ` — ${user.statusText}` : ''}`,
			user.roles?.length ? `Roles: ${user.roles.join(', ')}` : '',
			shared.length ? `Shared channels: ${shared.join(', ')}` : 'No channels in common.',
		].filter(Boolean).join('\n');
	},
};

const findFiles: ChiTool = {
	def: {
		name: 'find_files',
		description: 'Find files/attachments shared in the user\'s conversations (optionally by name, or in one channel). Use for "find the contract PDF", "what files were shared in #matters", "recent documents".',
		inputSchema: {
			type: 'object',
			properties: { query: { type: 'string' }, channel: { type: 'string' }, limit: { type: 'number' } },
		},
	},
	access: 'user',
	async execute(input, actor) {
		const subs = await callerSubs(actor._id);
		let rids = subs.map((s) => s.rid);
		const chan = str(input.channel);
		if (chan) {
			const room = await resolveRoom(actor._id, chan, subs);
			if (!room) return `You're not in a conversation matching "${chan}".`;
			rids = [room.rid];
		}
		if (!rids.length) return 'You have no conversations with files.';
		const nameByRid = new Map(subs.map((s) => [s.rid, roomLabel(s)]));
		const q = str(input.query);
		const filter: Record<string, unknown> = { rid: { $in: rids }, _hidden: { $ne: true } };
		if (q) filter.name = rx(q);
		const files = await Uploads.find<{ name?: string; type?: string; size?: number; rid?: string; _updatedAt?: Date }>(
			filter,
			{ sort: { _updatedAt: -1 }, limit: Math.min(num(input.limit, 12), 25), projection: { name: 1, type: 1, size: 1, rid: 1, _updatedAt: 1 } },
		).toArray();
		if (!files.length) return q ? `No files matching "${q}".` : 'No files found in your conversations.';
		return [
			`${files.length} file(s)${q ? ` matching "${q}"` : ''}:`,
			...files.map((f) => `• ${f.name || 'file'} — ${f.type || 'file'}${f.size ? `, ${Math.round(f.size / 1024)}KB` : ''} in ${nameByRid.get(f.rid || '') || 'a room'} (${rel(f._updatedAt)})`),
		].join('\n');
	},
};

/* ─────────────────────────── CONVERSATION INTELLIGENCE ─────────────────────────── */

const readRecentMessages: ChiTool = {
	def: {
		name: 'read_recent_messages',
		description:
			'Read the recent messages of a conversation so you can SUMMARIZE it, answer a question about it, list open questions, or find a decision. Defaults to the channel the user is currently viewing. Use for "summarize this channel", "what did we decide here", "any unanswered questions", "catch me up on #X".',
		inputSchema: {
			type: 'object',
			properties: { channel: { type: 'string', description: 'Channel/DM name; omit to use the one being viewed.' }, limit: { type: 'number', description: 'How many recent messages (default 30, max 60).' } },
		},
	},
	access: 'user',
	async execute(input, actor) {
		const room = await resolveRoom(actor._id, str(input.channel));
		if (!room) return str(input.channel) ? `You're not in a conversation matching "${input.channel}".` : 'Which channel? (Open one, or name it.)';
		const limit = Math.min(num(input.limit, 30), 60);
		const msgs = await Messages.find<Pick<IMessage, 'msg' | 'u' | 'ts' | 'tmid'>>(
			{ rid: room.rid, t: { $exists: false }, msg: { $exists: true, $ne: '' } },
			{ sort: { ts: -1 }, limit, projection: { msg: 1, u: 1, ts: 1, tmid: 1 } },
		).toArray();
		if (!msgs.length) return `${roomLabel(room)} has no recent messages.`;
		const transcript = msgs.reverse().map((m) => `${m.u?.username || 'someone'}: ${(m.msg || '').replace(/\n/g, ' ')}`).join('\n');
		return `Recent messages in ${roomLabel(room)} (oldest→newest):\n${transcript}`;
	},
};

const catchMeUp: ChiTool = {
	def: {
		name: 'catch_me_up',
		description:
			'Gather everything waiting on the user: unread conversations and mentions, tasks assigned to them that are due, and upcoming deadlines. Use for "catch me up", "what did I miss", "what needs my attention", "who is waiting on me". Summarize the result for them.',
		inputSchema: { type: 'object', properties: {} },
	},
	access: 'user',
	async execute(_input, actor) {
		const subs = await callerSubs(actor._id);
		const unread = subs.filter((s) => (s.unread || 0) > 0 || s.alert).sort((a, b) => (b.userMentions || 0) - (a.userMentions || 0));
		const mentions = unread.filter((s) => (s.userMentions || 0) > 0);
		const [{ cards: tasks }, deadlines] = await Promise.all([getMyDayCards(actor._id).catch(() => ({ cards: [] as { title?: string; dueDate?: Date }[] })), upcomingDeadlinesFor(actor._id, 5).catch(() => [])]);
		const lines: string[] = [];
		lines.push(`Unread: ${unread.length} conversation(s)${mentions.length ? `, ${mentions.reduce((n, s) => n + (s.userMentions || 0), 0)} mention(s)` : ''}.`);
		if (mentions.length) lines.push('Mentions:', ...mentions.slice(0, 6).map((s) => `• ${roomLabel(s)} (${s.userMentions} mention${s.userMentions === 1 ? '' : 's'})`));
		if (unread.length) lines.push('Unread conversations:', ...unread.slice(0, 8).map((s) => `• ${roomLabel(s)}${s.unread ? ` — ${s.unread} unread` : ''}`));
		if (tasks.length) lines.push('Your tasks due:', ...tasks.slice(0, 6).map((c) => `• ${c.title}${c.dueDate ? ` (due ${rel(c.dueDate)})` : ''}`));
		if (deadlines.length) lines.push('Upcoming deadlines:', ...deadlines.slice(0, 6).map((d) => `• ${d.label || d.kind} — ${rel(d.dueDate)}`));
		if (lines.length === 1 && !unread.length) return "You're all caught up — nothing unread, no tasks due, no imminent deadlines.";
		return lines.join('\n');
	},
};

const unreadDigest: ChiTool = {
	def: {
		name: 'unread_digest',
		description:
			'Read the ACTUAL unread messages waiting for the user, grouped by conversation, each with a jump link. Use this — not catch_me_up — whenever they want to know WHAT they missed rather than how much ("catch me up", "what did I miss", "summarize my morning", "anything I need to reply to"). catch_me_up returns counts only; this returns content. Summarize it for them and KEEP the [jump](…) links in your summary so they can click straight to the message.',
		inputSchema: {
			type: 'object',
			properties: {
				channelLimit: { type: 'number', description: 'How many conversations to cover (default 8).' },
				messageLimit: { type: 'number', description: 'How many messages per conversation (default 15).' },
			},
		},
	},
	access: 'user',
	async execute(input, actor) {
		const { text } = await gatherUnreadDigest(actor._id, {
			channelLimit: Math.min(num(input.channelLimit, MAX_DIGEST_CHANNELS), 15),
			messageLimit: Math.min(num(input.messageLimit, MAX_MESSAGES_PER_CHANNEL), 40),
		});
		return text;
	},
};

const setMorningBrief: ChiTool = {
	def: {
		name: 'set_morning_brief',
		description:
			'Turn the user\'s daily morning brief on or off — a DM from Chi each morning summarizing what they missed. Use for "send me a daily summary", "brief me every morning", "stop the daily brief". This only changes the CALLER\'s own preference.',
		inputSchema: {
			type: 'object',
			properties: { enabled: { type: 'boolean', description: 'true to receive the brief, false to stop it.' } },
			required: ['enabled'],
		},
	},
	access: 'user',
	async execute(input, actor) {
		if (settings.get('Chi_Morning_Brief_Enabled') !== true) {
			return 'The morning brief is not switched on for this workspace — an admin enables it under Admin → Settings → Chi Assistant.';
		}
		const enabled = input.enabled !== false;
		// A targeted $set on the sub-field, so this cannot clobber the user's
		// model override or connector toggles the way a whole-object write would.
		await Users.updateOne({ _id: actor._id }, { $set: { 'settings.chi.morningBrief': enabled } });
		return enabled
			? "You'll get a morning brief from me each weekday with what you missed. Say \"stop the daily brief\" any time."
			: "I've stopped your morning brief.";
	},
};

/* ─────────────────────────── NOTIFICATIONS ─────────────────────────── */

const markChannelRead: ChiTool = {
	def: {
		name: 'mark_channel_read',
		description: 'Mark a conversation as read (defaults to the one being viewed). Use for "mark this read", "clear #general".',
		inputSchema: { type: 'object', properties: { channel: { type: 'string' } } },
	},
	access: 'user',
	async execute(input, actor) {
		const sub = await resolveRoom(actor._id, str(input.channel));
		if (!sub) return 'Which conversation should I mark read?';
		const room = await Rooms.findOneById(sub.rid);
		if (!room) return 'That conversation no longer exists.';
		await readMessages(room, actor._id, true);
		return `Marked ${roomLabel(sub)} as read.`;
	},
};

const markAllRead: ChiTool = {
	def: {
		name: 'mark_all_read',
		description: 'Mark ALL of the user\'s unread conversations as read (a bulk clear). Use for "mark everything read", "clear all notifications".',
		inputSchema: { type: 'object', properties: {} },
	},
	access: 'user',
	async execute(_input, actor) {
		const subs = await callerSubs(actor._id);
		const unread = subs.filter((s) => (s.unread || 0) > 0 || s.alert);
		let cleared = 0;
		for (const s of unread) {
			const room = await Rooms.findOneById(s.rid);
			if (room) {
				await readMessages(room, actor._id, true);
				cleared += 1;
			}
		}
		return cleared ? `Marked ${cleared} conversation(s) as read.` : 'Nothing was unread.';
	},
};

const muteChannel: ChiTool = {
	def: {
		name: 'mute_channel',
		description: 'Mute (or unmute) notifications for a conversation. Use for "mute #noise", "stop notifying me about X", "unmute #general".',
		inputSchema: { type: 'object', properties: { channel: { type: 'string' }, mute: { type: 'boolean', description: 'true = mute (default), false = unmute' } }, required: ['channel'] },
	},
	access: 'user',
	async execute(input, actor) {
		const sub = await resolveRoom(actor._id, str(input.channel));
		if (!sub) return `You're not in a conversation matching "${input.channel}".`;
		const mute = input.mute !== false;
		await Subscriptions.updateOne({ rid: sub.rid, 'u._id': actor._id }, { $set: { disableNotifications: mute } });
		return `${mute ? 'Muted' : 'Unmuted'} ${roomLabel(sub)}.`;
	},
};

/* ─────────────────────────── MESSAGE ACTIONS ─────────────────────────── */

const postMessage: ChiTool = {
	def: {
		name: 'post_message',
		description: 'Post a message to a conversation the user belongs to, AS the user. Use for "send X to #Y", "tell the team Z", "reply in this channel". This sends real chat — it is confirmed first.',
		inputSchema: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
	},
	access: 'user',
	needsConfirm: (input) => {
		const text = str(input.text);
		const channel = str(input.channel) || 'the current channel';
		return text ? `Post to ${channel.startsWith('#') || channel.startsWith('@') ? channel : `#${channel}`}: "${text.slice(0, 160)}"` : undefined;
	},
	async execute(input, actor) {
		const text = str(input.text);
		if (!text) return 'What should I post?';
		const sub = await resolveRoom(actor._id, str(input.channel));
		if (!sub) return 'Which conversation should I post to?';
		const room = await Rooms.findOneById(sub.rid);
		if (!room) return 'That conversation no longer exists.';
		await sendMessage(actor, { rid: sub.rid, msg: text }, room);
		emitClientAction({ type: 'navigate', rid: sub.rid, name: sub.name || sub.fname || '', t: sub.t });
		return `Posted to ${roomLabel(sub)}.`;
	},
};

const reactToMessage: ChiTool = {
	def: {
		name: 'react_to_message',
		description: 'Add an emoji reaction to the most recent message in a conversation (optionally the most recent one matching some text). Use for "react 👍 to the last message", "thumbs up that".',
		inputSchema: { type: 'object', properties: { channel: { type: 'string' }, emoji: { type: 'string', description: 'e.g. 👍 or :thumbsup:' }, match: { type: 'string', description: 'Optional text to pick which recent message.' } }, required: ['emoji'] },
	},
	access: 'user',
	async execute(input, actor) {
		const sub = await resolveRoom(actor._id, str(input.channel));
		if (!sub) return 'Which conversation?';
		const match = str(input.match);
		const query: Record<string, unknown> = { rid: sub.rid, t: { $exists: false }, msg: { $exists: true, $ne: '' } };
		if (match) query.msg = rx(match);
		const msg = await Messages.findOne<Pick<IMessage, '_id' | 'msg'>>(query, { sort: { ts: -1 }, projection: { msg: 1 } });
		if (!msg) return match ? `No recent message matching "${match}".` : 'No message to react to.';
		let emoji = str(input.emoji);
		if (emoji && !emoji.startsWith(':') && /^[a-z0-9_+-]+$/i.test(emoji)) emoji = `:${emoji}:`;
		await executeSetReaction(actor._id, emoji, msg._id);
		return `Reacted ${emoji} to "${(msg.msg || '').slice(0, 60)}".`;
	},
};

/* ─────────────────────────── TASKS (Boards) ─────────────────────────── */

const listMyTasks: ChiTool = {
	def: {
		name: 'list_my_tasks',
		description: 'List the task cards assigned to the user that have a due date, soonest first (their "My Day" tasks across all boards). Use for "what are my tasks", "what\'s due", "my to-dos".',
		inputSchema: { type: 'object', properties: {} },
	},
	access: 'user',
	async execute(_input, actor) {
		const { cards } = await getMyDayCards(actor._id);
		if (!cards.length) return 'You have no assigned tasks with a due date right now.';
		return [`You have ${cards.length} task(s) assigned to you:`, ...cards.slice(0, 15).map((c) => `• ${c.title}${c.dueDate ? ` — due ${rel(c.dueDate)}` : ''}`)].join('\n');
	},
};

const completeTask: ChiTool = {
	def: {
		name: 'complete_task',
		description: 'Mark one of the user\'s task cards done, matched by a phrase from its title. Use for "mark the demand-letter task done", "complete X".',
		inputSchema: { type: 'object', properties: { match: { type: 'string' } }, required: ['match'] },
	},
	access: 'user',
	async execute(input, actor) {
		const match = str(input.match);
		if (!match) return 'Which task?';
		const { cards } = await getMyDayCards(actor._id);
		let card = cards.find((c) => norm(c.title).includes(norm(match)));
		if (!card) {
			const { cards: searched } = await searchCards(actor._id, match);
			card = searched.find((c) => (c.assignees || []).includes(actor._id)) || searched[0];
		}
		if (!card) return `I couldn't find a task matching "${match}".`;
		await completeCard(actor._id, card._id, true);
		return `Marked "${card.title}" as done.`;
	},
};

const createTask: ChiTool = {
	def: {
		name: 'create_task',
		description: 'Create a task card on one of the user\'s boards (defaults to their first board\'s first list). Use for "create a task to X", "add a to-do", "remind me to Y".',
		inputSchema: { type: 'object', properties: { title: { type: 'string' }, board: { type: 'string', description: 'Optional board name.' } }, required: ['title'] },
	},
	access: 'user',
	async execute(input, actor) {
		const title = str(input.title);
		if (!title) return 'What is the task?';
		const { boards } = await listBoardsForUser(actor._id, {}, { offset: 0, count: 25 });
		if (!boards.length) return 'You don\'t have a board yet — create one under Boards, then I can add tasks to it.';
		const wanted = str(input.board);
		const board = (wanted && boards.find((b) => norm(b.title).includes(norm(wanted)))) || boards[0];
		const { lists } = await getListsForBoard(actor._id, board._id);
		const list = lists.find((l) => !l.archived) || lists[0];
		if (!list) return `Board "${board.title}" has no lists to add a card to.`;
		const card = await createCard(actor._id, { boardId: board._id, listId: list._id, title, cardType: 'task' });
		emitClientAction({ type: 'route', path: `/boards/${board._id}`, label: `${board.title} board` });
		return `Added task "${card.title}" to **${board.title}** (${list.title || 'first list'}).`;
	},
};

/* ─────────────────────────── DEADLINES (Calendar) ─────────────────────────── */

async function upcomingDeadlinesFor(uid: string, limit: number): Promise<{ label?: string; kind: string; dueDate: Date }[]> {
	const { boards } = await listBoardsForUser(uid, {}, { offset: 0, count: 25 });
	const all: { label?: string; kind: string; dueDate: Date }[] = [];
	for (const b of boards) {
		const ds = await listDeadlines({ boardId: b._id }).catch(() => []);
		for (const d of ds) all.push({ label: d.label, kind: String(d.kind), dueDate: d.dueDate });
	}
	const now = Date.now() - 86_400_000;
	return all.filter((d) => new Date(d.dueDate).getTime() >= now).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, limit);
}

const upcomingDeadlines: ChiTool = {
	def: {
		name: 'upcoming_deadlines',
		description: 'List upcoming matter/case deadlines (SOL, filing, custom) across the user\'s boards, soonest first. Use for "what deadlines are coming up", "what\'s due this week", "any statute-of-limitations dates".',
		inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
	},
	access: 'user',
	async execute(input, actor) {
		const deadlines = await upcomingDeadlinesFor(actor._id, Math.min(num(input.limit, 12), 25));
		if (!deadlines.length) return 'No upcoming deadlines on your boards.';
		return [`${deadlines.length} upcoming deadline(s):`, ...deadlines.map((d) => `• ${d.label || d.kind} — ${rel(d.dueDate)} (${new Date(d.dueDate).toDateString()})`)].join('\n');
	},
};

/* ─────────────────────────── the export ─────────────────────────── */

export const CHI_WS_TOOLS: ChiTool[] = [
	// navigation
	goTo,
	openProfile,
	// search / find
	searchMessages,
	findChannels,
	findPeople,
	whoIs,
	findFiles,
	// conversation intelligence
	readRecentMessages,
	catchMeUp,
	unreadDigest,
	setMorningBrief,
	// notifications
	markChannelRead,
	markAllRead,
	muteChannel,
	// message actions
	postMessage,
	reactToMessage,
	// tasks
	listMyTasks,
	completeTask,
	createTask,
	// deadlines
	upcomingDeadlines,
];
