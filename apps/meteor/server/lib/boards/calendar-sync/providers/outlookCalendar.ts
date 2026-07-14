/**
 * Outlook / Microsoft Graph Calendar provider. Clean-room from the public Microsoft Graph docs;
 * nothing under apps/meteor/ee/ was read. Talks ONLY to graph.microsoft.com (a fixed host) — so
 * `serverFetch` is called with `ignoreSsrfValidation: true` + an inline justification, matching the
 * Teams connector graphClient SSRF posture. A non-2xx response is thrown with `.status` stamped so
 * the token retry envelope (withFreshToken) can react to a 401.
 *
 * Inbound uses the Graph delta query on /me/calendars/{id}/events; the `@odata.deltaLink` is the
 * cursor stored on the connection. Reuses the Teams Entra app's OAuth machinery (different scope set).
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import type { ICalendarChangeSet, ICalendarEvent, ICalendarProviderImpl, IPushSubscriptionResult } from '../CalendarProvider';
import { GRAPH_BASE } from '../config';

/**
 * Graph subscription lifetime for `/me/events`. Graph caps event subscriptions at 4,230 minutes
 * (~2.94 days); we ask for ~2.8 days and the renewal sweep PATCHes the expiry before then.
 */
const GRAPH_SUBSCRIPTION_LIFETIME_MS = 4030 * 60 * 1000;

async function gfetch<T = any>(
	accessToken: string,
	url: string,
	init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
	const res = await fetch(url, {
		ignoreSsrfValidation: true, // graph.microsoft.com — fixed Microsoft host, not user input
		method: init?.method || 'GET',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/json',
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
			...(init?.headers || {}),
		},
		...(init?.body ? { body: JSON.stringify(init.body) } : {}),
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok) {
		const message = json?.error?.message || res.statusText;
		const error = new Error(`outlook_calendar_error:${res.status}:${message}`);
		(error as any).status = res.status;
		throw error;
	}
	return json as T;
}

/** Map our ICalendarEvent to a Graph event resource body. */
function toGraphBody(event: ICalendarEvent): Record<string, unknown> {
	const bodyParts = [event.description, event.sourceUrl ? `Open in MatterChat Boards: ${event.sourceUrl}` : undefined].filter(Boolean);
	return {
		subject: event.title,
		body: { contentType: 'text', content: bodyParts.join('\n\n') },
		start: { dateTime: event.start.toISOString(), timeZone: 'UTC' },
		end: { dateTime: event.end.toISOString(), timeZone: 'UTC' },
	};
}

/** Parse a Graph dateTime object (dateTime + timeZone) to a JS Date (Graph gives UTC when asked). */
function graphDate(dt: any, fallback: Date): Date {
	const s = dt?.dateTime;
	if (!s) {
		return fallback;
	}
	// Graph omits the trailing Z; our start/end are requested in UTC, so append it if absent.
	const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Map a Graph event resource back to our ICalendarEvent. */
function fromGraph(item: any): ICalendarEvent {
	const start = graphDate(item?.start, new Date(0));
	const end = graphDate(item?.end, new Date(start.getTime() + 3600_000));
	return {
		externalEventId: item?.id,
		title: item?.subject || '(untitled)',
		description: item?.body?.content,
		start,
		end,
		etag: item?.['@odata.etag'],
		updatedAt: item?.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : undefined,
		// A delta payload marks a removed event with @removed; a normal event is cancelled via isCancelled.
		cancelled: Boolean(item?.['@removed']) || item?.isCancelled === true,
	};
}

export const outlookCalendarProvider: ICalendarProviderImpl = {
	kind: 'outlook',

	async resolveDefaultCalendarId(accessToken): Promise<string> {
		const cal = await gfetch(accessToken, `${GRAPH_BASE}/me/calendar?$select=id`);
		return cal?.id || 'primary';
	},

	async createEvent(accessToken, calendarId, event) {
		const url = `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`;
		const created = await gfetch(accessToken, url, { method: 'POST', body: toGraphBody(event) });
		return fromGraph(created);
	},

	async updateEvent(accessToken, _calendarId, externalEventId, event) {
		// Graph events are addressable directly by id under /me/events regardless of calendar.
		const url = `${GRAPH_BASE}/me/events/${encodeURIComponent(externalEventId)}`;
		const updated = await gfetch(accessToken, url, { method: 'PATCH', body: toGraphBody(event) });
		return fromGraph(updated);
	},

	async deleteEvent(accessToken, _calendarId, externalEventId) {
		const url = `${GRAPH_BASE}/me/events/${encodeURIComponent(externalEventId)}`;
		try {
			await gfetch(accessToken, url, { method: 'DELETE' });
		} catch (err) {
			const status = (err as { status?: number })?.status;
			if (status === 404 || status === 410) {
				return; // already gone — idempotent
			}
			throw err;
		}
	},

	async listChanges(accessToken, calendarId, cursor, windowStart): Promise<ICalendarChangeSet> {
		const events: ICalendarEvent[] = [];
		// Resume from the stored deltaLink, or start a fresh delta bounded by the window.
		let next: string | undefined = cursor;
		if (!next) {
			const start = new URL(`${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events/delta`);
			// A calendar-view-style bound: Graph's events delta doesn't take timeMin, so use the
			// calendarView delta which honors start/end query params for the initial window.
			start.pathname = start.pathname.replace('/events/delta', '/calendarView/delta');
			start.searchParams.set('startDateTime', windowStart.toISOString());
			start.searchParams.set('endDateTime', new Date(windowStart.getTime() + 400 * 24 * 3600_000).toISOString());
			next = start.toString();
		}

		let deltaLink: string | undefined;
		for (let page = 0; page < 50 && next; page++) {
			const body: any = await gfetch(accessToken, next, { headers: { Prefer: 'odata.maxpagesize=200' } });
			for (const item of body.value || []) {
				events.push(fromGraph(item));
			}
			if (body['@odata.nextLink']) {
				next = body['@odata.nextLink'];
			} else {
				deltaLink = body['@odata.deltaLink'];
				next = undefined;
			}
		}

		return { events, nextCursor: deltaLink };
	},

	async createPushSubscription(accessToken, _calendarId, params): Promise<IPushSubscriptionResult> {
		// POST /subscriptions on the user's events. Graph MINTS the subscription id (we ignore the
		// client-supplied one) and echoes our `clientState` (the HMAC channel token) on each notification.
		// changeType covers create/update/delete so a moved OR cancelled event reconciles.
		const created = await gfetch<{ id?: string; expirationDateTime?: string }>(accessToken, `${GRAPH_BASE}/subscriptions`, {
			method: 'POST',
			body: {
				changeType: 'created,updated,deleted',
				notificationUrl: params.notificationUrl,
				resource: '/me/events',
				clientState: params.channelToken,
				includeResourceData: false,
				expirationDateTime: new Date(Date.now() + GRAPH_SUBSCRIPTION_LIFETIME_MS).toISOString(),
			},
		});
		if (!created?.id) {
			throw new Error('outlook_calendar_subscription_no_id');
		}
		const expiresAt = created.expirationDateTime
			? new Date(created.expirationDateTime)
			: new Date(Date.now() + GRAPH_SUBSCRIPTION_LIFETIME_MS);
		return { subscriptionId: created.id, expiresAt };
	},

	async renewPushSubscription(accessToken, _calendarId, current, _params): Promise<IPushSubscriptionResult> {
		// Graph renews IN PLACE: PATCH a new expirationDateTime. Keeps the same subscription id.
		const expirationDateTime = new Date(Date.now() + GRAPH_SUBSCRIPTION_LIFETIME_MS).toISOString();
		const renewed = await gfetch<{ expirationDateTime?: string }>(
			accessToken,
			`${GRAPH_BASE}/subscriptions/${encodeURIComponent(current.subscriptionId)}`,
			{ method: 'PATCH', body: { expirationDateTime } },
		);
		return {
			subscriptionId: current.subscriptionId,
			expiresAt: renewed?.expirationDateTime ? new Date(renewed.expirationDateTime) : new Date(expirationDateTime),
		};
	},

	async deletePushSubscription(accessToken, current): Promise<void> {
		const url = `${GRAPH_BASE}/subscriptions/${encodeURIComponent(current.subscriptionId)}`;
		try {
			await gfetch(accessToken, url, { method: 'DELETE' });
		} catch (err) {
			const status = (err as { status?: number })?.status;
			if (status === 404 || status === 410) {
				return; // already gone — idempotent
			}
			throw err;
		}
	},
};
