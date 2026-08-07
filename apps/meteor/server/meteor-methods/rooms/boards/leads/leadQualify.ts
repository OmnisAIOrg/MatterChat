import type { ILead, ILeadQualification } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { qualifyLead } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leadQualify'(params: { leadId: string; qualification: ILeadQualification }): ILead;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leadQualify'({ leadId, qualification }) {
		const uid = requireUid('boards.leadQualify');
		return qualifyLead(uid, leadId, qualification);
	},
});
