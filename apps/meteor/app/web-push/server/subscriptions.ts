import { db } from '../../../server/database/utils';

/**
 * MatterChat Web Push (VAPID) — browser/PWA push subscription storage.
 *
 * The RC push gateway (app/push/server) only talks to native FCM/APN device
 * tokens, so an installed PWA gets ZERO background push from it. This module
 * stores W3C Push API subscriptions (one user -> many browsers/devices) so the
 * server can fan a notification out to browsers too. See MATTERCHAT-DESKTOP-PWA-SPEC.md B.4.
 *
 * Stored in a dedicated raw collection (NOT a @rocket.chat/models class) to keep
 * this feature fully self-contained / clean-room — no shared model-package edits.
 */

export type WebPushSubscriptionRecord = {
	_id: string; // sha-ish of endpoint, so re-subscribe upserts instead of duplicating
	userId: string;
	endpoint: string;
	keys: { p256dh: string; auth: string };
	ua?: string;
	createdAt: Date;
	updatedAt: Date;
};

const COLLECTION = 'rocketchat_web_push_subscription';

const collection = () => db.collection<WebPushSubscriptionRecord>(COLLECTION);

let indexesEnsured = false;
async function ensureIndexes(): Promise<void> {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	try {
		await collection().createIndex({ userId: 1 });
		await collection().createIndex({ endpoint: 1 }, { unique: true });
	} catch (err) {
		// Index creation is best-effort; never block subscribe on it.
		console.error('[web-push] failed to ensure indexes', err);
	}
}

// Stable id from the endpoint URL so the same browser re-subscribing upserts.
function idFromEndpoint(endpoint: string): string {
	let hash = 0;
	for (let i = 0; i < endpoint.length; i++) {
		hash = (hash * 31 + endpoint.charCodeAt(i)) | 0;
	}
	return `wps_${(hash >>> 0).toString(36)}_${endpoint.length}`;
}

export async function saveSubscription(
	userId: string,
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
	ua?: string,
): Promise<void> {
	await ensureIndexes();
	const now = new Date();
	await collection().updateOne(
		{ endpoint: subscription.endpoint },
		{
			$set: {
				userId,
				endpoint: subscription.endpoint,
				keys: subscription.keys,
				ua,
				updatedAt: now,
			},
			$setOnInsert: {
				_id: idFromEndpoint(subscription.endpoint),
				createdAt: now,
			},
		},
		{ upsert: true },
	);
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
	await ensureIndexes();
	await collection().deleteOne({ userId, endpoint });
}

/** Remove a dead subscription (called when a push send returns 404/410 Gone). */
export async function pruneSubscription(endpoint: string): Promise<void> {
	await collection().deleteOne({ endpoint });
}

export async function getSubscriptionsForUser(userId: string): Promise<WebPushSubscriptionRecord[]> {
	await ensureIndexes();
	return collection().find({ userId }).toArray();
}
