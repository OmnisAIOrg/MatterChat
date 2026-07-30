// MATTERCHAT: clean-room MIT presence service (EE removal plan step 3a). Implements the MIT
// IPresence contract from @rocket.chat/core-services on top of the MIT UsersSessions/Users
// models. Derived from the contract and its MIT call sites — no EE source consulted.
import type { IPresence } from '@rocket.chat/core-services';
import { ServiceClass } from '@rocket.chat/core-services';
import type { IUser } from '@rocket.chat/core-typings';
import { UserStatus } from '@rocket.chat/core-typings';
import { Users, UsersSessions } from '@rocket.chat/models';

import type { ExpiredStatusUser } from './lib/PresenceReaper';
import { PresenceReaper } from './lib/PresenceReaper';
import { MANUAL_STATUSES, capturePreviousState, computeConnectionStatus, computeVisibleStatus, trimStatusText } from './lib/presenceEngine';

// Purely informational ceiling reported by getConnectionCount() — MatterChat enforces no
// seat/connection caps, this only keeps the admin UI's current/max percentage math sane.
const MAX_CONNECTIONS = parseInt(String(process.env.PRESENCE_MAX_CONNECTIONS), 10) || 200_000;

const USER_PRESENCE_PROJECTION = {
	username: 1,
	name: 1,
	roles: 1,
	active: 1,
	status: 1,
	statusText: 1,
	statusDefault: 1,
	statusConnection: 1,
	statusSource: 1,
	statusExpiresAt: 1,
	previousState: 1,
} as const;

type PresenceUser = Pick<
	IUser,
	| '_id'
	| 'username'
	| 'name'
	| 'roles'
	| 'active'
	| 'status'
	| 'statusText'
	| 'statusDefault'
	| 'statusConnection'
	| 'statusSource'
	| 'statusExpiresAt'
	| 'previousState'
>;

export class Presence extends ServiceClass implements IPresence {
	protected name = 'presence';

	private broadcastEnabled = true;

	// connection ids seen by this service, per instance id. In-memory only, for
	// getConnectionCount()/peak tracking — the durable state lives in UsersSessions.
	// Sets make double registration/removal of the same connection id harmless.
	private connectionsByInstance = new Map<string, Set<string>>();

	private peakConnections = 0;

	private reaper = new PresenceReaper(
		async (uids) => {
			for (const uid of uids) {
				await this.updateUserPresence(uid);
			}
		},
		async (user) => this.restoreExpiredStatus(user),
	);

	override async started(): Promise<void> {
		// the first run also collects connections left behind by a previous boot of this node
		this.reaper.start();
	}

	override async stopped(): Promise<void> {
		this.reaper.stop();
	}

	async newConnection(
		uid: string | undefined,
		session: string | undefined,
		nodeId: string,
	): Promise<{ uid: string; connectionId: string } | undefined> {
		if (!uid || !session) {
			return undefined;
		}

		this.trackConnection(nodeId, session);

		// a login on a connection id we already track (login retry, account switch on the
		// same socket) must not leave a duplicate or orphaned connection entry behind
		await UsersSessions.removeConnectionByConnectionId(session);
		await UsersSessions.addConnectionById(uid, { id: session, instanceId: nodeId, status: UserStatus.ONLINE });
		await this.updateUserPresence(uid);

		return { uid, connectionId: session };
	}

	async removeConnection(
		uid: string | undefined,
		session: string | undefined,
		nodeId: string,
	): Promise<{ uid: string; session: string } | undefined> {
		if (!session) {
			return undefined;
		}

		this.untrackConnection(nodeId, session);

		// the caller may not know who owned the connection (socket closed before login was
		// seen, logout without user) — resolve it so the user still gets recomputed
		const affectedUid = uid ?? (await UsersSessions.findOne({ 'connections.id': session }, { projection: { _id: 1 } }))?._id;

		await UsersSessions.removeConnectionByConnectionId(session);
		if (affectedUid) {
			await this.updateUserPresence(affectedUid);
		}

		if (!uid) {
			return undefined;
		}
		return { uid, session };
	}

	async updateConnection(uid: string, connectionId: string): Promise<{ uid: string; connectionId: string } | undefined> {
		if (!uid || !connectionId) {
			return undefined;
		}

		// heartbeat: refresh the connection's _updatedAt so it never looks abandoned
		const result = await UsersSessions.updateOne(
			{ '_id': uid, 'connections.id': connectionId },
			{ $set: { 'connections.$._updatedAt': new Date() } },
		);
		if (result.matchedCount === 0) {
			return undefined;
		}

		return { uid, connectionId };
	}

	async removeLostConnections(nodeID: string): Promise<string[]> {
		if (!nodeID) {
			return [];
		}

		this.connectionsByInstance.delete(nodeID);

		const affected = (await UsersSessions.findByInstanceId(nodeID).toArray()).map(({ _id }) => _id);
		if (!affected.length) {
			return [];
		}

		await UsersSessions.removeConnectionsFromInstanceId(nodeID);
		for (const uid of affected) {
			await this.updateUserPresence(uid);
		}

		return affected;
	}

	async setStatus(userId: string, status: UserStatus, statusText?: string, statusExpiresAt?: Date): Promise<boolean> {
		if (!MANUAL_STATUSES.includes(status)) {
			return false;
		}

		const user = await Users.findOneById<PresenceUser>(userId, { projection: USER_PRESENCE_PROJECTION });
		if (!user) {
			return false;
		}

		const statusConnection = await this.getConnectionStatus(userId);
		const values: Record<string, unknown> = {
			status: computeVisibleStatus(status, statusConnection),
			statusConnection,
			statusDefault: status,
			statusSource: 'manual',
			...(statusText !== undefined && { statusText: trimStatusText(statusText) }),
		};

		const clear: string[] = [];
		if (statusExpiresAt) {
			values.statusExpiresAt = statusExpiresAt;
			// temporary manual status — remember what to go back to once it expires,
			// without overwriting a restore target that already exists
			if (!user.previousState) {
				values.previousState = capturePreviousState(user);
			}
		} else {
			// a plain manual set is permanent: cancel any pending expiry/restore
			clear.push('statusExpiresAt', 'previousState');
		}

		const result = await Users.updatePresenceAndStatus(userId, values, clear);
		if (!result) {
			return false;
		}

		this.broadcastStatusChange(result, user.status);
		return true;
	}

	async setActiveState(
		userId: string,
		newState: Pick<IUser, 'statusDefault' | 'statusSource' | 'statusText' | 'statusExpiresAt'>,
	): Promise<boolean> {
		const user = await Users.findOneById<PresenceUser>(userId, { projection: USER_PRESENCE_PROJECTION });
		if (!user) {
			return false;
		}

		const statusConnection = await this.getConnectionStatus(userId);
		const statusDefault = newState.statusDefault ?? user.statusDefault ?? UserStatus.ONLINE;
		const values: Record<string, unknown> = {
			status: computeVisibleStatus(statusDefault, statusConnection),
			statusConnection,
			statusDefault,
			statusSource: newState.statusSource ?? 'internal',
			...(newState.statusText !== undefined && { statusText: trimStatusText(newState.statusText) }),
			...(newState.statusExpiresAt && { statusExpiresAt: newState.statusExpiresAt }),
			// nested active states keep the original restore target
			...(!user.previousState && { previousState: capturePreviousState(user) }),
		};
		const clear = newState.statusExpiresAt ? [] : ['statusExpiresAt'];

		const result = await Users.updatePresenceAndStatus(userId, values, clear);
		if (!result) {
			return false;
		}

		this.broadcastStatusChange(result, user.status);
		return true;
	}

	async endActiveState(userId: string): Promise<boolean> {
		const user = await Users.findOneById<PresenceUser>(userId, { projection: USER_PRESENCE_PROJECTION });
		if (!user?.previousState) {
			return false;
		}

		const previous = user.previousState;
		const statusConnection = await this.getConnectionStatus(userId);
		const values: Record<string, unknown> = {
			status: computeVisibleStatus(previous.statusDefault, statusConnection),
			statusConnection,
			statusDefault: previous.statusDefault,
			statusText: previous.statusText,
			statusSource: previous.statusSource,
			...(previous.statusExpiresAt && { statusExpiresAt: previous.statusExpiresAt }),
		};
		const clear = ['previousState', ...(previous.statusExpiresAt ? [] : ['statusExpiresAt'])];

		const result = await Users.updatePresenceAndStatus(userId, values, clear);
		if (!result) {
			return false;
		}

		this.broadcastStatusChange(result, user.status);
		return true;
	}

	async clearActiveState(userId: string): Promise<boolean> {
		// make the current state permanent: drop the saved restore target and any pending
		// expiry, without touching the visible status (hence no broadcast)
		const result = await Users.updateOne({ _id: userId }, { $unset: { previousState: '', statusExpiresAt: '' } });
		return result.matchedCount > 0;
	}

	async setConnectionStatus(uid: string, status: UserStatus, session: string): Promise<boolean> {
		if (!uid || !session) {
			return false;
		}

		const result = await UsersSessions.updateConnectionStatusById(uid, session, status);
		if (result.matchedCount === 0) {
			return false;
		}

		await this.updateUserPresence(uid);
		return true;
	}

	toggleBroadcast(enabled: boolean): void {
		// MIT: no license gate — always honored, never throws
		this.broadcastEnabled = enabled;
	}

	getConnectionCount(): { current: number; max: number } {
		return { current: this.countCurrentConnections(), max: MAX_CONNECTIONS };
	}

	getPeakConnections(reset = false): number {
		const peak = this.peakConnections;
		if (reset) {
			this.resetPeakConnections();
		}
		return peak;
	}

	resetPeakConnections(): void {
		// connections still open count towards the new period's peak
		this.peakConnections = this.countCurrentConnections();
	}

	private trackConnection(nodeId: string, connectionId: string): void {
		let connections = this.connectionsByInstance.get(nodeId);
		if (!connections) {
			connections = new Set();
			this.connectionsByInstance.set(nodeId, connections);
		}
		connections.add(connectionId);

		const current = this.countCurrentConnections();
		if (current > this.peakConnections) {
			this.peakConnections = current;
		}
	}

	private untrackConnection(nodeId: string, connectionId: string): void {
		// try the hinted instance first, but a connection may have been registered under
		// another node id (or the hint may be wrong on logout-then-close sequences)
		if (this.connectionsByInstance.get(nodeId)?.delete(connectionId)) {
			return;
		}
		for (const connections of this.connectionsByInstance.values()) {
			if (connections.delete(connectionId)) {
				return;
			}
		}
	}

	private countCurrentConnections(): number {
		let total = 0;
		for (const connections of this.connectionsByInstance.values()) {
			total += connections.size;
		}
		return total;
	}

	private async getConnectionStatus(uid: string): Promise<UserStatus> {
		const session = await UsersSessions.findOneById(uid);
		return computeConnectionStatus(session?.connections ?? []);
	}

	/**
	 * Recompute a user's status from their connections and persist/broadcast it when it
	 * actually changed. Used for every connection-driven transition (login, logout, socket
	 * close, away/online reports, reaping).
	 */
	private async updateUserPresence(uid: string): Promise<void> {
		const user = await Users.findOneById<PresenceUser>(uid, { projection: USER_PRESENCE_PROJECTION });
		if (!user || user.active === false) {
			return;
		}

		const statusConnection = await this.getConnectionStatus(uid);
		const status = computeVisibleStatus(user.statusDefault, statusConnection);
		if (user.status === status && user.statusConnection === statusConnection) {
			return;
		}

		const result = await Users.updatePresenceAndStatus(uid, { status, statusConnection });
		if (!result || user.status === status) {
			// document kept accurate, but the visible status did not change — no broadcast
			return;
		}

		this.broadcastStatusChange(result, user.status);
	}

	private async restoreExpiredStatus(user: ExpiredStatusUser): Promise<void> {
		if (user.previousState) {
			await this.endActiveState(user._id);
			return;
		}
		// leftover expiry with nothing recorded to go back to: keep the current status,
		// just stop treating it as temporary
		await Users.updateOne({ _id: user._id }, { $unset: { statusExpiresAt: '' } });
	}

	private broadcastStatusChange(
		user: Pick<IUser, '_id' | 'username' | 'status' | 'statusText' | 'statusSource' | 'statusExpiresAt' | 'name' | 'roles'>,
		previousStatus: UserStatus | undefined,
	): void {
		if (!this.broadcastEnabled) {
			return;
		}

		const { _id, username, status, statusText, statusSource, statusExpiresAt, name, roles } = user;
		void this.api?.broadcast('presence.status', {
			user: { _id, username, status, statusText, statusSource, statusExpiresAt, name, roles },
			previousStatus,
		});
	}
}
