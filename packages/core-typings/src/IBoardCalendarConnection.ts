import type { IEncryptedTokenRef } from './IExternalWorkspaceConnection';
import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Calendar providers Boards can two-way sync a user's due-dated cards with. Extend this union (and
 * register a matching provider in the server-side calendarProviderRegistry) to add one — callers must
 * NEVER branch on the value; they go through the registry + CalendarProvider interface. Kept SEPARATE
 * from the chat `ExternalProvider` union so the chat connectors and calendar sync stay decoupled.
 *
 * - `google`  — Google Calendar (Calendar API v3), delegated OAuth, per-user.
 * - `outlook` — Microsoft Outlook / Graph Calendar, delegated OAuth, per-user. Reuses the Teams
 *               Entra app's OAuth machinery (a different Graph scope set: Calendars.ReadWrite).
 */
export type CalendarProvider = 'google' | 'outlook';

/**
 * Lifecycle status of a per-user Boards calendar connection. Mirrors
 * ExternalWorkspaceConnectionStatus so the UI can render both stores identically.
 *
 * - `connected`    — credentials valid; outbound push + inbound reconcile run.
 * - `error`        — credentials present but failing (refresh-token death); needs reconnect.
 * - `disconnected` — the user (or we) tore it down; kept for history/audit.
 */
export type BoardCalendarConnectionStatus = 'connected' | 'error' | 'disconnected';

/**
 * PER-USER Boards calendar connection. One document per (MatterChat user, provider) — a user connects
 * ONE Google and/or ONE Outlook calendar. This is the durable store the outbound push reads to know
 * whose calendar to mirror a due card into, and the inbound poll reads to fetch event changes.
 *
 * Collection: `boards_calendar_connections`. Indexed by `{ userId, provider }`.
 *
 * Token handling is IDENTICAL to the chat connectors: raw OAuth tokens are NEVER stored in plaintext —
 * `credentials` is an IEncryptedTokenRef produced by the SAME AES-256-GCM `tokenCrypto` helper
 * (env key `EXTERNAL_TOKEN_ENC_KEY`). No new crypto is introduced.
 */
export interface IBoardCalendarConnection extends IRocketChatRecord {
	/** The MatterChat (Rocket.Chat) user that owns this connection. */
	userId: IUser['_id'];
	/** Which calendar provider this connection targets. */
	provider: CalendarProvider;
	/** The connected account's email (from the id_token) — for the settings tile label. */
	accountEmail?: string;
	/** Current lifecycle status. */
	status: BoardCalendarConnectionStatus;
	/** OAuth scopes actually granted (empty until consent completes). */
	scopes: string[];
	/**
	 * Encrypted credential reference (access + refresh token + expiry). Optional because a freshly
	 * created record may exist before a token is obtained.
	 */
	credentials?: IEncryptedTokenRef;
	/**
	 * The calendar id we write mirror events into. Google: 'primary' (default). Outlook: the default
	 * calendar id resolved at connect time. Admin/user can override later (not in this milestone).
	 */
	targetCalendarId: string;
	/**
	 * OPT-IN inbound "create a card from a new calendar event" — the board a brand-new calendar event
	 * (one we did not create) is turned into a card on. Absent = inbound only updates due dates of cards
	 * we already mirror; it never creates cards. This is the designated-board opt-in.
	 */
	inboundBoardId?: string;
	/** The list on `inboundBoardId` new-event cards land in (defaults to the board's first list). */
	inboundListId?: string;
	/**
	 * Inbound sync cursor. Google: the `syncToken` from the last events.list (incremental sync). Graph:
	 * the `@odata.deltaLink` from the last delta call. Absent = do a full window sync next poll.
	 */
	syncCursor?: string;
	/** When the connection record was first created. */
	createdAt: Date;
	/** Last successful outbound push against the calendar, if any. */
	lastPushAt?: Date;
	/** Last successful inbound reconcile against the calendar, if any. */
	lastPollAt?: Date;
}
