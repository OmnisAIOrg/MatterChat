/**
 * MATTERCHAT: MIT stub replacing the EE `@rocket.chat/media-calls` package (the VoIP/team-collab
 * call engine, removed with the Enterprise tree).
 *
 * MatterChat does not use VoIP calls (every VoIP_TeamCollab_* setting is disabled), but the MIT
 * tree carries a real surface around the engine — the media-call core service, REST endpoints,
 * call-history views, navbar controls. Deleting all of that would be a wide, churny amputation;
 * this stub keeps it compiling and dormant instead:
 *
 * - the emitter never emits, so the service's listeners simply never fire;
 * - lifecycle no-ops (`configure`, `scheduleExpirationCheck`, `hangupExpiredCalls`) succeed;
 * - actual call attempts (`receiveSignal`, `receiveCallUpdate`) throw `media-calls-not-available`,
 *   so an API caller gets a clean error instead of a half-working call.
 *
 * If MatterChat ever wants native calls, replace this stub with a real MIT implementation.
 */

/** Push categories the MIT push helper derives from a call's end state. */
export type VoipPushNotificationType = 'answeredElsewhere' | 'declinedElsewhere' | 'remoteEnded' | 'unanswered' | 'incoming_call';

/** Event names forwarded to the VoIP push sender; opaque to the stub. */
export type VoipPushNotificationEventType = string;

export interface IMediaCallServerSettings {
	internalCalls: {
		requireExtensions: boolean;
		routeExternally: 'always' | 'never';
	};
	sip: {
		enabled: boolean;
		drachtio: {
			host: string;
			port: number;
			secret: string;
		};
		sipServer: {
			host: string;
			port: number;
		};
	};
	mobileRinging: boolean;
	permissionCheck: (uid: string, callType: any) => boolean | Promise<boolean>;
	isFeatureAvailableForUser: (uid: string, feature: any) => boolean | Promise<boolean>;
}

const unavailable = (): never => {
	throw new Error('media-calls-not-available');
};

export const callServer = {
	emitter: {
		on(_event: string, _cb: (...args: any[]) => void): void {
			// Listeners are registered but nothing ever emits — calls are unavailable.
		},
	},
	configure(_settings: IMediaCallServerSettings): void {
		// No engine to configure.
	},
	scheduleExpirationCheck(): void {
		// No calls can exist, so nothing can expire.
	},
	async hangupExpiredCalls(): Promise<void> {
		// No calls can exist, so nothing to hang up.
	},
	async receiveSignal(_uid: string, _signal: unknown, _options?: { throwIfSkipped?: boolean }): Promise<void> {
		unavailable();
	},
	receiveCallUpdate(_params: unknown): void {
		// Cross-instance call-update fan-in; with no engine there is nothing to update.
	},
};

/** Signals to replay to a client reconnecting mid-call — there are never any. */
export async function getSignalsForExistingCall(_call: unknown, _uid: string, _contractId?: string): Promise<never[]> {
	return [];
}
