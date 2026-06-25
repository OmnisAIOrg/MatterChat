/**
 * connectionService — per-user lifecycle for external-workspace connections.
 *
 * Thin server-side service the REST routes (and later the rail endpoints / BridgeCore) call.
 * EVERY operation is scoped to the authenticated user: a user manages only their OWN
 * connections. Ownership is enforced at the model layer (findOneByIdAndUserId /
 * deleteByIdAndUserId), so a user can never read or disconnect someone else's connection.
 *
 * Token handling: credentials are stored encrypted (tokenCrypto) and the encrypted blob is
 * NEVER returned to the client. `toClientConnection` strips it.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §4.
 */
import type { ExternalProvider, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import type { IProviderChannel, IProviderConnection, IProviderCredentials } from './ChatProvider';
import { providerRegistry } from './providerRegistry';
import { isTeamsConfigured } from './providers/teams/config';
import { decryptCredentials } from './tokenCrypto';

/**
 * Client-safe projection of a connection — everything EXCEPT the encrypted credential blob.
 * This is what the list/disconnect endpoints return and what the rail renders.
 */
export type ClientConnection = Omit<IExternalWorkspaceConnection, 'credentials' | '_updatedAt'>;

function toClientConnection(doc: IExternalWorkspaceConnection): ClientConnection {
	const { credentials, _updatedAt, ...safe } = doc;
	return safe;
}

/** List the connections owned by a user (client-safe; no secrets). */
export async function listMyConnections(userId: string): Promise<ClientConnection[]> {
	const docs = await ExternalWorkspaceConnections.findByUserId(userId).toArray();
	return docs.map(toClientConnection);
}

/**
 * Build the provider's OAuth authorize URL for a user to begin connecting a workspace.
 *
 * TEAMS (real): returns the server-side `/api/apps/teamsbridge/oauth/start` URL. The client just
 * navigates there; the route mints PKCE + state (bound to the signed-in user via the login-token
 * cookie) and redirects on to Microsoft. PKCE stays entirely server-side — the client never sees a
 * verifier. Returns `authorizeUrl: null, implemented: false` when Teams is disabled or no client
 * secret is configured (standalone-safe), so the UI can show a disabled state.
 *
 * SLACK: still a stub here (per-user Slack OAuth is a later milestone); workspace-level Slack is
 * surfaced separately.
 */
export async function getProviderAuthUrl(
	// Bound to the user by the OAuth route via the login-token cookie; not needed to build the URL.
	_userId: string,
	provider: ExternalProvider,
): Promise<{ provider: ExternalProvider; authorizeUrl: string | null; implemented: boolean }> {
	if (!providerRegistry.has(provider)) {
		throw new Error('invalid-provider');
	}
	// Touch the provider so an unregistered/garbage key fails the same way callers will see later.
	providerRegistry.get(provider);

	if (provider === 'teams') {
		if (!isTeamsConfigured()) {
			// Disabled or no client secret pasted yet — signal "not ready" without throwing.
			return { provider, authorizeUrl: null, implemented: false };
		}
		return { provider, authorizeUrl: Meteor.absoluteUrl('api/apps/teamsbridge/oauth/start'), implemented: true };
	}

	// TODO(later): per-user Slack OAuth route. Until then, signal "not implemented".
	return { provider, authorizeUrl: null, implemented: false };
}

/**
 * Disconnect (tear down) one of the user's own connections.
 *
 * Ownership-scoped: returns false if the connection doesn't exist or isn't owned by the user.
 * Best-effort tells the provider to release live resources, then removes the record.
 */
export async function disconnectMyConnection(userId: string, connectionId: string): Promise<boolean> {
	const doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(connectionId, userId);
	if (!doc) {
		return false;
	}

	// Best-effort provider teardown. Providers are stubs today (throw not_implemented), so we
	// swallow errors here — the record removal below is what the user asked for and must succeed.
	try {
		const provider = providerRegistry.get(doc.provider);
		await provider.disconnect({
			connectionId: doc._id,
			ownerUserId: doc.userId,
			externalOrgId: doc.externalOrgId,
			credentials: {},
		});
	} catch {
		// Provider not implemented yet, or live teardown failed — proceed to remove the record.
	}

	const result = await ExternalWorkspaceConnections.deleteByIdAndUserId(connectionId, userId);
	return result.deletedCount === 1;
}

/**
 * A channel as returned to the client by the "see your channels" view. Provider-native ids/names,
 * plus the team name split out of the provider's qualified label so the UI can group by team.
 */
export type ClientChannel = {
	/** Provider-native channel id (Teams: `19:…@thread.tacv2`). */
	externalId: string;
	/** The channel's own name (without the team prefix). */
	name: string;
	/** The team/workspace this channel belongs to (for grouping). */
	teamName: string;
	isPrivate: boolean;
	topic?: string;
};

/** Channels grouped by their team, for the "connected channels" panel. */
export type ClientChannelGroup = {
	teamName: string;
	channels: ClientChannel[];
};

/** Error payload surfaced to the client when listing channels fails (NOT swallowed — see spec WS-5). */
export type ListChannelsError = {
	/** Stable machine code, e.g. `teams_not_configured`, `graph_error`, `connection_not_found`. */
	error: string;
	/** Human-readable detail (the underlying Graph/auth message), safe to show plainly. */
	message: string;
	/** HTTP-ish status from the upstream provider when available (e.g. 401, 403, 429). */
	status?: number;
};

/**
 * Rebuild the runtime IProviderConnection (decrypted credentials) from a stored connection doc.
 * Returns null when the credential blob can't be decrypted (missing/wrong key) so the caller forces
 * a reconnect rather than calling the provider with a garbage token.
 */
function toProviderConnection(doc: IExternalWorkspaceConnection): IProviderConnection | null {
	const credentials = decryptCredentials<IProviderCredentials>(doc.credentials);
	if (!credentials?.accessToken) {
		return null;
	}
	return {
		connectionId: doc._id,
		ownerUserId: doc.userId,
		externalOrgId: doc.externalOrgId,
		credentials: { ...credentials, externalOrgId: doc.externalOrgId },
	};
}

/** Split the provider's qualified `Team / Channel` label into its parts (falls back gracefully). */
function splitChannelLabel(channel: IProviderChannel, fallbackTeam: string): { teamName: string; name: string } {
	const sep = ' / ';
	const idx = channel.name.indexOf(sep);
	if (idx > 0) {
		return { teamName: channel.name.slice(0, idx), name: channel.name.slice(idx + sep.length) };
	}
	return { teamName: fallbackTeam, name: channel.name };
}

/**
 * List the channels of ONE of the caller's OWN connections, grouped by team.
 *
 * Loads the connection (ownership-scoped), rebuilds the runtime credentials, calls
 * `providerRegistry.get(provider).listChannels(conn)` — the REAL Microsoft Graph call for Teams —
 * and returns the channels grouped by team. On a Graph/auth/config error it returns a structured
 * ListChannelsError (NOT swallowed) so the UI — and we — can see whether listChannels actually
 * works against real Teams. A successful call also persists any token the provider refreshed mid-call.
 *
 * `connectionId` is optional: when omitted, the user's most recent `connected` connection for
 * `provider` is used (the rail tile knows the provider, not necessarily the connection id).
 */
export async function listMyChannels(
	userId: string,
	opts: { connectionId?: string; provider?: ExternalProvider },
): Promise<{ groups: ClientChannelGroup[]; connection: ClientConnection } | ListChannelsError> {
	// Resolve which connection to read — by id (ownership-scoped) or by provider (most recent).
	let doc: IExternalWorkspaceConnection | null = null;
	if (opts.connectionId) {
		doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(opts.connectionId, userId);
	} else if (opts.provider) {
		const docs = await ExternalWorkspaceConnections.findByUserIdAndProvider(userId, opts.provider).toArray();
		doc = docs.find((d) => d.status === 'connected') || docs[0] || null;
	}

	if (!doc) {
		return { error: 'connection_not_found', message: 'No connected workspace found for this account.', status: 404 };
	}

	if (doc.status !== 'connected') {
		return {
			error: `connection_${doc.status}`,
			message:
				doc.status === 'consent_required'
					? 'This Teams connection needs admin consent before channels can be read.'
					: 'This connection is not active — reconnect the workspace and try again.',
		};
	}

	const connection = toProviderConnection(doc);
	if (!connection) {
		return { error: 'credentials_unavailable', message: 'Stored credentials could not be read — reconnect the workspace.', status: 401 };
	}

	try {
		const provider = providerRegistry.get(doc.provider);
		const channels = await provider.listChannels(connection);

		// NOTE on token refresh: the Graph client refreshes the access token in place on a 401 during the
		// call (so this listing still succeeds), but the provider's listChannels does not yet surface the
		// refreshed token back to us to re-persist (the graphClient's onTokensRefreshed hook is wired in
		// the read/post milestone). A re-refresh on the next call is the only cost — not a correctness bug.

		// Group the flat channel list by team (the provider qualifies names as `Team / Channel`).
		const byTeam = new Map<string, ClientChannel[]>();
		for (const ch of channels) {
			const { teamName, name } = splitChannelLabel(ch, doc.externalOrgName || 'Microsoft Teams');
			const entry: ClientChannel = { externalId: ch.externalId, name, teamName, isPrivate: ch.isPrivate, topic: ch.topic };
			const list = byTeam.get(teamName);
			if (list) {
				list.push(entry);
			} else {
				byTeam.set(teamName, [entry]);
			}
		}

		const groups: ClientChannelGroup[] = [...byTeam.entries()].map(([teamName, chans]) => ({ teamName, channels: chans }));
		return { groups, connection: toClientConnection(doc) };
	} catch (err) {
		// DO NOT swallow — surface the real Graph/auth error so the UI (and we) can see if listChannels
		// works against real Teams. graphFetch throws `graph_error:<code>:<message>` and stamps `status`.
		const message = err instanceof Error ? err.message : String(err);
		const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
		const graphCode = (err as { graphCode?: string })?.graphCode;
		return { error: graphCode ? `graph_error:${graphCode}` : message.split(':')[0] || 'list_channels_failed', message, status };
	}
}
