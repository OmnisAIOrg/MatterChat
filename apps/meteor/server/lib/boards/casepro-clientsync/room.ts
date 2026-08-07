import type { IRoom, IUser } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';

import { createRoom } from '../../rooms/createRoom';
import { SystemLogger } from '../../logger/system';

/**
 * The per-matter "Client" channel — find-or-create.
 *
 * DISTINCT from the internal matter channel: the internal channel is
 * `Rooms.findOne({ matterId })` WITHOUT `clientChannel` (see
 * server/lib/boards/matters/service.ts#linkMatterChannel). The Client channel is keyed on
 * `{ matterId, clientChannel: true }`, so the two never collide. It is a PRIVATE room ('p')
 * with the system bot as owner and NO client member (the client is not a MatterChat user —
 * they're represented by the sync). Staff are added to it out-of-band (or by a firm admin);
 * we deliberately do NOT auto-add staff here so membership stays a firm decision.
 *
 * Naming: `client-<matterNumber-or-id>` — visually distinct from the internal `matter-<...>`.
 */

/** The system bot that owns synced Client channels and authors inbound client messages. */
export async function getClientSyncBot(): Promise<IUser | null> {
	return Users.findOneById('rocket.cat');
}

/** Slugify a matter identifier into a safe, <=64-char room name with the `client-` prefix. */
function clientRoomName(matterId: string, matterNumber?: string): string {
	const base = String(matterNumber ?? matterId);
	return (
		`client-${base}`
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/(^-+|-+$)/g, '')
			.slice(0, 64) || `client-${matterId}`
	);
}

/**
 * Return the existing Client room for a matter, or null. Cheap — used by the outbound hook
 * and by the poll before deciding to create one.
 */
export async function findClientRoom(matterId: string): Promise<IRoom | null> {
	return Rooms.findOne({ matterId, clientChannel: true });
}

/**
 * Find-or-create the Client channel for a matter. Idempotent on `{ matterId, clientChannel }`.
 * Returns the room _id, or null if the system bot is missing (never throws into the poll loop).
 */
export async function ensureClientRoom(matterId: string, matterNumber?: string, matterName?: string): Promise<string | null> {
	const existing = await findClientRoom(matterId);
	if (existing) {
		return existing._id;
	}

	const bot = await getClientSyncBot();
	if (!bot) {
		SystemLogger.warn({ msg: 'casepro.clientSync.ensureRoom.noBot', matterId });
		return null;
	}

	const name = clientRoomName(matterId, matterNumber);
	try {
		const room = await createRoom('p', name, bot, [], false, false, {
			matterId,
			clientChannel: true,
			...(matterName ? { topic: `Client thread — ${matterName}` } : { topic: 'Client thread (synced from the CasePro portal)' }),
		});
		SystemLogger.info({ msg: 'casepro.clientSync.ensureRoom.created', matterId, rid: room.rid, name });
		return room.rid;
	} catch (err) {
		// Name-collision race (two poll ticks): re-read by the stable key and reuse.
		const raced = await findClientRoom(matterId);
		if (raced) {
			return raced._id;
		}
		SystemLogger.error({ msg: 'casepro.clientSync.ensureRoom.failed', matterId, err });
		return null;
	}
}
