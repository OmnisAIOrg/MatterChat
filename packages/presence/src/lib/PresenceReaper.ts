// MATTERCHAT: clean-room MIT presence reaper (EE removal plan step 3a). Derived from the
// MIT model APIs (UsersSessions.findByOtherInstanceIds/removeConnectionsFromOtherInstanceIds,
// Users.findExpiredStatuses, the InstanceStatus TTL index) — no EE source consulted.
import type { IUser } from '@rocket.chat/core-typings';
import { InstanceStatus, Users, UsersSessions } from '@rocket.chat/models';

const DEFAULT_INTERVAL_MS = 60_000;

export type ExpiredStatusUser = Pick<
	IUser,
	| '_id'
	| 'username'
	| 'roles'
	| 'status'
	| 'statusDefault'
	| 'statusSource'
	| 'statusText'
	| 'statusExpiresAt'
	| 'statusConnection'
	| 'previousState'
>;

/**
 * Periodically cleans up presence state nothing else will ever clean:
 *
 * - connections owned by an instance that stopped heartbeating (crashed or killed
 *   process). The InstanceStatus collection has a TTL index on _updatedAt, so a dead
 *   instance falls out of it within about a minute — any session connection still
 *   pointing at an unknown instance id is stale. That TTL is the staleness cutoff.
 * - temporary statuses whose statusExpiresAt has passed.
 *
 * The reaper only finds the stale documents; what to do with the affected users is
 * injected by the service so the status recomputation/broadcast lives in one place.
 */
export class PresenceReaper {
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly recomputeUsers: (uids: string[]) => Promise<void>,
		private readonly restoreExpiredStatus: (user: ExpiredStatusUser) => Promise<void>,
		private readonly intervalMs = DEFAULT_INTERVAL_MS,
	) {}

	start(): void {
		this.stop();
		this.timer = setInterval(() => {
			void this.runOnce();
		}, this.intervalMs);
		void this.runOnce();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	async runOnce(): Promise<void> {
		try {
			await this.reapStaleConnections();
		} catch {
			// best effort — try again next tick
		}
		try {
			await this.reapExpiredStatuses();
		} catch {
			// best effort — try again next tick
		}
	}

	private async reapStaleConnections(): Promise<void> {
		const aliveInstanceIds = (await InstanceStatus.find({}, { projection: { _id: 1 } }).toArray()).map(({ _id }) => _id);
		if (!aliveInstanceIds.length) {
			// no instance registered itself yet (early boot) — treating everything as
			// stale here would wipe live connections, so wait for the next tick
			return;
		}

		const affected = (await UsersSessions.findByOtherInstanceIds(aliveInstanceIds, { projection: { _id: 1 } }).toArray()).map(
			({ _id }) => _id,
		);
		if (!affected.length) {
			return;
		}

		await UsersSessions.removeConnectionsFromOtherInstanceIds(aliveInstanceIds);
		await this.recomputeUsers(affected);
	}

	private async reapExpiredStatuses(): Promise<void> {
		const expired = await Users.findExpiredStatuses().toArray();
		for (const user of expired) {
			await this.restoreExpiredStatus(user);
		}
	}
}
