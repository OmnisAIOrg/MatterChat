/**
 * CasePro case-update webhook receiver — configuration.
 *
 * Mounted OUTSIDE /api (RC's REST/Apps router owns `/api/*` and 404s custom connect-handlers —
 * mirrors the `/_connectors/teams` / `/_teams/oauth` mounting precedent).
 *
 * The shared secret is ENV ONLY — never a committed default, never an admin setting (it
 * authenticates an UNAUTHENTICATED public endpoint, so it stays out of Mongo). Mirrors
 * `TEAMS_WEBHOOK_CLIENT_STATE_SECRET` in app/connectors/server/providers/teams/config.ts.
 *
 * FAIL-CLOSED: with no secret configured nothing verifies, so no webhook payload is ever
 * processed — the endpoint still answers 202 (drop) so a probe learns nothing.
 *
 * This module is deliberately Meteor-free (env only) so it can be imported from anywhere.
 */

/** Route prefix declared to RoutePolicy so Meteor leaves `/_casepro/*` to our connect handler. */
export const CASEPRO_ROUTE_PREFIX = '/_casepro';

/** POST target CasePro delivers case-update events to. */
export const CASEPRO_WEBHOOK_PATH = `${CASEPRO_ROUTE_PREFIX}/webhook`;

/** Signature header: `X-CasePro-Signature: sha256=<hex HMAC-SHA256 of the RAW request body>`. */
export const CASEPRO_SIGNATURE_HEADER = 'x-casepro-signature';

/** The deploy-level shared secret that keys the request-body HMAC. Empty string when unset. */
export function caseproWebhookSecret(): string {
	return String(process.env.CASEPRO_WEBHOOK_SECRET || '').trim();
}
