/**
 * Pure mapping from a Slack Events API `message` event to the normalized action the inbound
 * bridge processes. NO Meteor imports — unit-tested directly
 * (apps/meteor/tests/unit/app/connectors/slackEventMapping.spec.ts). The Slack sibling of
 * providers/teams/messageMapping.ts.
 *
 * SCOPE (mirrors the Teams inbound bridge + SlackProvider.syncMessages):
 *  - `message` events in channels (`channel_type: 'channel'`) and private channels (`'group'`) —
 *    DMs (`im`/`mpim`) stay poll/backfill-only for now;
 *  - NEW user messages (no subtype) → ingest; thread replies carry `thread_ts` → mapped to the
 *    bridge's threadExternalId (same as Teams `replyToId`);
 *  - `message_changed` → an EDIT of the nested `message` (`message.ts` addresses the original);
 *  - `message_deleted` → a DELETE of `deleted_ts`;
 *  - EVERYTHING ELSE IS SKIPPED, exactly like syncMessages: any other subtype (channel_join,
 *    thread_broadcast, …), any `bot_id` author (echo/no human author — this is also the guard that
 *    drops posts made by the connector app's own bot user), any authorless payload.
 *
 * FILES: Slack file content isn't fetchable without extra scopes/auth, so attachments surface as
 * LINK-OUT STUBS — the file name + Slack permalink appended to the message text (and carried as
 * IProviderFileRef entries for future rendering).
 *
 * Clean-room: written from the Slack Events API docs; nothing under apps/meteor/ee/ was read or
 * copied.
 */
import type { IProviderFileRef, IProviderMessage } from '../../ChatProvider';

/** Upper bound for any single id field we parse (Slack ids are far shorter). */
const MAX_FIELD_LENGTH = 2048;

/** The subset of a Slack `message` event the mapping reads (top-level or nested `message`). */
type SlackEventMessage = {
	type?: unknown;
	subtype?: unknown;
	channel?: unknown;
	channel_type?: unknown;
	user?: unknown;
	bot_id?: unknown;
	text?: unknown;
	ts?: unknown;
	thread_ts?: unknown;
	deleted_ts?: unknown;
	edited?: { ts?: unknown };
	message?: SlackEventMessage;
	files?: unknown;
};

/** One Slack file reference reduced to the fields the stub rendering consumes. */
export type SlackFileStub = IProviderFileRef;

/** The normalized inbound actions the bridge processes (anything else maps to null = skipped). */
export type SlackMessageAction =
	| {
			kind: 'new';
			channel: string;
			ts: string;
			user: string;
			text: string;
			threadTs?: string;
			files?: SlackFileStub[];
	  }
	| {
			kind: 'edit';
			channel: string;
			/** The ORIGINAL message's ts (the external id the bridge knows it by). */
			ts: string;
			user: string;
			text: string;
			threadTs?: string;
			editedTs?: string;
			files?: SlackFileStub[];
	  }
	| {
			kind: 'delete';
			channel: string;
			/** The deleted message's ts (the external id the bridge knows it by). */
			ts: string;
	  };

const asBoundedString = (v: unknown): string | undefined =>
	typeof v === 'string' && v && v.length <= MAX_FIELD_LENGTH ? v : undefined;

/** Extract link-out stubs for the files carried on a message payload (best-effort, never throws). */
function extractFiles(files: unknown): SlackFileStub[] | undefined {
	if (!Array.isArray(files) || files.length === 0) {
		return undefined;
	}
	const out: SlackFileStub[] = [];
	for (const f of files) {
		if (!f || typeof f !== 'object') {
			continue;
		}
		const { id, name, mimetype, permalink, size } = f as Record<string, unknown>;
		const externalId = asBoundedString(id);
		if (!externalId) {
			continue;
		}
		out.push({
			externalId,
			...(asBoundedString(name) ? { name: asBoundedString(name) } : {}),
			...(asBoundedString(mimetype) ? { mimeType: asBoundedString(mimetype) } : {}),
			...(asBoundedString(permalink) ? { url: asBoundedString(permalink) } : {}),
			...(typeof size === 'number' ? { size } : {}),
		});
	}
	return out.length ? out : undefined;
}

/**
 * The bridged rooms are Slack CHANNELS (public `channel` / private `group`) — DM events are
 * skipped. A missing channel_type is tolerated (some delivery shapes omit it): routing requires an
 * existing bridged-channel mapping anyway, so an unbridged conversation matches nothing.
 */
function isBridgeableChannelType(channelType: unknown): boolean {
	return channelType === undefined || channelType === 'channel' || channelType === 'group';
}

/**
 * Normalize ONE `message` event into the action the bridge processes, or null when it should not
 * surface (bot/system/echo/DM/malformed — fail-closed, mirroring syncMessages' skip rules).
 */
export function extractMessageEvent(event: Record<string, unknown>): SlackMessageAction | null {
	const msg = event as SlackEventMessage;
	if (msg.type !== 'message') {
		return null;
	}
	if (!isBridgeableChannelType(msg.channel_type)) {
		return null;
	}
	const channel = asBoundedString(msg.channel);
	if (!channel) {
		return null;
	}

	// ── message_deleted → delete of `deleted_ts` ────────────────────────────────────────────────
	if (msg.subtype === 'message_deleted') {
		const deletedTs = asBoundedString(msg.deleted_ts);
		return deletedTs ? { kind: 'delete', channel, ts: deletedTs } : null;
	}

	// ── message_changed → edit of the nested `message` ──────────────────────────────────────────
	if (msg.subtype === 'message_changed') {
		const inner = msg.message;
		if (!inner || typeof inner !== 'object') {
			return null;
		}
		// The nested message must itself be a human message (no bot, no subtype like `tombstone`).
		if (inner.bot_id || (inner.subtype !== undefined && inner.subtype !== null)) {
			return null;
		}
		const ts = asBoundedString(inner.ts);
		const user = asBoundedString(inner.user);
		if (!ts || !user) {
			return null;
		}
		const threadTs = asBoundedString(inner.thread_ts);
		const editedTs = asBoundedString(inner.edited?.ts);
		return {
			kind: 'edit',
			channel,
			ts,
			user,
			text: typeof inner.text === 'string' ? inner.text : '',
			...(threadTs && threadTs !== ts ? { threadTs } : {}),
			...(editedTs ? { editedTs } : {}),
			...(extractFiles(inner.files) ? { files: extractFiles(inner.files) } : {}),
		};
	}

	// ── plain new message (no subtype) ──────────────────────────────────────────────────────────
	// Skip bot/system messages exactly like syncMessages: any subtype (channel_join, bot_message,
	// thread_broadcast, …), any bot_id (echo guard for app-bot posts), or no human `user`.
	if (msg.subtype !== undefined && msg.subtype !== null) {
		return null;
	}
	if (msg.bot_id) {
		return null;
	}
	const ts = asBoundedString(msg.ts);
	const user = asBoundedString(msg.user);
	if (!ts || !user) {
		return null;
	}
	const threadTs = asBoundedString(msg.thread_ts);
	return {
		kind: 'new',
		channel,
		ts,
		user,
		text: typeof msg.text === 'string' ? msg.text : '',
		...(threadTs && threadTs !== ts ? { threadTs } : {}),
		...(extractFiles(msg.files) ? { files: extractFiles(msg.files) } : {}),
	};
}

/** Render the link-out stub lines appended to a message's text for its attachments. */
export function fileStubLines(files: SlackFileStub[] | undefined): string {
	if (!files?.length) {
		return '';
	}
	return files
		.map((f) => {
			const label = f.name || f.externalId;
			return f.url ? `[shared file: ${label}](${f.url})` : `[shared file: ${label}]`;
		})
		.join('\n');
}

/**
 * Build the provider-neutral IProviderMessage the bridge ingests from a normalized new/edit
 * action. Same vocabulary as SlackProvider.syncMessages so the deterministic RC message ids MATCH
 * between event ingest and REST backfill (that identity is the persistence-level dedupe):
 * `externalId`/`ts` are the raw Slack `ts`, thread root rides as `threadExternalId`. File-only
 * messages get their stub lines as the text so they still surface (ingest drops empty text).
 */
export function toProviderMessage(action: Extract<SlackMessageAction, { kind: 'new' | 'edit' }>, authorDisplayName?: string): IProviderMessage {
	const stubs = fileStubLines(action.files);
	const text = [action.text?.trim(), stubs].filter(Boolean).join('\n');
	return {
		externalId: action.ts,
		channelExternalId: action.channel,
		authorExternalId: action.user,
		...(authorDisplayName ? { authorDisplayName } : {}),
		text,
		ts: action.ts,
		...(action.threadTs ? { threadExternalId: action.threadTs } : {}),
		...(action.kind === 'edit' && action.editedTs ? { editedTs: action.editedTs } : {}),
		...(action.files ? { files: action.files } : {}),
	};
}

/** Slack `ts` ("seconds.micros") → epoch ms, or undefined when unparseable (cursor bookkeeping). */
export function slackTsToEpochMs(ts: string): number | undefined {
	const seconds = parseFloat(ts);
	return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}
