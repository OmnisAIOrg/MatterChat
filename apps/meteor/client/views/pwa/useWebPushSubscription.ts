import { useSetting, useUserId } from '@rocket.chat/ui-contexts';
import { useEffect, useRef } from 'react';

import { urlBase64ToUint8Array } from './pwaEnv';
import { sdk } from '../../../app/utils/client/lib/SDKClient';

/**
 * Web Push (VAPID) client subscription — spec B.4 steps 2.
 *
 * Once (a) the user is logged in, (b) Notification permission is granted, and
 * (c) the server has a VAPID public key configured, subscribe this browser via
 * pushManager and POST the subscription to `webpush.subscribe`. Idempotent: if a
 * subscription already exists we just re-POST it (cheap, keeps the server record
 * fresh and self-heals if the row was pruned).
 *
 * Entirely best-effort: every failure is swallowed (logged) so it can never
 * interfere with the chat app. Endpoints aren't in the typed rest registry yet,
 * hence the `as any` on the SDK paths.
 */
export function useWebPushSubscription(): void {
	const userId = useUserId();
	const vapidPublicKey = useSetting('WebPush_VAPID_Public', '');
	const attemptedRef = useRef(false);

	useEffect(() => {
		if (!userId || !vapidPublicKey) {
			return;
		}
		if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
			return;
		}
		// Only subscribe after the user has granted notification permission.
		if (Notification.permission !== 'granted') {
			return;
		}
		if (attemptedRef.current) {
			return;
		}
		attemptedRef.current = true;

		let cancelled = false;

		(async () => {
			try {
				const registration = await navigator.serviceWorker.ready;
				const existing = await registration.pushManager.getSubscription();
				const subscription =
					existing ??
					(await registration.pushManager.subscribe({
						userVisibleOnly: true,
						// `.buffer` is a plain ArrayBuffer (a valid BufferSource); the bare
						// Uint8Array<ArrayBufferLike> generic doesn't structurally match lib.dom's type.
						applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
					}));

				if (cancelled) {
					return;
				}

				const json = subscription.toJSON();
				if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
					return;
				}

				await sdk.rest.post(
					'/v1/webpush.subscribe' as any,
					{
						subscription: {
							endpoint: json.endpoint,
							keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
						},
					} as any,
				);
			} catch (err) {
				// Permission revoked mid-flight, applicationServerKey mismatch, etc.
				// Never fatal.
				attemptedRef.current = false;
				console.error('[web-push] client subscription failed', err);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [userId, vapidPublicKey]);
}
