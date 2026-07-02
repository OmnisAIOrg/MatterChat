import type { IRoom } from '@rocket.chat/core-typings';
import { ServerEvents } from '@rocket.chat/models';

import { buildActor } from './auditAuthorizationChanges';

/**
 * Clean-room, best-effort audit emitter for LEGAL HOLD changes (litigation hold set/cleared on a
 * room), writing to the MIT `server_events` collection via the existing createAuditServerEvent
 * writer. Call sites fire this and swallow rejections (`.catch`) so auditing never breaks the
 * underlying hold change — same doctrine as auditAuthorizationChanges.ts. The event carries the
 * actor (who), the room (scope) and the event `ts` (when), plus the optional case reference.
 */
export async function auditLegalHoldChanged(
	actorUserId: string,
	operation: 'set' | 'cleared',
	room: Pick<IRoom, '_id' | 'name' | 'fname'>,
	details: { caseId?: string; reason?: string } = {},
): Promise<void> {
	await ServerEvents.createAuditServerEvent(
		'room.legalHold.changed',
		{
			operation,
			roomId: room._id,
			roomName: room.fname || room.name,
			caseId: details.caseId,
			reason: details.reason,
		},
		await buildActor(actorUserId),
	);
}
