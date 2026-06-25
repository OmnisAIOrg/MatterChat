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

import { providerRegistry } from './providerRegistry';

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
 * STUB for the foundation: real authorize URLs come with the providers (Slack OAuth route /
 * Teams `/_teams/authorize` PKCE dance). For now this validates the provider is registered and
 * returns a placeholder so the UI can code against the shape; it never returns a usable URL yet.
 */
export async function getProviderAuthUrl(
	// Bound to the user so the real OAuth flow can tie PKCE state to them; unused in the stub.
	_userId: string,
	provider: ExternalProvider,
): Promise<{ provider: ExternalProvider; authorizeUrl: string | null; implemented: boolean }> {
	if (!providerRegistry.has(provider)) {
		throw new Error('invalid-provider');
	}
	// Touch the provider so an unregistered/garbage key fails the same way callers will see later.
	providerRegistry.get(provider);

	// TODO(WS-2/WS-1): return the real authorize URL once the provider OAuth routes land
	// (Teams: PKCE authorize against login.microsoftonline.com/organizations; Slack: /_slack/oauth).
	// Until then, signal "not implemented" without throwing so the UI can show a disabled state.
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
