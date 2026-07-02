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
 *   GET  external-workspaces.directChats?connectionId=|provider=    -> the connection's REAL 1:1 + group DMs
 *   GET  external-workspaces.members?connectionId=|provider=        -> the connection's REAL org people
 *   GET  external-workspaces.messages?connectionId=&channelExternalId=&since=  -> a channel/chat's REAL messages
 *   POST external-workspaces.sendMessage { connectionId, channelExternalId, text } -> post AS the user
 *   POST external-workspaces.disconnect { connectionId }            -> tear down one of the user's own
 *
 * The channels / directChats / members / messages / sendMessage routes ride a real Graph/auth/config
 * error back inside a 200 envelope as { ok:false, error, message, status } (NOT API.v1.failure) — the
 * RC REST client rejects 4xx bodies with the raw Response, which would hide the message. See WS-5.
 *
 * NOTE: messages/sendMessage take `channelExternalId` for EITHER a channel id (from .channels) OR a
 * direct-chat id (from .directChats) — the provider detects which (Teams: a `teamId|channelId`
 * composite is a channel, a bare chat id is a DM). The frontend passes whichever id it has, unchanged.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §4 / §6.2 (WS-5).
 */
import type { ExternalProvider } from '@rocket.chat/core-typings';

import { bridgeMyChannel, listMyBridges, unbridgeMyChannel } from '../../../connectors/server/bridge/bridgeService';
import {
	disconnectMyConnection,
	getProviderAuthUrl,
	listMyChannels,
	listMyConnections,
	listMyDirectChats,
	listMyMembers,
	listMyMessages,
	markMyRead,
	sendMyMessage,
	unreadSummaryForMyConnections,
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
	'external-workspaces.directChats',
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

			// Own-connections-only (enforced inside listMyDirectChats via ownership-scoped model methods).
			const result = await listMyDirectChats(this.userId, { connectionId, provider });

			// Real Graph/auth/config error NOT swallowed: rides back inside a 200 envelope so the panel can
			// render it plainly (the RC REST client hides 4xx bodies — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const, chats: result.chats, connection: result.connection });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.members',
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

			// Own-connections-only (enforced inside listMyMembers via ownership-scoped model methods).
			const result = await listMyMembers(this.userId, { connectionId, provider });

			// Real Graph/auth/config error NOT swallowed: rides back inside a 200 envelope so the panel can
			// render it plainly (the RC REST client hides 4xx bodies — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const, members: result.members, connection: result.connection });
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

// ─── live message bridge (mirror an external channel into a MatterChat room) ──────────────────

API.v1.addRoute(
	'external-workspaces.bridges',
	{ authRequired: true },
	{
		async get() {
			// Own-connections-only (enumerated inside listMyBridges via findByUserId).
			const bridges = await listMyBridges(this.userId);
			return API.v1.success({ ok: true as const, bridges });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.bridgeChannel',
	{ authRequired: true },
	{
		async post() {
			const { connectionId, channelExternalId, name } = this.bodyParams as {
				connectionId?: string;
				channelExternalId?: string;
				name?: string;
			};

			if (!connectionId || typeof connectionId !== 'string') {
				return API.v1.failure('connectionId is required');
			}
			if (!channelExternalId || typeof channelExternalId !== 'string') {
				return API.v1.failure('channelExternalId is required');
			}

			// Own-connections-only (enforced inside bridgeMyChannel via ownership-scoped model methods).
			const result = await bridgeMyChannel(this.userId, {
				connectionId,
				channelExternalId,
				...(typeof name === 'string' ? { name } : {}),
			});

			// A real Graph/auth/config error is NOT swallowed: it rides back inside a 200 envelope so the
			// panel can render it plainly (the RC REST client hides 4xx bodies — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const, bridge: result.bridge });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.unbridgeChannel',
	{ authRequired: true },
	{
		async post() {
			const { connectionId, channelExternalId } = this.bodyParams as { connectionId?: string; channelExternalId?: string };

			if (!connectionId || typeof connectionId !== 'string') {
				return API.v1.failure('connectionId is required');
			}
			if (!channelExternalId || typeof channelExternalId !== 'string') {
				return API.v1.failure('channelExternalId is required');
			}

			// Own-connections-only (enforced inside unbridgeMyChannel via ownership-scoped model methods).
			const result = await unbridgeMyChannel(this.userId, { connectionId, channelExternalId });

			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			return API.v1.success({ ok: true as const });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.unreadSummary',
	{ authRequired: true },
	{
		async get() {
			// Own-connections-only (enumerated inside unreadSummaryForMyConnections via findByUserId).
			// Best-effort per connection: a provider that can't report unreads is defaulted to 0/0, never
			// failing the whole call — so this always rides back as { ok:true, summaries }.
			const summaries = await unreadSummaryForMyConnections(this.userId);
			return API.v1.success({ ok: true as const, summaries });
		},
	},
);

API.v1.addRoute(
	'external-workspaces.markRead',
	{ authRequired: true },
	{
		async post() {
			const { connectionId, externalId } = this.bodyParams as { connectionId?: string; externalId?: string };

			if (!connectionId || typeof connectionId !== 'string') {
				return API.v1.failure('connectionId is required');
			}
			if (!externalId || typeof externalId !== 'string') {
				return API.v1.failure('externalId is required');
			}

			// Own-connections-only (enforced inside markMyRead via ownership-scoped model methods).
			const result = await markMyRead(this.userId, { connectionId, externalId });

			// A real auth/ownership failure is NOT swallowed: it rides back inside a 200 envelope so the
			// panel can render it plainly (the RC REST client hides 4xx bodies — see api-client send()).
			if ('error' in result) {
				return API.v1.success({ ok: false as const, error: result.error, message: result.message, status: result.status });
			}

			// Best-effort: a provider without read-state support still acks ok (markMyRead no-ops it).
			return API.v1.success({ ok: true as const });
		},
	},
);
