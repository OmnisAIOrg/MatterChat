/**
 * Real-time PUSH (webhook) subscription lifecycle for the STANDALONE calendar path — the parity
 * follow-up to the 15-min inbound POLL. Composes the provider push methods (events.watch /
 * /subscriptions) with the token layer + model, exactly as service.ts composes the read/write methods.
 *
 * DESIGN (mirrors the Teams bridge's subscription lifecycle):
 *  - create on connect (best-effort — a failure leaves the connection poll-only, never breaks connect);
 *  - a renewal sweep on the existing cron re-creates/PATCHes BEFORE expiry (Google channels aren't
 *    renewable in place → stop+watch; Graph PATCHes);
 *  - delete on disconnect (best-effort, before the connection doc is removed);
 *  - on a VERIFIED notification, run the SAME inbound reconcile the poll does (pollConnection) — the
 *    payload is NEVER trusted for content; it only means "something changed, reconcile now". Debounced
 *    per connection so a burst of Graph/Google notifications collapses into one reconcile.
 *
 * GATED: every entry point is a no-op unless isCalendarPushConfigured(provider) (enabled + client
 * id/secret + push secret + https base). No push secret ⇒ zero push traffic; the poll keeps running.
 *
 * STANDALONE ONLY: the CasePro-preferred path owns its own calendar refresh and never gets a push
 * subscription (the cron/REST layer routes CasePro users through CasePro before reaching here).
 */
import type { IBoardCalendarConnection } from '@rocket.chat/core-typings';
import { BoardCalendarConnections } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';

import type { IPushSubscriptionParams } from './CalendarProvider';
import { getCalendarPushSecret, googlePushNotificationUrl, isCalendarPushConfigured, outlookPushNotificationUrl } from './config';
import { derivePushToken, shouldRenewPush } from './pushSecurity';
import { getCalendarProvider } from './registry';
import { pollConnection } from './service';
import { withFreshToken } from './tokens';
import { SystemLogger } from '../../logger/system';

/** Renew a subscription this long BEFORE it expires (so a renewal failure still has slack to retry). */
export const RENEW_LEAD_MS = 12 * 60 * 60 * 1000; // 12h

/** Collapse a burst of notifications for one connection into a single reconcile within this window. */
const DEBOUNCE_MS = 3_000;

/** Per-connection debounce timers for webhook-triggered reconciles (in-process; best-effort). */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The notification URL for a provider (the receiver's per-provider path). */
function notificationUrlFor(provider: IBoardCalendarConnection['provider']): string {
	return provider === 'google' ? googlePushNotificationUrl() : outlookPushNotificationUrl();
}

/**
 * Build the create/renew params for a connection. The channel token is DERIVED from the deploy secret
 * + (connectionId, subscriptionId) so the webhook verifies statelessly. Google needs a client-minted
 * subscription id (a UUID); Graph mints its own but we still derive a token against the id we send so
 * both providers share one code path — Graph's real id replaces ours in the result before we persist.
 */
function buildParams(conn: IBoardCalendarConnection, subscriptionId: string): IPushSubscriptionParams {
	const secret = getCalendarPushSecret();
	return {
		notificationUrl: notificationUrlFor(conn.provider),
		channelToken: derivePushToken(secret, conn._id, subscriptionId),
		subscriptionId,
	};
}

/**
 * Create a real-time push subscription for a connection (STANDALONE path). No-op + return false when
 * push is unconfigured or the connection isn't connected — the poll remains the sync path. Best-effort:
 * any failure is logged and swallowed (the caller keeps the connection on the poll). NEVER logs tokens.
 */
export async function ensurePushSubscription(conn: IBoardCalendarConnection): Promise<boolean> {
	if (!isCalendarPushConfigured(conn.provider) || conn.status !== 'connected') {
		return false;
	}
	// Already have a live-enough subscription? Leave it (the sweep renews before expiry).
	if (conn.push && !shouldRenewPush(conn.push.expiresAt, new Date(), RENEW_LEAD_MS)) {
		return true;
	}
	const provider = getCalendarProvider(conn.provider);
	const subscriptionId = Random.id(); // Google requires a client UUID; Graph ignores it (mints its own)
	try {
		const result = await withFreshToken(conn, (token) =>
			provider.createPushSubscription(token, conn.targetCalendarId, buildParams(conn, subscriptionId)),
		);
		await BoardCalendarConnections.setPushSubscriptionById(conn._id, {
			subscriptionId: result.subscriptionId,
			...(result.resourceId ? { resourceId: result.resourceId } : {}),
			expiresAt: result.expiresAt,
			createdAt: new Date(),
		});
		SystemLogger.info({
			msg: 'boards.calendar.push.subscribed',
			connectionId: conn._id,
			provider: conn.provider,
			expiresAt: result.expiresAt,
		});
		return true;
	} catch (err) {
		// Belt-and-suspenders: push is a best-effort enhancement; on failure the connection stays on the poll.
		SystemLogger.warn({ msg: 'boards.calendar.push.subscribe.failed', connectionId: conn._id, err: String(err) });
		return false;
	}
}

/**
 * Renew one connection's push subscription (create-if-missing, otherwise renew before expiry). Called
 * by the cron sweep. Best-effort; clears the stored push (→ poll-only) if renewal hard-fails so the
 * next sweep re-creates cleanly. NEVER logs tokens.
 */
export async function renewPushSubscription(conn: IBoardCalendarConnection): Promise<void> {
	if (!isCalendarPushConfigured(conn.provider) || conn.status !== 'connected') {
		return;
	}
	if (!conn.push) {
		await ensurePushSubscription(conn);
		return;
	}
	if (!shouldRenewPush(conn.push.expiresAt, new Date(), RENEW_LEAD_MS)) {
		return; // not due yet
	}
	const provider = getCalendarProvider(conn.provider);
	// Google re-creates under a NEW id; Graph PATCHes the same id. Supply a fresh id + token for the
	// Google case; Graph's renew ignores params.subscriptionId and keeps its own.
	const newId = Random.id();
	try {
		const result = await withFreshToken(conn, (token) =>
			provider.renewPushSubscription(
				token,
				conn.targetCalendarId,
				{ subscriptionId: conn.push!.subscriptionId, ...(conn.push!.resourceId ? { resourceId: conn.push!.resourceId } : {}) },
				buildParams(conn, newId),
			),
		);
		await BoardCalendarConnections.setPushSubscriptionById(conn._id, {
			subscriptionId: result.subscriptionId,
			...(result.resourceId ? { resourceId: result.resourceId } : {}),
			expiresAt: result.expiresAt,
			createdAt: new Date(),
		});
		SystemLogger.debug({ msg: 'boards.calendar.push.renewed', connectionId: conn._id, expiresAt: result.expiresAt });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.calendar.push.renew.failed', connectionId: conn._id, err: String(err) });
		// Drop the stale record → next sweep re-creates; poll keeps sync alive in the meantime.
		await BoardCalendarConnections.setPushSubscriptionById(conn._id, undefined).catch(() => undefined);
	}
}

/**
 * Tear down a connection's push subscription (best-effort) — called on disconnect BEFORE the doc is
 * removed. A failure is swallowed (the provider expires the channel on its own). NEVER logs tokens.
 */
export async function teardownPushSubscription(conn: IBoardCalendarConnection): Promise<void> {
	if (!conn.push) {
		return;
	}
	const provider = getCalendarProvider(conn.provider);
	try {
		await withFreshToken(conn, (token) =>
			provider.deletePushSubscription(token, {
				subscriptionId: conn.push!.subscriptionId,
				...(conn.push!.resourceId ? { resourceId: conn.push!.resourceId } : {}),
			}),
		);
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.calendar.push.teardown.failed', connectionId: conn._id, err: String(err) });
	}
	await BoardCalendarConnections.setPushSubscriptionById(conn._id, undefined).catch(() => undefined);
}

/**
 * Sweep all connections whose push subscription is due for renewal and renew them. Reused by the cron
 * (extends the existing 15-min tick). No-op when push is globally unconfigured — the query is only run
 * for connections that already carry a `push` field, so a push-less deploy enumerates nothing.
 */
export async function renewExpiringPushSubscriptions(): Promise<{ renewed: number; failed: number }> {
	const dueBefore = new Date(Date.now() + RENEW_LEAD_MS);
	const conns = await BoardCalendarConnections.findConnectedWithPushExpiringBefore(dueBefore).toArray();
	let renewed = 0;
	let failed = 0;
	for (const conn of conns) {
		try {
			await renewPushSubscription(conn);
			renewed++;
		} catch (err) {
			failed++;
			SystemLogger.warn({ msg: 'boards.calendar.push.sweep.item.failed', connectionId: conn._id, err: String(err) });
		}
	}
	return { renewed, failed };
}

/**
 * A VERIFIED notification arrived for a connection → run the SAME inbound reconcile the poll does,
 * debounced per connection. This reuses pollConnection wholesale — no mapping logic is duplicated; the
 * webhook just makes the existing reconcile happen NOW instead of at the next 15-min tick. The reconcile
 * itself remains the source of truth (and the poll still runs on the cron as the fallback).
 */
export function dispatchPushReconcile(connectionId: string): void {
	const existing = debounceTimers.get(connectionId);
	if (existing) {
		clearTimeout(existing);
	}
	const timer = setTimeout(() => {
		debounceTimers.delete(connectionId);
		void (async () => {
			try {
				const conn = await BoardCalendarConnections.findOne({ _id: connectionId });
				if (!conn || conn.status !== 'connected') {
					return;
				}
				const result = await pollConnection(conn);
				SystemLogger.debug({ msg: 'boards.calendar.push.reconcile', connectionId, ...result });
			} catch (err) {
				SystemLogger.warn({ msg: 'boards.calendar.push.reconcile.failed', connectionId, err: String(err) });
			}
		})();
	}, DEBOUNCE_MS);
	// Don't keep the event loop alive for a pending debounce timer.
	if (typeof timer.unref === 'function') {
		timer.unref();
	}
	debounceTimers.set(connectionId, timer);
}
