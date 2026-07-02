/**
 * Server startup entry for the CasePro CLIENT-message two-way sync.
 *
 * Importing this module wires the OUTBOUND leg: the afterSaveMessage subscriber
 * (`CaseProClientSync_Out`) that forwards staff messages typed in a "Client" channel out to the
 * CasePro portal. Registration is gated on the enable settings (see ./hook.ts), so importing
 * this at boot is safe even when the feature is OFF — the callback is only added once the toggles
 * are on. The INBOUND leg (poll) is registered separately from cron/start.ts.
 *
 * Imported from apps/meteor/server/importPackages.ts, alongside the other CasePro modules.
 */
import { Meteor } from 'meteor/meteor';

import { registerClientSyncOutbound } from './hook';

Meteor.startup(() => {
	registerClientSyncOutbound();
});
