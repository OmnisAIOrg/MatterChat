import { settingsRegistry } from '.';

/**
 * Settings for Boards two-way calendar sync (Google Calendar + Outlook/Graph Calendar) and
 * email-to-task (Phase 3). Per-user delegated OAuth: each MatterChat user connects their OWN Google
 * and/or Outlook calendar and their due-dated cards mirror into it (outbound), and calendar changes
 * reflect back onto card due dates (inbound). Mirrors server/settings/google.ts + teams.ts.
 *
 * STANDALONE-SAFE / DARK BY DEFAULT: everything is OFF by default. With the master switches false (the
 * default) or no client secret configured, the connect route refuses to start, the sync jobs no-op,
 * and the connect UI shows "not configured" — a fresh MatterChat has ZERO calendar/email traffic
 * until an admin opts in AND pastes a client secret.
 *
 * OAuth app provenance:
 *  - Google Calendar: a Google Cloud OAuth 2.0 client (Web app). MAY be the SAME client id as the
 *    Google Chat connector's (GoogleChat_OAuth_Client_Id) if the calendar scopes are added to that
 *    consent screen, but is configured independently here so a firm can use a dedicated app. The
 *    Authorized redirect URI MUST be exactly `<site>/_boards_calendar/google/oauth/callback`.
 *  - Outlook/Graph: an Entra app registration. The Teams connector's app (Teams_OAuth_Client_Id) can
 *    be REUSED — add the `Calendars.ReadWrite` delegated permission and register the redirect URI
 *    `<site>/_boards_calendar/outlook/oauth/callback`. Configured independently here so a firm can use
 *    a separate app if it prefers.
 *
 * Token encryption REUSES the connector scheme (EXTERNAL_TOKEN_ENC_KEY / tokenCrypto) — no new key.
 */
export const createBoardsCalendarSyncSettings = () =>
	settingsRegistry.addGroup('Boards_Calendar_Sync', async function () {
		// Master switch for two-way calendar sync. Gates BOTH connect routes + BOTH sync jobs.
		await this.add('Boards_Calendar_Sync_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Boards_Calendar_Sync_Enabled',
			i18nDescription: 'Boards_Calendar_Sync_Enabled_Description',
		});

		// Master switch for email-to-task. Gates the inbound mail webhook receiver.
		await this.add('Boards_Email_To_Task_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Boards_Email_To_Task_Enabled',
			i18nDescription: 'Boards_Email_To_Task_Enabled_Description',
		});

		// ─── Google Calendar OAuth ─────────────────────────────────────────────────────────────────
		// Client ID — NOT a secret. Empty default (a firm pastes its Google Cloud OAuth client id, or
		// reuses the Google Chat connector's). No default id here to avoid implying the chat app's
		// consent screen carries the calendar scopes.
		await this.add('Boards_Calendar_Google_Client_Id', '', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Boards_Calendar_Sync_Enabled', value: true },
			i18nLabel: 'Boards_Calendar_Google_Client_Id',
			i18nDescription: 'Boards_Calendar_Google_Client_Id_Description',
		});
		// Client secret — MASKED + secret. Empty default; a firm pastes it in admin.
		await this.add('Boards_Calendar_Google_Client_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			enableQuery: { _id: 'Boards_Calendar_Sync_Enabled', value: true },
			i18nLabel: 'Boards_Calendar_Google_Client_Secret',
			i18nDescription: 'Boards_Calendar_Google_Client_Secret_Description',
		});

		// ─── Outlook / Microsoft Graph Calendar OAuth ──────────────────────────────────────────────
		// Client ID — NOT a secret. Empty default (a firm pastes its Entra app id, or reuses the Teams
		// connector's app id after adding Calendars.ReadWrite).
		await this.add('Boards_Calendar_Outlook_Client_Id', '', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Boards_Calendar_Sync_Enabled', value: true },
			i18nLabel: 'Boards_Calendar_Outlook_Client_Id',
			i18nDescription: 'Boards_Calendar_Outlook_Client_Id_Description',
		});
		// Client secret — MASKED + secret. Empty default; a firm pastes it in admin.
		await this.add('Boards_Calendar_Outlook_Client_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			enableQuery: { _id: 'Boards_Calendar_Sync_Enabled', value: true },
			i18nLabel: 'Boards_Calendar_Outlook_Client_Secret',
			i18nDescription: 'Boards_Calendar_Outlook_Client_Secret_Description',
		});
		// Entra authority. Default the multi-tenant "common" endpoint so any Microsoft account can
		// connect a personal or work calendar. A firm may pin its own tenant.
		await this.add('Boards_Calendar_Outlook_Authority', 'https://login.microsoftonline.com/common', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Boards_Calendar_Sync_Enabled', value: true },
			i18nLabel: 'Boards_Calendar_Outlook_Authority',
			i18nDescription: 'Boards_Calendar_Outlook_Authority_Description',
		});

		// Real-time PUSH (webhook) subscriptions: the PUBLIC https base URL Google/Microsoft must reach
		// to deliver change notifications. Empty default falls back to env BOARDS_CALENDAR_PUSH_PUBLIC_BASE_URL,
		// then Site_Url. Push is a best-effort ENHANCEMENT over the 15-min poll: it only activates when
		// this resolves to an https URL AND the deploy sets the env secret BOARDS_CALENDAR_PUSH_SECRET
		// (env-only, never a setting - it authenticates an unauthenticated public endpoint). Else poll-only.
		await this.add('Boards_Calendar_Push_Public_Base_Url', '', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Boards_Calendar_Sync_Enabled', value: true },
			i18nLabel: 'Boards_Calendar_Push_Public_Base_Url',
			i18nDescription: 'Boards_Calendar_Push_Public_Base_Url_Description',
		});

		// ─── Email-to-task ─────────────────────────────────────────────────────────────────────────
		// Shared secret the mail provider (SES inbound / a forwarding webhook) signs POSTs with. Empty
		// default → the receiver is FAIL-CLOSED (drops every request) until a firm sets it. Env-var
		// fallback BOARDS_EMAIL_WEBHOOK_SECRET is preferred over this setting for the secret at rest.
		await this.add('Boards_Email_To_Task_Webhook_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			enableQuery: { _id: 'Boards_Email_To_Task_Enabled', value: true },
			i18nLabel: 'Boards_Email_To_Task_Webhook_Secret',
			i18nDescription: 'Boards_Email_To_Task_Webhook_Secret_Description',
		});
	});
