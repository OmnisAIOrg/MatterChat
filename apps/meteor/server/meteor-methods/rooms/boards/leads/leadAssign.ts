import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { assignLead, type AssignLeadParams, type AssignLeadResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leadAssign'(params: { leadId: string } & AssignLeadParams): AssignLeadResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leadAssign'({ leadId, ...params }) {
		const uid = requireUid('boards.leadAssign');
		return assignLead(uid, leadId, params);
	},
});
