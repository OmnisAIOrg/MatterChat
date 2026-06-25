/**
 * TeamsProvider — STUB.
 *
 * The frozen IChatProvider implementation for Microsoft Teams. The real implementation
 * (build streams WS-2 + WS-3) is GREENFIELD on Microsoft Graph — there is no Teams/Graph code
 * in the repo today. It will:
 *   - connect            → OAuth2 auth-code + PKCE (S256) against
 *                          login.microsoftonline.com/organizations/... (clone the `/_omnisai`
 *                          PKCE route pattern; DELEGATED scopes, not application).
 *   - listChannels       → GET /me/joinedTeams + /teams/{id}/channels (paged via @odata.nextLink).
 *   - syncMessages       → GET /teams/{id}/channels/{id}/messages (+ /replies), or /messages/delta.
 *   - subscribe          → Graph change-notifications (webhooks) keyed by (tenantId, channelId),
 *                          shared across users; polling fallback on a per-connection toggle.
 *   - postMessage        → POST /teams/{id}/channels/{id}/messages, contentType html, AS the user.
 *   - resolveIdentity    → from the message `from.user` block (avoids User.ReadBasic.All).
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3 (the load-bearing Graph detail).
 *
 * BLOCKED on the Azure app registration (§5 a–e) for live integration; the interface + registry
 * are frozen now so the real provider drops in without touching any caller. Every method throws
 * `not_implemented` until WS-2/WS-3 land. Clean-room: written from Graph docs, never adapted
 * from any `apps/meteor/ee/` federation code.
 */
import type {
	IChatProvider,
	InboundMessageHandler,
	IOutboundMessage,
	IProviderChannel,
	IProviderConnection,
	IProviderCredentials,
	IProviderMessage,
	IProviderOAuthInput,
	IProviderUser,
	IProviderSubscription,
	IVerifiedConnection,
} from '../ChatProvider';

const TODO =
	'TeamsProvider not_implemented — see MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2/§3 (build streams WS-2 + WS-3); blocked on Azure app registration §5';

function notImplemented(): never {
	throw new Error(TODO);
}

export class TeamsProvider implements IChatProvider {
	readonly provider = 'teams' as const;

	async connect(_input: IProviderOAuthInput): Promise<IProviderCredentials> {
		return notImplemented();
	}

	async verifyCredentials(_credentials: IProviderCredentials): Promise<IVerifiedConnection> {
		return notImplemented();
	}

	async disconnect(_connection: IProviderConnection): Promise<void> {
		return notImplemented();
	}

	async listChannels(_connection: IProviderConnection): Promise<IProviderChannel[]> {
		return notImplemented();
	}

	// eslint-disable-next-line require-yield
	async *syncMessages(_connection: IProviderConnection, _channelExternalId: string, _since?: string): AsyncIterable<IProviderMessage> {
		return notImplemented();
	}

	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		return notImplemented();
	}

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		return notImplemented();
	}

	async postMessage(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_message: IOutboundMessage,
	): Promise<{ externalId: string }> {
		return notImplemented();
	}
}
