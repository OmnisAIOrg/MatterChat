import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { createLead, type CreateLeadFields, type CreateLeadResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leadCreate'(fields: CreateLeadFields): CreateLeadResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leadCreate'(fields) {
		const uid = requireUid('boards.leadCreate');
		return createLead(uid, fields);
	},
});
