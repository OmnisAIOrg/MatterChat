/**
 * Provider-agnostic interface for a two-way calendar sync provider (Google Calendar / Outlook Graph).
 * Mirrors the connector's ChatProvider pattern: callers go through the registry + this interface and
 * NEVER branch on the provider value. Each method takes a live access token (obtained + refreshed by
 * tokens.ts) plus the connection so the provider can read its target calendar id.
 */
import type { IBoardCalendarConnection } from '@rocket.chat/core-typings';

/** A calendar event as this subsystem models it — the provider maps to/from its native shape. */
export interface ICalendarEvent {
	/** Provider-native event id (absent when we're about to create one). */
	externalEventId?: string;
	/** Human title. */
	title: string;
	/** Optional longer text. */
	description?: string;
	/** Event start (a point-in-time deadline). */
	start: Date;
	/** Event end (we render a due date as a 1-hour block). */
	end: Date;
	/** A URL back to the source card, put in the event body/link. */
	sourceUrl?: string;
	/** Provider ETag / changeKey (inbound change detection). */
	etag?: string;
	/** Provider-reported last-modified time (inbound change detection). */
	updatedAt?: Date;
	/** True when the provider marked this event cancelled/deleted (inbound). */
	cancelled?: boolean;
}

/** Result of an inbound incremental fetch: the changed events + the cursor to resume from next time. */
export interface ICalendarChangeSet {
	events: ICalendarEvent[];
	/** The next sync cursor (Google syncToken / Graph deltaLink). Undefined ⇒ do a full sync next time. */
	nextCursor?: string;
}

export interface ICalendarProviderImpl {
	/** Which provider this implements. */
	readonly kind: IBoardCalendarConnection['provider'];

	/** Resolve the account's default/target calendar id at connect time (Google: 'primary'). */
	resolveDefaultCalendarId(accessToken: string): Promise<string>;

	/** Create a mirror event; returns the new event's id + change markers. */
	createEvent(accessToken: string, calendarId: string, event: ICalendarEvent): Promise<ICalendarEvent>;

	/** Update an existing mirror event by id. */
	updateEvent(accessToken: string, calendarId: string, externalEventId: string, event: ICalendarEvent): Promise<ICalendarEvent>;

	/** Delete a mirror event by id (idempotent — a 404/410 is treated as already-gone). */
	deleteEvent(accessToken: string, calendarId: string, externalEventId: string): Promise<void>;

	/**
	 * Incrementally fetch changed events since `cursor` (or a full window when absent). `windowStart`
	 * bounds the full-sync lookback so a first sync doesn't pull the user's entire history.
	 */
	listChanges(accessToken: string, calendarId: string, cursor: string | undefined, windowStart: Date): Promise<ICalendarChangeSet>;
}
