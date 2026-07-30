import { Apps } from '@rocket.chat/apps';
import type { IAppStorageItem } from '@rocket.chat/apps/dist/server/storage/IAppStorageItem';

import { addMigration } from '../../lib/migrations';

addMigration({
	version: 294,
	async up() {
		// MATTERCHAT: the Apps-Engine orchestrator (EE) is removed — on a workspace without it
		// there are no installed apps to migrate, so this is a clean no-op instead of a boot crash
		// (a fresh database runs every migration; throwing here would brick new instances).
		if (!Apps.self) {
			return;
		}

		Apps.initialize();

		const sigMan = Apps.getManager().getSignatureManager();
		const appsStorage = Apps.getStorage();

		const apps = await appsStorage.retrieveAll();

		for (const app of apps.values()) {
			if (app.installationSource && app.signature) {
				continue;
			}

			const updatedApp = {
				...app,
				migrated: true,
				installationSource: 'marketplaceInfo' in app ? 'marketplace' : 'private',
			} as IAppStorageItem;

			await appsStorage.updatePartialAndReturnDocument({
				...updatedApp,
				signature: await sigMan.signApp(updatedApp),
			});
		}
	},
});
