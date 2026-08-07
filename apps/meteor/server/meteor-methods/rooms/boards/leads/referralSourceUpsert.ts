import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { upsertReferralSource, type UpsertReferralSourceFields, type UpsertReferralSourceResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.referralSourceUpsert'(params: { sourceId?: string; fields: UpsertReferralSourceFields }): UpsertReferralSourceResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.referralSourceUpsert'({ sourceId, fields }) {
		const uid = requireUid('boards.referralSourceUpsert');
		return upsertReferralSource(uid, fields, sourceId);
	},
});
