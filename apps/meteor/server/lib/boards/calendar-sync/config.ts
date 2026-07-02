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

import { settings } from '../../../../app/settings/server';

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

// ─── OAuth redirect URIs (must match the registered app EXACTLY) ──────────────────────────────────
// NOT under /api — Rocket.Chat's REST/Apps router owns /api/* and 404s custom routes there (mirrors
// the connector /_google + /_teams routes). Built from the instance Site_Url so prod/staging/dev each
// produce their own registered URI.
export const GOOGLE_REDIRECT_PATH = '_boards_calendar/google/oauth/callback';
export const OUTLOOK_REDIRECT_PATH = '_boards_calendar/outlook/oauth/callback';
export const googleRedirectUri = (): string => Meteor.absoluteUrl(GOOGLE_REDIRECT_PATH);
export const outlookRedirectUri = (): string => Meteor.absoluteUrl(OUTLOOK_REDIRECT_PATH);
