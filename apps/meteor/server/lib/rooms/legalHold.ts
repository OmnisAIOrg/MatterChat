import type { IRoom, IRoomWithRetentionPolicy } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';

import { auditLegalHoldChanged } from '../auditServerEvents/auditLegalHoldChanges';

/**
 * LEGAL HOLD (litigation hold) admin operations.
 *
 * Data model: `room.retention.legalHold` (see IRoomWithRetentionPolicy). ENFORCEMENT is already
 * live and unchanged by this module:
 *   - the retention pruner skips held rooms (cronPruneMessages.ts query),
 *   - manual purge (cleanRoomHistory) and room erase refuse held rooms via
 *     `isRoomUnderLegalHold` at their entry points.
 * This module is the missing CONTROL surface: set/clear a hold (permission-gated at the REST
 * layer by `manage-legal-hold`), with every change best-effort audited to `server_events` as
 * `room.legalHold.changed`.
 *
 * NOTE: keep this file free of `meteor/*` imports — it is unit-tested under jest, which has no
 * Meteor module mapping on the server preset. Call sites throw Meteor.Error themselves.
 */

export type LegalHoldState = NonNullable<IRoomWithRetentionPolicy['retention']['legalHold']>;

type RoomMaybeHeld = Pick<IRoom, '_id'> & { retention?: { legalHold?: LegalHoldState } };

/** The room's hold state, defaulting to `{ enabled: false }` when never set. */
export const getLegalHoldState = (room: RoomMaybeHeld | null | undefined): LegalHoldState =>
	room?.retention?.legalHold ?? { enabled: false };

/** True when a litigation hold currently covers the room (purge/prune must refuse). */
export const isRoomUnderLegalHold = (room: RoomMaybeHeld | null | undefined): boolean =>
	getLegalHoldState(room).enabled === true;

/**
 * Place a legal hold on a room. Idempotent (re-setting refreshes setAt/setBy/caseId/reason).
 * Returns the persisted hold state.
 */
export async function setRoomLegalHold(
	actorUserId: string,
	room: Pick<IRoom, '_id' | 'name' | 'fname'>,
	details: { caseId?: string; reason?: string } = {},
): Promise<LegalHoldState> {
	const actor = await Users.findOneById(actorUserId, { projection: { username: 1 } });

	await Rooms.saveLegalHoldById(room._id, {
		setBy: { _id: actorUserId, ...(actor?.username && { username: actor.username }) },
		...(details.caseId && { caseId: details.caseId }),
		...(details.reason && { reason: details.reason }),
	});

	// Best-effort audit (same doctrine as auditAuthorizationChanges): never break the hold change.
	await auditLegalHoldChanged(actorUserId, 'set', room, details).catch(() => undefined);

	const updated = await Rooms.findOneById<RoomMaybeHeld>(room._id, { projection: { 'retention.legalHold': 1 } });
	return getLegalHoldState(updated);
}

/**
 * Release the legal hold on a room. Keeps setAt/setBy/caseId/reason in place (the model's
 * clearLegalHoldById only flips `enabled: false`) so the last hold's metadata stays inspectable.
 * Returns the persisted hold state.
 */
export async function clearRoomLegalHold(actorUserId: string, room: Pick<IRoom, '_id' | 'name' | 'fname'>): Promise<LegalHoldState> {
	const previous = await Rooms.findOneById<RoomMaybeHeld>(room._id, { projection: { 'retention.legalHold': 1 } });

	await Rooms.clearLegalHoldById(room._id);

	await auditLegalHoldChanged(actorUserId, 'cleared', room, {
		caseId: previous?.retention?.legalHold?.caseId,
	}).catch(() => undefined);

	const updated = await Rooms.findOneById<RoomMaybeHeld>(room._id, { projection: { 'retention.legalHold': 1 } });
	return getLegalHoldState(updated);
}
