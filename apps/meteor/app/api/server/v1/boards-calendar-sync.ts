import type { CalendarProvider } from '@rocket.chat/core-typings';
import { BoardCalendarConnections } from '@rocket.chat/models';
import { ajv, validateBadRequestErrorResponse, validateUnauthorizedErrorResponse } from '@rocket.chat/rest-typings';

import { isCalendarSyncEnabled, isProviderConfigured } from '../../../../server/lib/boards/calendar-sync/config';
import { buildAuthorizeUrl } from '../../../../server/lib/boards/calendar-sync/routes';
import { pollConnection, pushUserCards, teardownConnectionMirrors } from '../../../../server/lib/boards/calendar-sync/service';
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
		return API.v1.success({
			enabled: true,
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
			await teardownConnectionMirrors(doc);
		} catch {
			// best-effort — proceed to remove the record regardless
		}
		const result = await BoardCalendarConnections.deleteByIdAndUserId(connectionId, this.userId);
		return API.v1.success({ removed: result.deletedCount === 1 });
	},
);

// POST boards.calendar.syncNow — push the caller's due cards + poll for inbound changes, on demand.
API.v1.post(
	'boards.calendar.syncNow',
	{
		authRequired: true,
		body: isConnectionIdBody,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { connectionId } = this.bodyParams as { connectionId: string };
		if (!isCalendarSyncEnabled()) {
			return API.v1.success({ enabled: false });
		}
		const doc = await BoardCalendarConnections.findOneByIdAndUserId(connectionId, this.userId);
		if (!doc) {
			return API.v1.failure('connection_not_found');
		}
		const pushed = await pushUserCards(doc);
		const polled = await pollConnection(doc);
		return API.v1.success({ pushed, polled });
	},
);
