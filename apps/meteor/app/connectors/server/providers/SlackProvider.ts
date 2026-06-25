/**
 * SlackProvider — STUB.
 *
 * The frozen IChatProvider implementation for Slack. The real implementation (build stream WS-1)
 * is a THIN adapter over the existing MIT SlackBridge — it does NOT rebuild Slack:
 *   - connect/subscribe   → existing SlackAdapter `connectApp`/`connectLegacy` + onMessage.
 *   - postMessage         → existing SlackAdapter posters.
 *   - listChannels        → `SlackAPI.getChannels()` + `getGroups()`.
 *   - resolveIdentity     → `SlackAPI.getUser`.
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.1.
 *
 * For MVP, Slack stays workspace-level (admin token) surfaced through this provider so the rail
 * is uniform; per-user Slack OAuth is a fast-follow (M4) reusing the connection store + a
 * `/_slack/oauth` route cloned from the `/_omnisai` pattern.
 *
 * Every method throws `not_implemented` until WS-1 lands, so the interface + registry are frozen
 * and the real provider drops in without touching any caller. Clean-room: nothing from
 * `apps/meteor/ee/` is read or copied.
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

const TODO = 'SlackProvider not_implemented — see MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.1 (build stream WS-1)';

function notImplemented(): never {
	throw new Error(TODO);
}

export class SlackProvider implements IChatProvider {
	readonly provider = 'slack' as const;

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
