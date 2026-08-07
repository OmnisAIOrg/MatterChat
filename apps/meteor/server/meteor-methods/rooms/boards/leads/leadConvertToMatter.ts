import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { convertToMatter, type ConvertToMatterResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leadConvertToMatter'(params: { leadId: string }): ConvertToMatterResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leadConvertToMatter'({ leadId }) {
		const uid = requireUid('boards.leadConvertToMatter');
		return convertToMatter(uid, leadId);
	},
});
