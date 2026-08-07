/**
 * Chi Admin Assistant — server boot.
 *
 * Imported once from server/importPackages.ts (the same wiring style as app/connectors/server).
 * Registers the DM intake at startup, and seeds the Chi bot user the moment the feature is
 * switched on (settings.watch fires on boot AND on live changes) so admins can actually FIND
 * @chi.bot in search — the /chi slash command's lazy creation only covers workspaces that used
 * /chi first. Workspaces that never enable the assistant never grow the extra user here.
 */
import { Meteor } from 'meteor/meteor';

import { registerChiAdminIntake } from './intake';
import { settings } from '../../../settings';
import { SystemLogger } from '../../logger/system';
import { getChiBotUser } from '../bot';

Meteor.startup(() => {
	registerChiAdminIntake();
	settings.watch<boolean>('Chi_Assistant_Enabled', (enabled) => {
		if (!enabled) {
			return;
		}
		getChiBotUser().catch((err) => {
			SystemLogger.error({ msg: 'Chi bot seeding failed', err: String(err) });
		});
	});
});
