import { Apps } from '@rocket.chat/apps';
import type { IAppStorageItem } from '@rocket.chat/apps/dist/server/storage/IAppStorageItem';
import { License } from '@rocket.chat/license';

import { addMigration } from '../../lib/migrations';

addMigration({
	version: 307,
	name: "Mark all installed private apps as 'migrated'",
	async up() {
		const isEE = License.hasValidLicense();
		if (isEE) {
			return;
		}

		// MATTERCHAT: no Apps-Engine orchestrator on a pure-MIT workspace — no apps to migrate.
		// Return instead of throwing so fresh databases don't crash at boot.
		if (!Apps.self) {
			return;
		}

		Apps.initialize();

		const sigMan = Apps.getManager().getSignatureManager();
		const appsStorage = Apps.getStorage();
		const apps = await appsStorage.retrieveAllPrivate();

		for (const app of apps.values()) {
			const updatedApp = {
				...app,
				migrated: true,
			} as IAppStorageItem;

			await appsStorage.updatePartialAndReturnDocument({
				...updatedApp,
				signature: await sigMan.signApp(updatedApp),
			});
		}
	},
});
