// MATTERCHAT: clean-room MIT Meteor wiring for the presence service (EE removal plan step 3b).
// This is the only place that ever marks a user online: it feeds connection lifecycle events
// into the Presence core-service. Derived from the MIT patterns in server/hooks/sauMonitorHooks.ts
// and the IPresence contract — no EE source consulted.
import { Presence } from '@rocket.chat/core-services';
import { InstanceStatus } from '@rocket.chat/instance-status';
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';

import type { ILoginAttempt } from '../lib/auth/ILoginAttempt';

// connections that completed a login on this instance: connection id -> user id
const loggedConnections = new Map<string, string>();

// every open socket on this instance (authenticated or not), reported to InstanceStatus
let connectionCount = 0;

// refresh tracked connections well within the reaper's staleness window
const HEARTBEAT_INTERVAL_MS = 30_000;

// throttle for InstanceStatus.updateConnections — at most one write per tick, none when unchanged
const REPORT_CONNECTIONS_INTERVAL_MS = 10_000;

// cap the shutdown cleanup so a slow database cannot stall process termination
const SHUTDOWN_CLEANUP_TIMEOUT_MS = 2_000;

Meteor.onConnection((connection) => {
	connectionCount++;

	connection.onClose(async () => {
		connectionCount--;

		const uid = loggedConnections.get(connection.id);
		loggedConnections.delete(connection.id);
		if (!uid) {
			return;
		}

		try {
			await Presence.removeConnection(uid, connection.id, InstanceStatus.id());
		} catch {
			// service unavailable — the reaper collects this connection later
		}
	});
});

Accounts.onLogin(async (info: ILoginAttempt): Promise<void> => {
	const uid = info.user?._id;
	const connectionId = info.connection?.id;
	if (!uid || !connectionId) {
		return;
	}

	loggedConnections.set(connectionId, uid);

	try {
		await Presence.newConnection(uid, connectionId, InstanceStatus.id());
	} catch {
		// service unavailable — the client's next UserPresence method call retries the status
	}
});

Accounts.onLogout(async (info): Promise<void> => {
	const connectionId = info.connection?.id;
	if (!connectionId) {
		return;
	}

	loggedConnections.delete(connectionId);

	if (!info.user?._id) {
		return;
	}

	try {
		await Presence.removeConnection(info.user._id, connectionId, InstanceStatus.id());
	} catch {
		// service unavailable — the reaper collects this connection later
	}
});

// heartbeat: keep _updatedAt fresh on every logged-in connection this instance owns
setInterval(() => {
	for (const [connectionId, uid] of loggedConnections) {
		void Presence.updateConnection(uid, connectionId).catch(() => {
			// service unavailable — nothing to refresh
		});
	}
}, HEARTBEAT_INTERVAL_MS);

// keep the instance's connection count visible in admin > workspace > instances
let lastReportedConnectionCount = -1;
setInterval(() => {
	if (connectionCount === lastReportedConnectionCount) {
		return;
	}
	lastReportedConnectionCount = connectionCount;
	void InstanceStatus.updateConnections(connectionCount).catch(() => {
		// instance not registered yet — next tick reports again
	});
}, REPORT_CONNECTIONS_INTERVAL_MS);

// on shutdown, take this instance's connections down with it (best effort — anything
// missed is collected by the reaper on the next boot via the InstanceStatus TTL)
const removeLocalConnections = async (): Promise<void> => {
	try {
		await Promise.race([
			Presence.removeLostConnections(InstanceStatus.id()),
			new Promise((resolve) => {
				setTimeout(resolve, SHUTDOWN_CLEANUP_TIMEOUT_MS);
			}),
		]);
	} catch {
		// best effort only
	}
};

(['SIGTERM', 'SIGINT'] as NodeJS.Signals[]).forEach((signal) => {
	process.once(signal, () => {
		void removeLocalConnections().finally(() => {
			// this once-listener is spent, so re-raising resumes the default termination
			// (or whatever other handler is registered)
			process.kill(process.pid, signal);
		});
	});
});
