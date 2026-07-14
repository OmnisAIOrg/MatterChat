/**
 * Google Calendar (API v3) provider. Clean-room from the public Google Calendar API docs; nothing
 * under apps/meteor/ee/ was read. Talks ONLY to www.googleapis.com/calendar/v3 (a fixed host) — so
 * `serverFetch` is called with `ignoreSsrfValidation: true` + an inline justification, matching the
 * connector googleApi.ts SSRF posture. A non-2xx response is thrown as an Error with `.status`
 * stamped so the token retry envelope (withFreshToken) can react to a 401.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import type { ICalendarChangeSet, ICalendarEvent, ICalendarProviderImpl, IPushSubscriptionResult } from '../CalendarProvider';
import { GOOGLE_CALENDAR_BASE } from '../config';

/**
 * Google `events.watch` channel lifetime. Google caps calendar push channels at ~1 week (604,800s);
 * we ask for ~6.5 days and the renewal sweep re-creates before then (channels are NOT renewable in
 * place — renewal = stop the old channel + open a new one).
 */
const GOOGLE_CHANNEL_TTL_SECONDS = 6.5 * 24 * 60 * 60;

async function gfetch<T = any>(accessToken: string, url: string, init?: { method?: string; body?: unknown }): Promise<T> {
	const res = await fetch(url, {
		ignoreSsrfValidation: true, // www.googleapis.com — fixed Google host, not user input
		method: init?.method || 'GET',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/json',
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
		},
		...(init?.body ? { body: JSON.stringify(init.body) } : {}),
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok) {
		const message = json?.error?.message || res.statusText;
		const error = new Error(`google_calendar_error:${res.status}:${message}`);
		(error as any).status = res.status;
		throw error;
	}
	return json as T;
}

/** Map our ICalendarEvent to the Google events resource body. */
function toGoogleBody(event: ICalendarEvent): Record<string, unknown> {
	const descriptionParts = [event.description, event.sourceUrl].filter(Boolean);
	return {
		summary: event.title,
		...(descriptionParts.length ? { description: descriptionParts.join('\n\n') } : {}),
		start: { dateTime: event.start.toISOString() },
		end: { dateTime: event.end.toISOString() },
		...(event.sourceUrl ? { source: { title: 'Open in MatterChat Boards', url: event.sourceUrl } } : {}),
	};
}

/** Map a Google events resource back to our ICalendarEvent. */
function fromGoogle(item: any): ICalendarEvent {
	const startStr = item?.start?.dateTime || (item?.start?.date ? `${item.start.date}T00:00:00Z` : undefined);
	const endStr = item?.end?.dateTime || (item?.end?.date ? `${item.end.date}T00:00:00Z` : undefined);
	const start = startStr ? new Date(startStr) : new Date(0);
	const end = endStr ? new Date(endStr) : new Date(start.getTime() + 3600_000);
	return {
		externalEventId: item?.id,
		title: item?.summary || '(untitled)',
		description: item?.description,
		start,
		end,
		etag: item?.etag,
		updatedAt: item?.updated ? new Date(item.updated) : undefined,
		cancelled: item?.status === 'cancelled',
	};
}

export const googleCalendarProvider: ICalendarProviderImpl = {
	kind: 'google',

	async resolveDefaultCalendarId(): Promise<string> {
		// Google's per-user default calendar is always the literal 'primary'.
		return 'primary';
	},

	async createEvent(accessToken, calendarId, event) {
		const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
		const created = await gfetch(accessToken, url, { method: 'POST', body: toGoogleBody(event) });
		return fromGoogle(created);
	},

	async updateEvent(accessToken, calendarId, externalEventId, event) {
		const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`;
		const updated = await gfetch(accessToken, url, { method: 'PATCH', body: toGoogleBody(event) });
		return fromGoogle(updated);
	},

	async deleteEvent(accessToken, calendarId, externalEventId) {
		const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`;
		try {
			await gfetch(accessToken, url, { method: 'DELETE' });
		} catch (err) {
			// 404/410 → the event is already gone; treat delete as idempotent success.
			const status = (err as { status?: number })?.status;
			if (status === 404 || status === 410) {
				return;
			}
			throw err;
		}
	},

	async listChanges(accessToken, calendarId, cursor, windowStart): Promise<ICalendarChangeSet> {
		const base = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
		const events: ICalendarEvent[] = [];
		let pageToken: string | undefined;
		let nextSyncToken: string | undefined;

		for (let page = 0; page < 50; page++) {
			const url = new URL(base);
			url.searchParams.set('showDeleted', 'true');
			url.searchParams.set('singleEvents', 'true');
			url.searchParams.set('maxResults', '250');
			if (cursor) {
				url.searchParams.set('syncToken', cursor);
			} else {
				// First (full) sync: bound the lookback so we don't pull the user's whole history.
				url.searchParams.set('timeMin', windowStart.toISOString());
			}
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}

			let body: any;
			try {
				body = await gfetch(accessToken, url.toString());
			} catch (err) {
				// A 410 GONE means the syncToken expired — fall back to a full sync on the next poll.
				if ((err as { status?: number })?.status === 410) {
					return { events, nextCursor: undefined };
				}
				throw err;
			}

			for (const item of body.items || []) {
				events.push(fromGoogle(item));
			}
			nextSyncToken = body.nextSyncToken || nextSyncToken;
			pageToken = body.nextPageToken;
			if (!pageToken) {
				break;
			}
		}

		return { events, nextCursor: nextSyncToken };
	},

	async createPushSubscription(accessToken, calendarId, params): Promise<IPushSubscriptionResult> {
		// POST /calendars/{id}/events/watch — open a web_hook channel. `id` is OUR client-supplied UUID
		// (echoed as X-Goog-Channel-ID); `token` is our HMAC channel token (echoed as X-Goog-Channel-Token);
		// `params.ttl` bounds the channel lifetime. Google returns `resourceId` — needed to stop it later.
		const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`;
		const res = await gfetch<{ resourceId?: string; expiration?: string }>(accessToken, url, {
			method: 'POST',
			body: {
				id: params.subscriptionId,
				type: 'web_hook',
				address: params.notificationUrl,
				token: params.channelToken,
				params: { ttl: String(Math.floor(GOOGLE_CHANNEL_TTL_SECONDS)) },
			},
		});
		// `expiration` is epoch MILLISECONDS as a string; fall back to our requested TTL if absent.
		const expiresAt = res?.expiration
			? new Date(Number(res.expiration))
			: new Date(Date.now() + GOOGLE_CHANNEL_TTL_SECONDS * 1000);
		return { subscriptionId: params.subscriptionId, ...(res?.resourceId ? { resourceId: res.resourceId } : {}), expiresAt };
	},

	async renewPushSubscription(accessToken, calendarId, current, params): Promise<IPushSubscriptionResult> {
		// Google channels can't be extended in place → stop the old one (best-effort) and open a fresh
		// channel (the caller supplies a NEW subscriptionId in params so ids don't collide).
		if (current.resourceId) {
			try {
				await this.deletePushSubscription(accessToken, current);
			} catch {
				// old channel may already be gone/expired — proceed to open the new one regardless
			}
		}
		return this.createPushSubscription(accessToken, calendarId, params);
	},

	async deletePushSubscription(accessToken, current): Promise<void> {
		// POST /channels/stop — requires BOTH the channel id and the opaque resourceId.
		if (!current.resourceId) {
			return; // nothing addressable to stop
		}
		const url = `${GOOGLE_CALENDAR_BASE}/channels/stop`;
		try {
			await gfetch(accessToken, url, { method: 'POST', body: { id: current.subscriptionId, resourceId: current.resourceId } });
		} catch (err) {
			const status = (err as { status?: number })?.status;
			if (status === 404 || status === 410) {
				return; // already gone — idempotent
			}
			throw err;
		}
	},
};
