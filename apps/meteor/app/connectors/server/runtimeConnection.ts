/**
 * Rebuild the runtime IProviderConnection (decrypted credentials + refresh-persistence hook) from
 * a stored IExternalWorkspaceConnection document.
 *
 * Factored out of connectionService so the live message bridge (bridgeCore / bridgeService /
 * the Teams webhook) can build connections WITHOUT importing connectionService — which imports
 * providerRegistry — which imports the providers. Keeping this module provider-free breaks the
 * would-be import cycle (provider → subscriptions → connectionService → registry → provider).
 *
 * Returns null when the credential blob can't be decrypted (missing/wrong key) so the caller
 * forces a reconnect rather than calling the provider with a garbage token.
 *
 * TOKEN-REFRESH PERSISTENCE: the connection carries an `onCredentialsRefreshed` hook. When the
 * provider's HTTP client refreshes the access token mid-call (proactively before expiry, or on a
 * live 401), it forwards the refreshed fields here; we merge them over the ORIGINAL decrypted blob
 * (preserving provider-specific extras like homeAccountId/externalAadUserId — but NOT the
 * runtime-spliced externalOrgId, which lives on the doc), re-encrypt, and persist. Without this,
 * every call after access-token expiry would re-run the refresh grant, and a ROTATED refresh token
 * would be silently dropped.
 */
import type { IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections } from '@rocket.chat/models';

import type { IProviderConnection, IProviderCredentials } from './ChatProvider';
import { decryptCredentials, encryptCredentials } from './tokenCrypto';

export function toProviderConnection(doc: IExternalWorkspaceConnection): IProviderConnection | null {
	const credentials = decryptCredentials<IProviderCredentials>(doc.credentials);
	if (!credentials?.accessToken) {
		return null;
	}
	return {
		connectionId: doc._id,
		ownerUserId: doc.userId,
		externalOrgId: doc.externalOrgId,
		credentials: { ...credentials, externalOrgId: doc.externalOrgId },
		onCredentialsRefreshed: async (refreshed: IProviderCredentials): Promise<void> => {
			// Merge over the ORIGINAL blob (pre-splice) so nothing provider-specific is lost, and only
			// fields the refresh actually produced are overwritten (a response may omit a rotated token).
			const merged: IProviderCredentials = { ...credentials };
			if (refreshed.accessToken) {
				merged.accessToken = refreshed.accessToken;
			}
			if (refreshed.refreshToken) {
				merged.refreshToken = refreshed.refreshToken;
			}
			if (refreshed.expiresAt !== undefined) {
				merged.expiresAt = refreshed.expiresAt;
			}
			await ExternalWorkspaceConnections.updateCredentialsById(doc._id, encryptCredentials(merged));
		},
	};
}
