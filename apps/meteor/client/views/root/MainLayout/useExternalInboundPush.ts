/**
 * Client half of the external-connector live push (the server half is
 * app/connectors/server/providers/slack/inboundPush.ts).
 *
 * Subscribes `${uid}/external-inbound` on the `notify-user` stream. On each event:
 *  1. INSTANT RENDER — refetches the affected channel's messages + the unread summary. This is
 *     deliberately NARROW and per-channel THROTTLED (leading edge + one trailing pass): v1
 *     invalidated every `external-workspaces.*` query per event, and a busy connected workspace
 *     (user events fire for EVERY conversation the user is in) stampeded the REST API into its
 *     rate limiter — notifications arrived instantly while the view sat behind 429s
 *     (founder-reported 2026-07-20, same day). The 10s/30s polls remain the safety net for
 *     list-shaped queries (directChats/channels/members) — a per-message refetch of those adds
 *     nothing but load.
 *  2. NOTIFICATION — Slack-normal scoping: sound + browser banner for DMs (`im`/`mpim`) only,
 *     and only when that exact conversation isn't open in a focused tab. Channel messages
 *     re-render silently (the rail badge conveys them), so one lively public channel can't
 *     turn MatterChat into a noise machine.
 *
 * Mounted once from OrgSwitcherRail (`enabled=false` on the drawer re-mount).
 */
import type { IExternalInboundNotification } from '@rocket.chat/core-typings';
import { useCustomSound, useStream, useUserId } from '@rocket.chat/ui-contexts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Per-key refetch throttle: leading edge fires now, one trailing pass catches the burst tail. */
const THROTTLE_MS = 1500;
/** Per-conversation notification cooldown — a rapid DM volley gets one sound, not ten. */
const NOTIFY_COOLDOWN_MS = 5000;

const lastRefetchAt = new Map<string, number>();
const trailingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastNotifyAt = new Map<string, number>();

function throttledPerKey(key: string, run: () => void): void {
	const now = Date.now();
	const last = lastRefetchAt.get(key) ?? 0;
	if (now - last >= THROTTLE_MS) {
		lastRefetchAt.set(key, now);
		run();
		return;
	}
	if (!trailingTimers.has(key)) {
		trailingTimers.set(
			key,
			setTimeout(
				() => {
					trailingTimers.delete(key);
					lastRefetchAt.set(key, Date.now());
					run();
				},
				THROTTLE_MS - (now - last),
			),
		);
	}
}

const isDm = (kind: string | undefined): boolean => kind === 'im' || kind === 'mpim';

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
			const channelKey = `${event.connectionId}:${event.channelExternalId}`;
			const messagesKey = ['external-workspaces.messages', event.connectionId, event.channelExternalId];

			// Narrow, throttled refetch: the one conversation + the rail's unread summary.
			throttledPerKey(channelKey, () => {
				void queryClient.invalidateQueries({ queryKey: messagesKey });
			});
			throttledPerKey('unread-summary', () => {
				void queryClient.invalidateQueries({ queryKey: ['external-workspaces.unreadSummary'] });
			});
			// The sidebar's per-row unread pills read the channels/directChats lists — refresh them on
			// the same throttle so dots appear live (server overlays store-computed counts onto rows).
			throttledPerKey(`lists:${event.connectionId}`, () => {
				void queryClient.invalidateQueries({ queryKey: ['external-workspaces.directChats', event.connectionId] });
				void queryClient.invalidateQueries({ queryKey: ['external-workspaces.channels', event.connectionId] });
			});

			// Notifications: DMs only, not while staring at that conversation, cooldown per channel.
			if (!isDm(event.channelKind)) {
				return;
			}
			const observers = queryClient.getQueryCache().find({ queryKey: messagesKey })?.getObserversCount() ?? 0;
			if (observers > 0 && document.hasFocus()) {
				return;
			}
			const now = Date.now();
			if (now - (lastNotifyAt.get(channelKey) ?? 0) < NOTIFY_COOLDOWN_MS) {
				return;
			}
			lastNotifyAt.set(channelKey, now);
			try {
				notificationSounds.playNewMessage();
			} catch {
				// sound is best-effort (autoplay policies) — never block the render path
			}
			if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
				new window.Notification(event.author || 'New message', {
					body: event.preview || 'New direct message from your connected workspace',
					tag: `external-inbound-${channelKey}`,
				});
			}
		});
	}, [uid, enabled, notifyUser, queryClient, notificationSounds]);
};
