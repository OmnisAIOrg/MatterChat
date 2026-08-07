import { getSubscriptionsForUser, pruneSubscription } from './subscriptions';
import { settings } from '../../../server/settings';

/**
 * MatterChat Web Push dispatch (VAPID).
 *
 * Sends a notification to all of a user's browser/PWA push subscriptions, signed
 * with the server VAPID keypair. This runs ALONGSIDE the native FCM/APN gateway
 * (server/lib/notifications/push), which calls sendWebPushToUser() directly after
 * its own native fan-out — see the "MatterChat: fan the SAME notification out"
 * block in server/lib/notifications/push/push.ts. See spec B.4.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SERVER TODO (the one remaining piece of full VAPID plumbing):
 *   1. Add the `web-push` npm dependency to apps/meteor/package.json
 *      (`yarn workspace @rocket.chat/meteor add web-push`). It is intentionally
 *      NOT added here so this PR can't break the Meteor build on an unvetted dep.
 *   2. Set the env / settings:
 *        WEB_PUSH_VAPID_PUBLIC   (base64url public key)
 *        WEB_PUSH_VAPID_PRIVATE  (base64url private key)
 *        WEB_PUSH_SUBJECT        (mailto:ops@omnisai.io)
 *      Generate with: `npx web-push generate-vapid-keys`.
 *   3. That's it — the require() below picks `web-push` up automatically and this
 *      function starts delivering. Until then it no-ops (logs once) so nothing breaks.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type WebPushPayload = {
	title: string;
	body?: string;
	url?: string;
	icon?: string;
	tag?: string;
};

type WebPushLib = {
	setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
	sendNotification: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
};

let webpush: WebPushLib | null | undefined;
let warnedMissingLib = false;
let warnedMissingKeys = false;

function getLib(): WebPushLib | null {
	if (webpush !== undefined) {
		return webpush;
	}
	try {
		// `web-push` is an OPTIONAL runtime dependency, intentionally not added to
		// package.json yet (see SERVER TODO above) so the build can't break on it.
		// eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-unresolved
		webpush = require('web-push') as WebPushLib;
	} catch {
		webpush = null;
	}
	return webpush;
}

function getVapid(): { publicKey: string; privateKey: string; subject: string } | null {
	const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC || settings.get<string>('WebPush_VAPID_Public') || '';
	const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE || settings.get<string>('WebPush_VAPID_Private') || '';
	const subject = process.env.WEB_PUSH_SUBJECT || settings.get<string>('WebPush_Subject') || 'mailto:ops@omnisai.io';
	if (!publicKey || !privateKey) {
		return null;
	}
	return { publicKey, privateKey, subject };
}

/** Whether Web Push is fully configured (lib present + keys set). */
export function isWebPushConfigured(): boolean {
	return Boolean(getLib()) && Boolean(getVapid());
}

/** The VAPID public key the client needs to subscribe (or '' if unconfigured). */
export function getWebPushPublicKey(): string {
	return process.env.WEB_PUSH_VAPID_PUBLIC || settings.get<string>('WebPush_VAPID_Public') || '';
}

export async function sendWebPushToUser(userId: string, payload: WebPushPayload): Promise<void> {
	const lib = getLib();
	if (!lib) {
		if (!warnedMissingLib) {
			warnedMissingLib = true;
			console.warn('[web-push] `web-push` package not installed — browser push disabled (see send.ts SERVER TODO).');
		}
		return;
	}
	const vapid = getVapid();
	if (!vapid) {
		if (!warnedMissingKeys) {
			warnedMissingKeys = true;
			console.warn('[web-push] VAPID keys not set (WEB_PUSH_VAPID_*) — browser push disabled.');
		}
		return;
	}

	lib.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

	const subs = await getSubscriptionsForUser(userId);
	const body = JSON.stringify(payload);

	await Promise.all(
		subs.map(async (sub) => {
			try {
				await lib.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
			} catch (err) {
				const { statusCode } = err as { statusCode?: number };
				// 404/410 => the subscription is dead; prune it (spec B.4 step 5).
				if (statusCode === 404 || statusCode === 410) {
					await pruneSubscription(sub.endpoint).catch(() => undefined);
					return;
				}
				console.error('[web-push] send failed', { endpoint: sub.endpoint, statusCode });
			}
		}),
	);
}
