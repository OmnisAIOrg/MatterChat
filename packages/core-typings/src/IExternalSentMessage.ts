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
}
