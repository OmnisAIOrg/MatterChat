/**
 * REST surface for the per-user external-workspace connection lifecycle (Slack / Teams).
 *
 * All routes are `authRequired` and operate ONLY on the calling user's own connections — a user
 * can never list or disconnect another user's connections (enforced in connectionService via
 * ownership-scoped model methods). Encrypted credential blobs are never returned to the client.
 *
 * Routes:
 *   GET  external-workspaces.list                                   -> the user's connections (no secrets)
 *   GET  external-workspaces.authUrl?provider=slack|teams           -> begin-connect URL (STUB for now)
 *   GET  external-workspaces.channels?connectionId=|provider=teams  -> the connection's REAL channels
 *   GET  external-workspaces.messages?connectionId=&channelExternalId=&since=  -> a channel's REAL messages
 *   POST external-workspaces.sendMessage { connectionId, channelExternalId, text } -> post AS the user
 *   POST external-workspaces.disconnect { connectionId }            -> tear down one of the user's own
 *
 * The channels / messages / sendMessage routes ride a real Graph/auth/config error back inside a 200
 * envelope as { ok:false, error, message, status } (NOT API.v1.failure) — the RC REST client rejects
 * 4xx bodies with the raw Response, which would hide the message. See spec §6.2 (WS-5).
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §4 / §6.2 (WS-5).
 */
import type { ExternalProvider } from '@rocket.chat/core-typings';

import {
	disconnectMyConnection,
	getProviderAuthUrl,
	listMyChannels,
	listMyConnections,
	listMyMessages,
	sendMyMessage,
} from '../../../connectors/server/connectionService';
import { API } from '../api';

const VALID_PROVIDERS: ExternalProvider[] = ['slack', 'teams', 'google'];

API.v1.addRoute(
	'external-workspaces.list',
	{ authRequired: true },
	{
		async get() {
			const connections = await listMyConnections(this.userId);
			return API.v1.success({ connections });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.authUrl',
	{ authRequired: true },
	{
		async get() {
			const { provider } = this.queryParams;
			if (!provider || !VALID_PROVIDERS.includes(provider)) {
				return API.v1.failure('invalid-provider');
			}
			const result = await getProviderAuthUrl(this.userId, provider);
			return API.v1.success(result);
		},
	},
);

API.v1.addRoute(
	'external-workspaces.channels',
	{ authRequired: true },
	{
		async get() {
			const { connectionId, provider } = this.queryParams as { connectionId?: string; provider?: ExternalProvider };

			if (!connectionId && !provider) {
				return API.v1.failure('connectionId-or-provider-required');
			}
			if (provider && !VALID_PROVIDERS.includes(provider)) {
				return API.v1.failure('invalid-provider');
			}

			// Own-connections-only (enforced inside listMyChannels via ownership-scoped model methods).
			const result = await listMyChannels(this.userId, { connectionId, provider });

			// A real Graph/auth/config error is NOT swallowed: it rides back inside a 200 envelope as
			// { ok:false, error, message, status } so the panel can render it plainly (the RC REST client
			// rejects 4xx bodies with the raw Response, which would hide the message — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const, groups: result.groups, connection: result.connection });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.messages',
	{ authRequired: true },
	{
		async get() {
			const { connectionId, channelExternalId, since } = this.queryParams as {
				connectionId?: string;
				channelExternalId?: string;
				since?: string;
			};

			if (!connectionId || typeof connectionId !== 'string') {
				return API.v1.failure('connectionId is required');
			}
			if (!channelExternalId || typeof channelExternalId !== 'string') {
				return API.v1.failure('channelExternalId is required');
			}

			// Own-connections-only (enforced inside listMyMessages via ownership-scoped model methods).
			const result = await listMyMessages(this.userId, { connectionId, channelExternalId, since });

			// A real Graph/auth/config error is NOT swallowed: it rides back inside a 200 envelope so the
			// panel can render it plainly (the RC REST client hides 4xx bodies — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const, messages: result.messages, connection: result.connection });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.sendMessage',
	{ authRequired: true },
	{
		async post() {
			const { connectionId, channelExternalId, text } = this.bodyParams as {
				connectionId?: string;
				channelExternalId?: string;
				text?: string;
			};

			if (!connectionId || typeof connectionId !== 'string') {
				return API.v1.failure('connectionId is required');
			}
			if (!channelExternalId || typeof channelExternalId !== 'string') {
				return API.v1.failure('channelExternalId is required');
			}
			if (!text || typeof text !== 'string') {
				return API.v1.failure('text is required');
			}

			// Own-connections-only (enforced inside sendMyMessage via ownership-scoped model methods).
			const result = await sendMyMessage(this.userId, { connectionId, channelExternalId, text });

			// A real Graph/auth/config error is NOT swallowed: it rides back inside a 200 envelope so the
			// panel can render it plainly (the RC REST client hides 4xx bodies — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const, externalId: result.externalId, connection: result.connection });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.disconnect',
	{ authRequired: true },
	{
		async post() {
			const { connectionId } = this.bodyParams as { connectionId?: string };
			if (!connectionId || typeof connectionId !== 'string') {
				return API.v1.failure('connectionId is required');
			}
			const disconnected = await disconnectMyConnection(this.userId, connectionId);
			if (!disconnected) {
				return API.v1.failure('connection-not-found');
			}
			return API.v1.success({ disconnected: true });
		},
	},
);
