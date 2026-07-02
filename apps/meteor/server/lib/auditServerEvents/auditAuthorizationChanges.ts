import type { IAuditServerUserActor } from '@rocket.chat/core-typings';
import { ServerEvents, Users } from '@rocket.chat/models';

/**
 * Clean-room, best-effort audit emitters for the firm-grade PRIVILEGE TRAIL (role + permission
 * changes), writing to the MIT `server_events` collection via the existing createAuditServerEvent
 * writer. Call sites fire these and swallow rejections (`.catch`) so auditing never breaks the
 * underlying authorization change. ip/useragent enrichment from the transport layer is a follow-up.
 */
export async function buildActor(actorUserId: string): Promise<IAuditServerUserActor> {
	const user = await Users.findOneById(actorUserId, { projection: { username: 1 } });
	return { type: 'user', _id: actorUserId, username: user?.username || '', ip: '', useragent: '' };
}

export async function auditRoleChanged(
	actorUserId: string,
	operation: 'added' | 'removed',
	role: string,
	targetUser: { _id: string; username?: string },
	scope?: string,
): Promise<void> {
	await ServerEvents.createAuditServerEvent(
		'role.changed',
		{ operation, role, targetUserId: targetUser._id, targetUsername: targetUser.username, scope },
		await buildActor(actorUserId),
	);
}

export async function auditPermissionChanged(
	actorUserId: string,
	operation: 'granted' | 'revoked',
	permission: string,
	role: string,
): Promise<void> {
	await ServerEvents.createAuditServerEvent('permission.changed', { operation, permission, role }, await buildActor(actorUserId));
}
