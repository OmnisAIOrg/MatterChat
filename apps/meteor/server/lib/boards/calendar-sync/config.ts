/**
 * Boards calendar-sync configuration — read from admin settings ONLY (with an env fallback for the
 * email webhook secret). Nothing is hardcoded except the fixed Google/Microsoft API hosts + the OAuth
 * path segments. Mirrors apps/meteor/app/connectors/server/providers/{google,teams}/config.ts.
 *
 * STANDALONE-SAFE / DARK BY DEFAULT: `isCalendarSyncEnabled()` gates the master switch; the per-provider
 * `isGoogleCalendarConfigured()` / `isOutlookCalendarConfigured()` additionally require a client id +
 * secret. When false, the connect route refuses and the sync jobs no-op — zero external traffic.
 */
import type { CalendarProvider } from '@rocket.chat/core-typings';
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../settings';

// ─── Google Calendar ─────────────────────────────────────────────────────────────────────────────

/** Google OAuth 2.0 authorize + token endpoints (fixed Google hosts, not user input). */
export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** Google Calendar API v3 base (the only Calendar host the provider talks to). */
export const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Delegated OAuth scopes. `calendar.events` grants read+write of the user's events (create/update/
 * delete the mirror events + read changes); `openid email` gives the id_token (account email/label).
 * DELEGATED (act as the signed-in user), not a service account.
 */
export const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'];

export function getGoogleCalendarConfig(): { clientId: string; clientSecret: string } {
	return {
		clientId: String(settings.get('Boards_Calendar_Google_Client_Id') || '').trim(),
		clientSecret: String(settings.get('Boards_Calendar_Google_Client_Secret') || '').trim(),
	};
}

// ─── Outlook / Microsoft Graph Calendar ──────────────────────────────────────────────────────────

/** Microsoft Graph v1.0 base (the only Graph host the provider talks to). */
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Delegated OAuth scopes. `Calendars.ReadWrite` grants read+write of the user's calendars/events;
 * `offline_access` returns a refresh token; `openid email` gives the id_token (account email/label).
 */
export const OUTLOOK_CALENDAR_SCOPES = ['https://graph.microsoft.com/Calendars.ReadWrite', 'offline_access', 'openid', 'email'];

export function getOutlookCalendarConfig(): { clientId: string; clientSecret: string; authority: string } {
	const authority = String(settings.get('Boards_Calendar_Outlook_Authority') || 'https://login.microsoftonline.com/common').trim();
	return {
		clientId: String(settings.get('Boards_Calendar_Outlook_Client_Id') || '').trim(),
		clientSecret: String(settings.get('Boards_Calendar_Outlook_Client_Secret') || '').trim(),
		// Strip any trailing slash so `${authority}/oauth2/v2.0/...` is always well-formed.
		authority: authority.replace(/\/+$/, ''),
	};
}

export const outlookAuthorizeEndpoint = (): string => `${getOutlookCalendarConfig().authority}/oauth2/v2.0/authorize`;
export const outlookTokenEndpoint = (): string => `${getOutlookCalendarConfig().authority}/oauth2/v2.0/token`;

// ─── gates ───────────────────────────────────────────────────────────────────────────────────────

/** Master switch for two-way calendar sync (both providers + both jobs). Off by default. */
export function isCalendarSyncEnabled(): boolean {
	return Boolean(settings.get('Boards_Calendar_Sync_Enabled'));
}

/** Master switch for email-to-task. Off by default. */
export function isEmailToTaskEnabled(): boolean {
	return Boolean(settings.get('Boards_Email_To_Task_Enabled'));
}

/** STANDALONE-SAFE GATE (Google): enabled AND client id + secret present. */
export function isGoogleCalendarConfigured(): boolean {
	if (!isCalendarSyncEnabled()) {
		return false;
	}
	const c = getGoogleCalendarConfig();
	return Boolean(c.clientId) && Boolean(c.clientSecret);
}

/** STANDALONE-SAFE GATE (Outlook): enabled AND client id + secret present. */
export function isOutlookCalendarConfigured(): boolean {
	if (!isCalendarSyncEnabled()) {
		return false;
	}
	const c = getOutlookCalendarConfig();
	return Boolean(c.clientId) && Boolean(c.clientSecret);
}

/** Whichever provider is asked about — the standalone-safe gate. */
export function isProviderConfigured(provider: CalendarProvider): boolean {
	return provider === 'google' ? isGoogleCalendarConfigured() : isOutlookCalendarConfigured();
}

/**
 * The email-to-task webhook secret. Preferred from env (BOARDS_EMAIL_WEBHOOK_SECRET) so it never lives
 * in Mongo; falls back to the masked admin setting. Empty ⇒ the receiver is FAIL-CLOSED (drops all).
 */
export function getEmailWebhookSecret(): string {
	const env = (process.env.BOARDS_EMAIL_WEBHOOK_SECRET || '').trim();
	if (env) {
		return env;
	}
	return String(settings.get('Boards_Email_To_Task_Webhook_Secret') || '').trim();
}

// ─── Real-time PUSH (webhook) subscriptions — the parity follow-up to the 15-min inbound POLL ──────
// Mounted OUTSIDE /api (same reason as the OAuth routes). Google POSTs events.watch notifications and
// Graph POSTs /subscriptions change-notifications to a per-provider path under this prefix.

export const PUSH_ROUTE_PREFIX = '/_boards_calendar/push';
export const googlePushPath = (): string => `${PUSH_ROUTE_PREFIX}/google`;
export const outlookPushPath = (): string => `${PUSH_ROUTE_PREFIX}/outlook`;

/**
 * The PUBLIC base URL Google/Microsoft must be able to reach to deliver notifications (validation
 * handshake + change POSTs). Mirrors the Teams connector: admin setting first, env fallback, then the
 * instance Site_Url — a deploy behind an ingress alias sets one of the first two. HTTPS is required by
 * both providers for a webhook receiver; a non-https base means push simply won't be created.
 *
 *   Boards_Calendar_Push_Public_Base_Url  ||  BOARDS_CALENDAR_PUSH_PUBLIC_BASE_URL  ||  Site_Url
 */
export function pushPublicBaseUrl(): string {
	const fromSetting = String(settings.get('Boards_Calendar_Push_Public_Base_Url') || '').trim();
	const fromEnv = String(process.env.BOARDS_CALENDAR_PUSH_PUBLIC_BASE_URL || '').trim();
	const base = fromSetting || fromEnv || Meteor.absoluteUrl();
	return base.replace(/\/+$/, '');
}

/** Absolute HTTPS URL Google/Graph POST notifications to, per provider. */
export const googlePushNotificationUrl = (): string => `${pushPublicBaseUrl()}${googlePushPath()}`;
export const outlookPushNotificationUrl = (): string => `${pushPublicBaseUrl()}${outlookPushPath()}`;

/**
 * The deploy-level secret that keys the per-subscription channel-token / clientState HMAC. ENV ONLY —
 * never a committed default, never an admin setting (it authenticates an UNAUTHENTICATED public
 * endpoint, so it stays out of Mongo — same posture as TEAMS_WEBHOOK_CLIENT_STATE_SECRET). Empty ⇒
 * the receiver is FAIL-CLOSED (drops every notification) AND no subscription is ever created, so the
 * system silently keeps polling as the fallback.
 */
export function getCalendarPushSecret(): string {
	return String(process.env.BOARDS_CALENDAR_PUSH_SECRET || '').trim();
}

/**
 * FAIL-CLOSED push gate for a provider: the provider must be configured (enabled + client id/secret)
 * AND the push secret set AND the public base URL be https. Without ALL THREE, NO subscription is
 * created and NO webhook payload is processed — the connection simply stays on the poll. Best-effort
 * enhancement, never required.
 */
export function isCalendarPushConfigured(provider: CalendarProvider): boolean {
	if (!isProviderConfigured(provider) || !getCalendarPushSecret()) {
		return false;
	}
	return pushPublicBaseUrl().startsWith('https://');
}

// ─── OAuth redirect URIs (must match the registered app EXACTLY) ──────────────────────────────────
// NOT under /api — Rocket.Chat's REST/Apps router owns /api/* and 404s custom routes there (mirrors
// the connector /_google + /_teams routes). Built from the instance Site_Url so prod/staging/dev each
// produce their own registered URI.
export const GOOGLE_REDIRECT_PATH = '_boards_calendar/google/oauth/callback';
export const OUTLOOK_REDIRECT_PATH = '_boards_calendar/outlook/oauth/callback';
export const googleRedirectUri = (): string => Meteor.absoluteUrl(GOOGLE_REDIRECT_PATH);
export const outlookRedirectUri = (): string => Meteor.absoluteUrl(OUTLOOK_REDIRECT_PATH);
