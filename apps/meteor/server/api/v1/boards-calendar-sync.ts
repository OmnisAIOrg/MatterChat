import type { CalendarProvider } from '@rocket.chat/core-typings';
import { BoardCalendarConnections } from '@rocket.chat/models';
import { ajv, validateBadRequestErrorResponse, validateUnauthorizedErrorResponse } from '@rocket.chat/rest-typings';

import { getCaseProBridgeForUser, isCaseProCalendarActive } from '../../lib/boards/calendar-sync/caseproBridge';
import { pollCasePro, pushUserCardsThroughCasePro } from '../../lib/boards/calendar-sync/caseproSync';
import { isCalendarSyncEnabled, isProviderConfigured } from '../../lib/boards/calendar-sync/config';
import { teardownPushSubscription } from '../../lib/boards/calendar-sync/pushSubscriptions';
import { buildAuthorizeUrl } from '../../lib/boards/calendar-sync/routes';
import { pollConnection, pushUserCards, teardownConnectionMirrors } from '../../lib/boards/calendar-sync/service';
import { API } from '../api';

/**
 * REST surface for Boards two-way calendar sync (per-user connect / list / disconnect / sync-now).
 * All endpoints are authenticated and scoped to the caller's OWN connection — a user manages only
 * their own calendar link. Credential blobs are NEVER returned (stripped in toClient below).
 *
 * GATED: when Boards_Calendar_Sync_Enabled is off, list returns { enabled:false } and connect/sync
 * refuse — no external traffic. Schemas are compiled inline (this is a NEW module, so no
 * rest-typings dist rebuild is required; only the shared `ajv` compile helper is imported).
 */

const successSchema = ajv.compile({ type: 'object', additionalProperties: true });

const isProviderBody = ajv.compile({
	type: 'object',
	properties: { provider: { type: 'string', enum: ['google', 'outlook'] } },
	required: ['provider'],
	additionalProperties: false,
});

const isConnectionIdBody = ajv.compile({
	type: 'object',
	properties: { connectionId: { type: 'string', minLength: 1 } },
	required: ['connectionId'],
	additionalProperties: false,
});

/** Client-safe projection — everything EXCEPT the encrypted credential blob and sync cursor. */
function toClient(doc: any) {
	const { credentials, syncCursor, _updatedAt, ...safe } = doc;
	return safe;
}

// GET boards.calendar.connections — the caller's calendar connections + whether each provider is set up.
API.v1.get(
	'boards.calendar.connections',
	{ authRequired: true, response: { 200: successSchema, 401: validateUnauthorizedErrorResponse } },
	async function action() {
		const enabled = isCalendarSyncEnabled();
		if (!enabled) {
			return API.v1.success({ enabled: false, providers: {}, connections: [] });
		}
		const docs = await BoardCalendarConnections.findByUserId(this.userId).toArray();
		// Is CasePro this user's PREFERRED calendar source (enabled + linked + connected in CasePro)?
		// When so, the UI shows "connected via CasePro" and hides the redundant provider connect buttons —
		// the user already authorized their calendar once, in CasePro. Best-effort: a failure just falls
		// back to the standalone view.
		let casepro: { active: boolean; connected: boolean } = { active: isCaseProCalendarActive(), connected: false };
		try {
			if (casepro.active) {
				const bridge = await getCaseProBridgeForUser(this.userId);
				casepro = { active: true, connected: Boolean(bridge) };
			}
		} catch {
			// keep casepro.connected = false
		}
		return API.v1.success({
			enabled: true,
			casepro,
			providers: {
				google: { configured: isProviderConfigured('google') },
				outlook: { configured: isProviderConfigured('outlook') },
			},
			connections: docs.map(toClient),
		});
	},
);

// POST boards.calendar.connect — get the OAuth start URL for a provider (client navigates to it).
API.v1.post(
	'boards.calendar.connect',
	{
		authRequired: true,
		body: isProviderBody,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { provider } = this.bodyParams as { provider: CalendarProvider };
		if (!isCalendarSyncEnabled() || !isProviderConfigured(provider)) {
			return API.v1.success({ authorizeUrl: null, configured: false });
		}
		// If CasePro is already this user's calendar source, there's nothing to authorize — they connected
		// in CasePro. Tell the client so it can show "connected via CasePro" instead of launching OAuth.
		try {
			if (isCaseProCalendarActive() && (await getCaseProBridgeForUser(this.userId))) {
				return API.v1.success({ authorizeUrl: null, configured: true, casepro: true });
			}
		} catch {
			// fall through to the standalone OAuth start
		}
		try {
			const { authorizeUrl } = await buildAuthorizeUrl(provider, this.userId);
			return API.v1.success({ authorizeUrl, configured: true });
		} catch (err) {
			return API.v1.failure(err instanceof Error ? err.message : 'connect_failed');
		}
	},
);

// POST boards.calendar.disconnect — tear down mirror events (best-effort) then remove the connection.
API.v1.post(
	'boards.calendar.disconnect',
	{
		authRequired: true,
		body: isConnectionIdBody,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { connectionId } = this.bodyParams as { connectionId: string };
		const doc = await BoardCalendarConnections.findOneByIdAndUserId(connectionId, this.userId);
		if (!doc) {
			return API.v1.success({ removed: false });
		}
		try {
			// Tear down the real-time push subscription first (best-effort), then the mirror events.
			await teardownPushSubscription(doc);
		} catch {
			// best-effort — proceed regardless
		}
		try {
			await teardownConnectionMirrors(doc);
		} catch {
			// best-effort — proceed to remove the record regardless
		}
		const result = await BoardCalendarConnections.deleteByIdAndUserId(connectionId, this.userId);
		return API.v1.success({ removed: result.deletedCount === 1 });
	},
);

// POST boards.calendar.syncNow — push the caller's due cards + poll for inbound changes, on demand.
// `connectionId` is OPTIONAL: a CasePro-preferred user has no standalone connection, so they sync with
// an empty body (routed through CasePro). When a connectionId is given but CasePro is preferred, CasePro
// still wins (single source of truth per user).
const isSyncNowBody = ajv.compile({
	type: 'object',
	properties: { connectionId: { type: 'string', minLength: 1 } },
	additionalProperties: false,
});

API.v1.post(
	'boards.calendar.syncNow',
	{
		authRequired: true,
		body: isSyncNowBody,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { connectionId } = (this.bodyParams as { connectionId?: string }) || {};
		if (!isCalendarSyncEnabled()) {
			return API.v1.success({ enabled: false });
		}

		// PREFERRED: route through CasePro when it's this user's calendar source.
		try {
			const bridge = await getCaseProBridgeForUser(this.userId);
			if (bridge) {
				const pushed = await pushUserCardsThroughCasePro(this.userId, bridge);
				const polled = await pollCasePro(this.userId, bridge);
				return API.v1.success({ source: 'casepro', pushed, polled });
			}
		} catch {
			// fall through to standalone
		}

		if (!connectionId) {
			return API.v1.failure('connection_not_found');
		}
		const doc = await BoardCalendarConnections.findOneByIdAndUserId(connectionId, this.userId);
		if (!doc) {
			return API.v1.failure('connection_not_found');
		}
		const pushed = await pushUserCards(doc);
		const polled = await pollConnection(doc);
		return API.v1.success({ source: 'standalone', pushed, polled });
	},
);
