import type { ILead } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { updateLead, type UpdateLeadPatch } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leadUpdate'(params: { leadId: string; patch: UpdateLeadPatch }): ILead;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leadUpdate'({ leadId, patch }) {
		const uid = requireUid('boards.leadUpdate');
		return updateLead(uid, leadId, patch);
	},
});
