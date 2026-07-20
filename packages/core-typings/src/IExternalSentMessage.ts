import type { ExternalProvider } from './IExternalWorkspaceConnection';
import type { IRocketChatRecord } from './IRocketChatRecord';

/**
 * A message the user sent OUT to an external workspace (Slack/Teams/Google) through the
 * connector, stored durably by MatterChat.
 *
 * WHY THIS EXISTS: Slack's `conversations.history` API does NOT return a non-Marketplace
 * app's OWN sent messages (verified end-to-end), so the browse view — which re-reads that
 * API — could never show a message the user sent from MatterChat, even days later. This is
 * MatterChat's own record of what it sent, merged into the browse view so the user's sent
 * messages are guaranteed visible forever, on every device, independent of the provider's read.
 */
export interface IExternalSentMessage extends IRocketChatRecord {
	/** Owner (the sender) — every read is scoped to this. */
	userId: string;
	/** The external-workspace connection the message was sent through. */
	connectionId: string;
	provider: ExternalProvider;
	/** Provider-native channel/DM id the message was sent to. */
	channelExternalId: string;
	/** Provider-native message id (Slack `ts`), used to dedupe against provider history if it ever returns it. */
	externalId: string;
	text: string;
	/** Sender display attribution (resolved at send time). */
	author?: string;
	authorAvatarUrl?: string;
	/** Provider-native creation time (from the send echo). */
	createdAt: Date;
	/**
	 * How MatterChat learned about this message. OPTIONAL for backward compatibility — documents
	 * written before this field existed are all `'sent'` by construction.
	 *  - `sent`    — we posted it out through the connector.
	 *  - `inbound` — pushed to us live by the provider's events API.
	 *  - `history` — read from the provider's history API and persisted so it stays native to
	 *                MatterChat (survives the provider's rate limits and retention gaps).
	 */
	source?: 'sent' | 'inbound' | 'history';
}

/**
 * Live-push payload for one inbound external message, emitted on the `notify-user` stream as
 * `${userId}/external-inbound` the moment an Events-API delivery is persisted to the browse
 * store (see app/connectors/server/providers/slack/inboundPush.ts). Carries ROUTING info + a
 * short preview only — never the full message body; the client re-reads the durable store.
 */
export interface IExternalInboundNotification {
	provider: ExternalProvider;
	/** The recipient user's own connection doc id (query-key routing on the client). */
	connectionId: string;
	channelExternalId: string;
	/** Provider-native message id (Slack `ts`). */
	externalId: string;
	/** Author display name when resolvable (raw provider id otherwise). */
	author?: string;
	/** First ~140 chars of the message, for the notification body. */
	preview?: string;
	tsMs?: number;
}
