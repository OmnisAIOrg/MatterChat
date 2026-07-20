/**
 * Pure target-selection for the external-inbound live push — NO Meteor imports so it is
 * unit-testable in isolation (tests/unit/app/connectors/slackInboundPush.spec.ts). The emitting
 * half (which pulls in the notifications streamer) lives in ./inboundPush.ts.
 */
import type { IExternalInboundNotification, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';

const PREVIEW_MAX = 140;

export type InboundPushTarget = { userId: string; payload: IExternalInboundNotification };

/** Pure: decide who gets pushed what for one inbound event. `hasEcho(connectionId)` = own echo. */
export function buildInboundPushTargets(
	docs: Pick<IExternalWorkspaceConnection, '_id' | 'userId' | 'provider'>[],
	hasEcho: (connectionId: string) => boolean,
	event: { channelExternalId: string; externalId: string; author?: string; text?: string; tsMs?: number },
): InboundPushTarget[] {
	if (!event.externalId || !event.channelExternalId) {
		return [];
	}
	const targets: InboundPushTarget[] = [];
	for (const doc of docs) {
		if (!doc?._id || !doc.userId || hasEcho(doc._id)) {
			continue;
		}
		targets.push({
			userId: doc.userId,
			payload: {
				provider: doc.provider,
				connectionId: doc._id,
				channelExternalId: event.channelExternalId,
				externalId: event.externalId,
				...(event.author ? { author: event.author } : {}),
				...(event.text ? { preview: event.text.slice(0, PREVIEW_MAX) } : {}),
				...(event.tsMs !== undefined ? { tsMs: event.tsMs } : {}),
			},
		});
	}
	return targets;
}
