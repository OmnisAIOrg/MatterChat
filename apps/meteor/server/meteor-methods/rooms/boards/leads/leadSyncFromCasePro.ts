import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { pullFromCasePro, isCaseProEnabled, type PullFromCaseProResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.leads.syncFromCasePro'(): PullFromCaseProResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.leads.syncFromCasePro'() {
		const uid = requireUid('boards.leads.syncFromCasePro');
		if (!isCaseProEnabled()) {
			throw new Meteor.Error('error-casepro-disabled', 'CasePro is not enabled; nothing to sync', {
				method: 'boards.leads.syncFromCasePro',
			});
		}
		return pullFromCasePro(uid);
	},
});
