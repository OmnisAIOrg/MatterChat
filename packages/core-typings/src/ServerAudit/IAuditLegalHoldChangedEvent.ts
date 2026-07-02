import type { IAuditServerEventType } from '../IServerEvent';

/**
 * Audit payload for setting/clearing a litigation (legal) hold on a room. Clean-room MatterChat
 * addition to the MIT `server_events` model — independent of the Enterprise (ee/) audit, which
 * does not record this event. Every set/clear is itself part of the compliance trail: actor,
 * scope (room), timestamp (the event `ts`), and the optional case reference/reason.
 */
export interface IServerEventLegalHoldChanged
	extends IAuditServerEventType<
		| {
				key: 'operation';
				value: 'set' | 'cleared';
		  }
		| {
				key: 'roomId';
				value: string;
		  }
		| {
				key: 'roomName';
				value: string | undefined;
		  }
		| {
				key: 'caseId';
				value: string | undefined;
		  }
		| {
				key: 'reason';
				value: string | undefined;
		  }
	> {
	t: 'room.legalHold.changed';
}
