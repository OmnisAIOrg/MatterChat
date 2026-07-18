/**
 * Pure mapping from a Microsoft Graph `chatMessage` payload to the provider-neutral
 * IProviderMessage the bridge/UI consume. NO Meteor imports — unit-tested directly
 * (apps/meteor/tests/unit/app/connectors/messageMapping.spec.ts).
 *
 * Used by BOTH read paths so a message maps identically whether it arrived by REST backfill
 * (TeamsProvider.syncMessages) or by change-notification webhook (webhook.ts fetches the full
 * message, then maps it here).
 *
 * Clean-room: written from the Microsoft Graph chatMessage docs; nothing under apps/meteor/ee/
 * was read or copied.
 */
import type { IProviderMessage } from '../../ChatProvider';

/** The subset of a Graph `chatMessage` resource the mapping reads. */
export type GraphChatMessage = {
	id?: string;
	messageType?: string;
	createdDateTime?: string;
	lastModifiedDateTime?: string;
	deletedDateTime?: string | null;
	body?: { content?: string; contentType?: 'text' | 'html' };
	from?: { user?: { id?: string; displayName?: string } } | null;
	/** Set on a threaded reply: the id of the thread's root message. */
	replyToId?: string | null;
	/** Attachments/files carried by the message (e.g., files, links). */
	attachments?: Array<{ name?: string; contentUrl?: string }>;
};

/**
 * Reduce a Teams message HTML body to plain text: drop tags, decode the handful of entities Graph
 * emits, and collapse whitespace. Deliberately tiny (no DOM dep) — richer rendering comes later;
 * here we need legible, safe text for the room.
 */
export function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>(?=)/gi, '\n')
		.replace(/<\/(p|div|li)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Map ONE Graph chatMessage to an IProviderMessage, or null when the message should not surface:
 *  - no id, or soft-deleted (`deletedDateTime` set);
 *  - system/event messages (joins, renames, calls) — no human `from.user`, or a non-`message`
 *    messageType.
 *
 * `channelExternalId` is the OPAQUE provider token the bridge carries for this conversation (the
 * `teamId|channelId` composite for a channel, or a bare chat id) — it rides through unchanged.
 */
export function mapGraphMessage(msg: GraphChatMessage | null | undefined, channelExternalId: string): IProviderMessage | null {
	if (!msg?.id || msg.deletedDateTime) {
		return null;
	}
	// Skip system/event messages (joins, renames) — they carry no human `from.user`.
	const authorId = msg.from?.user?.id;
	if (!authorId || (msg.messageType && msg.messageType !== 'message')) {
		return null;
	}
	const authorName = msg.from?.user?.displayName;

	const rawBody = msg.body?.content || '';
	const isHtml = msg.body?.contentType === 'html';
	let text = isHtml ? htmlToText(rawBody) : rawBody.trim();

	// Append attachments as plain-text lines when present (e.g., file-only messages with no body text).
	// Format: "Attachment: <name> — <URL>" or "<name>" if URL is missing, or "<URL>" if name is missing.
	if (msg.attachments?.length) {
		const attachmentLines = msg.attachments
			.map((att) => {
				if (att.name && att.contentUrl) {
					return `Attachment: ${att.name} — ${att.contentUrl}`;
				}
				if (att.name) {
					return `Attachment: ${att.name}`;
				}
				if (att.contentUrl) {
					return `Attachment: ${att.contentUrl}`;
				}
				return null;
			})
			.filter((line) => line !== null) as string[];

		if (attachmentLines.length) {
			text = text ? `${text}\n${attachmentLines.join('\n')}` : attachmentLines.join('\n');
		}
	}

	return {
		externalId: msg.id,
		channelExternalId,
		authorExternalId: authorId,
		// Display name rides on the message (`from.user.displayName`), so the bridge/UI can render
		// a name without a separate resolveIdentity lookup. Falls back to the id at the consumer.
		...(authorName ? { authorDisplayName: authorName } : {}),
		text,
		ts: msg.createdDateTime || '',
		...(msg.replyToId ? { threadExternalId: msg.replyToId } : {}),
		...(msg.lastModifiedDateTime && msg.lastModifiedDateTime !== msg.createdDateTime ? { editedTs: msg.lastModifiedDateTime } : {}),
	};
}
