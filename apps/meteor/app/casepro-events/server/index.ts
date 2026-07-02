/**
 * Server entry for the CasePro case-update webhook receiver.
 *
 * Importing this module mounts POST /_casepro/webhook (see ./webhook.ts — fail-closed HMAC
 * verification, 60s per-matter burst collapse, posts into rooms linked by rooms.matterId).
 * Registered from apps/meteor/server/importPackages.ts, next to the connectors module.
 */
import { Meteor } from 'meteor/meteor';

import { caseproWebhookSecret } from './config';
import { SystemLogger } from '../../../server/lib/logger/system';

import './webhook';

Meteor.startup(() => {
	if (!caseproWebhookSecret()) {
		SystemLogger.warn('CasePro webhook receiver DISABLED — CASEPRO_WEBHOOK_SECRET not set');
	}
});
