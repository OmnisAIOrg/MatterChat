import type { IAuditServerEventType } from '../IServerEvent';

/**
 * Audit payload for a role assignment/revocation on a user (the privilege-escalation trail).
 * Clean-room MatterChat addition to the MIT `server_events` model — independent of the
 * Enterprise (ee/) audit, which does not record this event.
 */
export interface IServerEventRoleChanged
	extends IAuditServerEventType<
		| {
				key: 'operation';
				value: 'added' | 'removed';
		  }
		| {
				key: 'role';
				value: string;
		  }
		| {
				key: 'targetUserId';
				value: string;
		  }
		| {
				key: 'targetUsername';
				value: string | undefined;
		  }
		| {
				key: 'scope';
				value: string | undefined;
		  }
	> {
	t: 'role.changed';
}
