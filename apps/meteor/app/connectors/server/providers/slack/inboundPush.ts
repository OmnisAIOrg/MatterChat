/**
 * Live push for inbound external messages — the missing half of the browse lane.
 *
 * recordInboundForBrowse makes an inbound Slack message DURABLE, but until now nothing told the
 * recipient's client about it: the open channel waited for its next poll (10s foreground-only)
 * and nothing ever fired a notification — founder-reported as "delivery is inconsistent,
 * sometimes requiring a manual page refresh… no in-app notification" (bug 2026-07-20).
 *
 * Emits ONE `notify-user` stream event per affected connection owner —
 * `${userId}/external-inbound` (typed in packages/ddp-client streams.ts) — the moment the event
 * is persisted. The client hook (client/views/root/MainLayout/useExternalInboundPush.ts)
 * invalidates the browse queries (instant render) and raises the sound/desktop notification.
 * Target selection (echo-safe, per-connection) is pure and lives in ./inboundPushTargets.ts.
 */
import type { InboundPushTarget } from './inboundPushTargets';
import { SystemLogger } from '../../../../../server/lib/logger/system';
import notifications from '../../../../notifications/server/lib/Notifications';

export { buildInboundPushTargets } from './inboundPushTargets';
export type { InboundPushTarget } from './inboundPushTargets';

/** Emit the stream events. Never throws — push failure must not break ingest/persistence. */
export function pushInboundToClients(targets: InboundPushTarget[]): void {
	for (const { userId, payload } of targets) {
		try {
			notifications.notifyUser(userId, 'external-inbound', payload);
		} catch (err) {
			SystemLogger.warn({ msg: 'external-inbound push failed', userId, err: String(err) });
		}
	}
}
