import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { logCommunication, type LogCommunicationParams, type LogCommunicationResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leadLogComm'(params: { leadId: string } & LogCommunicationParams): LogCommunicationResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leadLogComm'({ leadId, ...params }) {
		const uid = requireUid('boards.leadLogComm');
		return logCommunication(uid, leadId, params);
	},
});
