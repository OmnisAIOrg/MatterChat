/**
 * REST surface for the per-user external-workspace connection lifecycle (Slack / Teams).
 *
 * All routes are `authRequired` and operate ONLY on the calling user's own connections — a user
 * can never list or disconnect another user's connections (enforced in connectionService via
 * ownership-scoped model methods). Encrypted credential blobs are never returned to the client.
 *
 * Routes:
 *   GET  external-workspaces.list                         -> the user's connections (no secrets)
 *   GET  external-workspaces.authUrl?provider=slack|teams -> begin-connect URL (STUB for now)
 *   POST external-workspaces.disconnect { connectionId }  -> tear down one of the user's own
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §4 / §6.2 (WS-5).
 */
import type { ExternalProvider } from '@rocket.chat/core-typings';

import { disconnectMyConnection, getProviderAuthUrl, listMyConnections } from '../../../connectors/server/connectionService';
import { API } from '../api';

const VALID_PROVIDERS: ExternalProvider[] = ['slack', 'teams'];

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
