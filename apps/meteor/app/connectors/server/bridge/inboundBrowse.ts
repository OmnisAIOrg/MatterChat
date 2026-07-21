/**
 * Provider-generic inbound browse-store write + live push — the Teams/Google port of the two
 * calls that made Slack inbound live (slack/eventProcessing.ts processNewMessage): persist the
 * message as a `source:'inbound'` row (the ONLY rows the store-computed unread dots count — see
 * channelSeen.ts) and emit the `${userId}/external-inbound` notify-user stream event (instant
 * render + DM sound/banner via client useExternalInboundPush).
 *
 * Slack keeps its own copy in eventProcessing.ts because its recipient set is different ("every
 * connection on the workspace", derived from the app-level Events API). This module serves the
 * per-bridge transports: the Teams change-notification webhook, and the reconcile/backfill poll
 * lane (Teams missed windows; Google's ONLY inbound path — it has no push transport).
 *
 * Echo rule: the AUTHOR's own connection never gets pushed its own message back (matching the
 * native behavior of Slack/Teams — your own send, from any client, must not buzz you). The
 * browse-store row IS still written for the author (recordSeenBatch $setOnInsert keeps an
 * existing 'sent' record intact, so this is a no-op for MatterChat-originated sends).
 */
import type { IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import { ExternalSentMessages } from '@rocket.chat/models';

import { SystemLogger } from '../../../../server/lib/logger/system';
import type { IProviderMessage } from '../ChatProvider';
import { buildInboundPushTargets, pushInboundToClients } from '../providers/slack/inboundPush';

export type InboundRecipient = {
	doc: IExternalWorkspaceConnection;
	/** This connection owner's OWN external user id (Teams AAD oid / Slack U… / Google user) — echo suppression. */
	selfExternalId?: string;
};

/**
 * Best-effort channel kind for notification scoping (the client only sounds/banners 'im'/'mpim'):
 * Teams channel composites ("teamId|channelId") are channels; a bare Teams chat id is a DM or
 * group chat → 'im' (Slack-DM notification semantics — they buzz). Google space ids don't encode
 * DM-vs-room → undefined (badge/dot updates only, no sound).
 */
export function inboundChannelKindOf(provider: string, channelExternalId: string): string | undefined {
	if (provider === 'teams') {
		return channelExternalId.includes('|') ? 'channel' : 'im';
	}
	return undefined;
}

/** Persist one inbound message for every recipient and live-push it (echo-safe). Never throws. */
export async function recordAndPushInbound(
	recipients: InboundRecipient[],
	channelExternalId: string,
	mapped: IProviderMessage,
	opts: { channelKind?: string; tsMs?: number } = {},
): Promise<void> {
	const eligible = recipients.filter((r) => r.doc?._id && r.doc.userId);
	if (!eligible.length || !mapped.externalId || !channelExternalId) {
		return;
	}
	const createdAt = opts.tsMs !== undefined ? new Date(opts.tsMs) : new Date();
	try {
		await ExternalSentMessages.recordSeenBatch(
			eligible.map(({ doc }) => ({
				userId: doc.userId,
				connectionId: doc._id,
				provider: doc.provider,
				channelExternalId,
				externalId: mapped.externalId,
				text: mapped.text,
				...(mapped.authorDisplayName ? { author: mapped.authorDisplayName } : {}),
				...(mapped.authorAvatarUrl ? { authorAvatarUrl: mapped.authorAvatarUrl } : {}),
				createdAt,
				source: 'inbound' as const,
			})),
		);
	} catch (err) {
		SystemLogger.warn({ msg: 'Inbound browse-store write failed (bridge unaffected)', err: String(err) });
	}

	const authorId = mapped.authorExternalId;
	const echoIds = new Set(
		eligible.filter((r) => authorId && r.selfExternalId && r.selfExternalId === authorId).map((r) => r.doc._id),
	);
	pushInboundToClients(
		buildInboundPushTargets(
			eligible.map((r) => r.doc),
			(connectionId) => echoIds.has(connectionId),
			{
				channelExternalId,
				...(opts.channelKind ? { channelKind: opts.channelKind } : {}),
				externalId: mapped.externalId,
				...(mapped.authorDisplayName ? { author: mapped.authorDisplayName } : {}),
				...(mapped.text ? { text: mapped.text } : {}),
				...(opts.tsMs !== undefined ? { tsMs: opts.tsMs } : {}),
			},
		),
	);
}
