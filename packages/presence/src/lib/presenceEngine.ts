// MATTERCHAT: clean-room MIT presence engine (EE removal plan step 3a). Derived from the
// IPresence contract in @rocket.chat/core-services, the MIT UsersSessions/Users model APIs
// and their MIT call sites — no EE source consulted.
import type { IUser, IUserSessionConnection } from '@rocket.chat/core-typings';
import { UserStatus } from '@rocket.chat/core-typings';

/** The statuses a user (or an app acting for one) may claim on purpose. */
export const MANUAL_STATUSES: UserStatus[] = [UserStatus.ONLINE, UserStatus.AWAY, UserStatus.BUSY, UserStatus.OFFLINE];

/**
 * A user is online if any of their connections is online, away if the best they
 * have is an away connection, and offline once no connection remains.
 */
export function computeConnectionStatus(connections: Pick<IUserSessionConnection, 'status'>[]): UserStatus {
	let best = UserStatus.OFFLINE;
	for (const { status } of connections) {
		if (status === UserStatus.ONLINE) {
			return UserStatus.ONLINE;
		}
		if (status === UserStatus.AWAY) {
			best = UserStatus.AWAY;
		}
	}
	return best;
}

/**
 * The status everyone else sees:
 * - no live connection -> offline, no matter what was chosen manually;
 * - chosen status "online" -> follow the automatic connection status (online/away);
 * - any other manual choice (busy/away/offline a.k.a. invisible) wins while connected.
 */
export function computeVisibleStatus(statusDefault: UserStatus | undefined, statusConnection: UserStatus): UserStatus {
	if (statusConnection === UserStatus.OFFLINE) {
		return UserStatus.OFFLINE;
	}
	const chosen = statusDefault ?? UserStatus.ONLINE;
	if (chosen === UserStatus.ONLINE) {
		return statusConnection;
	}
	return chosen;
}

/** Snapshot of the state to go back to when a temporary status ends. */
export function capturePreviousState(
	user: Pick<IUser, 'statusDefault' | 'statusText' | 'statusSource' | 'statusExpiresAt'>,
): NonNullable<IUser['previousState']> {
	return {
		statusDefault: user.statusDefault ?? UserStatus.ONLINE,
		statusText: user.statusText ?? '',
		statusSource: user.statusSource ?? 'manual',
		...(user.statusExpiresAt && { statusExpiresAt: user.statusExpiresAt }),
	};
}

/** Same normalization the MIT setStatusText/updateStatusById paths apply. */
export function trimStatusText(statusText: string): string {
	return statusText.trim().substring(0, 120);
}
