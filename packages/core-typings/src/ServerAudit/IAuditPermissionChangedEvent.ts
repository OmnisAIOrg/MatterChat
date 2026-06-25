import type { IAuditServerEventType } from '../IServerEvent';

/**
 * Audit payload for granting/revoking a permission on a role. Clean-room MatterChat addition to
 * the MIT `server_events` model — independent of the Enterprise (ee/) audit, which does not record
 * this event.
 */
export interface IServerEventPermissionChanged
	extends IAuditServerEventType<
		| {
				key: 'operation';
				value: 'granted' | 'revoked';
		  }
		| {
				key: 'permission';
				value: string;
		  }
		| {
				key: 'role';
				value: string;
		  }
	> {
	t: 'permission.changed';
}
