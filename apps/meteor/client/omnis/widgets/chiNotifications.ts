import type { INotificationDesktop } from '@rocket.chat/core-typings';

import { sdk } from '../../../app/utils/client/lib/SDKClient';

/**
 * Chi notification routing — the bridge between MatterChat's notification pipeline and the Chi
 * orb. When the member flips "Route notifications to Chi" (persisted by the orb as
 * localStorage 'chi-notif-route'), every event that would have become an OS banner is handed
 * to the orb instead: a rich card in the conversation (or the orb's transient banner / queued
 * digest, per the orb's own state). Scope is deliberately IDENTICAL to desktop notifications —
 * mentions, DMs, and channels per the user's existing notification preferences — because we
 * intercept at the exact point the OS banner would fire (useNotification). Badge counts and
 * mobile push are untouched.
 *
 * The DESKTOP app complication: when Chi is popped out (Electron), the visible orb lives in a
 * SEPARATE window (chi-window.html). Same origin + session partition → shared localStorage, so
 * we relay the card as a storage write the popout listens for (chi-window.js). The web PiP case
 * needs no relay — the popped orb element still belongs to this document.
 */

const RELAY_KEY = 'chi-notif-relay';

/** Colors keyed by room type, matching the orb's source-badge treatment. */
const TYPE_COLORS: Record<string, string> = {
	d: '#8e44ad', // direct
	c: '#2980b9', // channel
	p: '#16a085', // private group
	l: '#d35400', // livechat
};
const TYPE_LABELS: Record<string, string> = {
	d: 'Direct',
	c: 'Channel',
	p: 'Private',
	l: 'Livechat',
};

export type ChiNotifCard = {
	sender: string;
	text: string;
	app: string;
	color: string;
	avatar: string;
	data: { rid: string; msgId?: string; tmid?: string; type?: string; roomName?: string };
};

export const isRoutedToChi = (): boolean => {
	try {
		return localStorage.getItem('chi-notif-route') === '1';
	} catch {
		return false;
	}
};

const isDesktopPoppedOut = (): boolean => {
	try {
		return Boolean((window as unknown as { matterchatDesktop?: { isDesktop?: boolean } }).matterchatDesktop?.isDesktop) && localStorage.getItem('chi-popped') === '1';
	} catch {
		return false;
	}
};

export const toChiCard = (notification: INotificationDesktop): ChiNotifCard | undefined => {
	const payload = notification.payload;
	if (!payload?.rid) {
		return undefined;
	}
	const type = payload.type || 'c';
	const sender = notification.title || payload.sender?.name || payload.sender?.username || 'Someone';
	return {
		sender,
		text: notification.text || '',
		app: TYPE_LABELS[type] || 'MatterChat',
		color: TYPE_COLORS[type] || '#4a6cf7',
		avatar: sender.charAt(0).toUpperCase(),
		data: { rid: payload.rid, msgId: payload._id, tmid: payload.tmid, type, roomName: payload.name },
	};
};

type OrbEl = HTMLElement & { notify?: (card: ChiNotifCard) => void };

/** Hand one would-be OS notification to Chi (local orb, or the popped-out desktop window). */
export const routeNotificationToChi = (notification: INotificationDesktop): boolean => {
	const card = toChiCard(notification);
	if (!card) {
		return false;
	}
	if (isDesktopPoppedOut()) {
		try {
			// storage events only fire in OTHER windows — exactly what we want for the popout.
			localStorage.setItem(RELAY_KEY, JSON.stringify({ ts: Date.now(), card }));
			return true;
		} catch {
			/* fall through to the (hidden) local orb */
		}
	}
	const orb = document.querySelector('chi-orb') as OrbEl | null;
	if (orb?.notify) {
		orb.notify(card);
		return true;
	}
	return false;
};

/** Post a reply typed on a Chi notification card back to its room, as the member. */
export const sendChiReply = async (target: { data?: { rid?: string } }, text: string): Promise<void> => {
	const rid = target?.data?.rid;
	if (!rid || !text.trim()) {
		throw new Error('missing room');
	}
	await (sdk.rest.post as (e: string, p: unknown) => Promise<unknown>)('/v1/chat.postMessage', { roomId: rid, text });
};

/**
 * Insert Flow-dictated text into the room composer (the fastest "speeds up writing" path).
 * React tracks the textarea through its own value setter, so we go through the native setter +
 * an input event; if no composer is on screen, the caller falls back to the clipboard.
 */
export const insertIntoComposer = (text: string): boolean => {
	const ta = document.querySelector('footer textarea, [role="main"] textarea, textarea[name="msg"]') as HTMLTextAreaElement | null;
	if (!ta) {
		return false;
	}
	const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
	const start = ta.selectionStart ?? ta.value.length;
	const next = `${ta.value.slice(0, start)}${ta.value.length && start === ta.value.length && !/\s$/.test(ta.value) ? ' ' : ''}${text}${ta.value.slice(ta.selectionEnd ?? start)}`;
	if (setter) {
		setter.call(ta, next);
	} else {
		ta.value = next;
	}
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	ta.focus();
	return true;
};
