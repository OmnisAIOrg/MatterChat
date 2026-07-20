/**
 * Client half of the external-connector live push (the server half is
 * app/connectors/server/providers/slack/inboundPush.ts).
 *
 * Subscribes `${uid}/external-inbound` on the `notify-user` stream. On each event:
 *  1. INSTANT RENDER — invalidates the browse queries for the affected connection/channel
 *     (useExternalMessages / useExternalDirectChats / useExternalChannels + the rail badges),
 *     so an open channel repaints immediately instead of waiting for its 10s poll.
 *  2. NOTIFICATION — unless that exact channel is open in a focused tab, plays the standard
 *     new-message sound and raises a browser notification (permission-gated, best-effort).
 *
 * Mounted once from OrgSwitcherRail (always rendered in the main layout). Self-contained by
 * design — no changes to RC's native notification plumbing (same posture as the Boards bell).
 */
import type { IExternalInboundNotification } from '@rocket.chat/core-typings';
import { useCustomSound, useStream, useUserId } from '@rocket.chat/ui-contexts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * @param enabled pass false on secondary mounts (the rail renders twice: desktop chrome +
 * mobile drawer) so the stream is subscribed exactly once per client.
 */
export const useExternalInboundPush = (enabled = true): void => {
	const uid = useUserId();
	const notifyUser = useStream('notify-user');
	const queryClient = useQueryClient();
	const { notificationSounds } = useCustomSound();

	useEffect(() => {
		if (!uid || !enabled) {
			return;
		}
		return notifyUser(`${uid}/external-inbound`, (event: IExternalInboundNotification) => {
			const messagesKey = ['external-workspaces.messages', event.connectionId, event.channelExternalId];

			// Is this exact channel currently rendered (an active observer on its messages query)?
			const observers = queryClient.getQueryCache().find({ queryKey: messagesKey })?.getObserversCount() ?? 0;
			const channelOpenAndFocused = observers > 0 && document.hasFocus();

			// Instant render: the affected channel first, then every external-workspaces query
			// (direct-chat/channel lists + rail unread badges) — all cheap local re-reads.
			void queryClient.invalidateQueries({ queryKey: messagesKey });
			void queryClient.invalidateQueries({
				predicate: (query) => String(query.queryKey?.[0] ?? '').startsWith('external-workspaces.'),
			});

			if (channelOpenAndFocused) {
				return; // the user is looking right at it — repaint is enough
			}
			try {
				notificationSounds.playNewMessage();
			} catch {
				// sound is best-effort (autoplay policies) — never block the render path
			}
			if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
				new window.Notification(event.author || 'New message', {
					body: event.preview || 'New message from your connected workspace',
					tag: `external-inbound-${event.connectionId}-${event.channelExternalId}`,
				});
			}
		});
	}, [uid, enabled, notifyUser, queryClient, notificationSounds]);
};
