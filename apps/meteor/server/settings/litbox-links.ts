import { settingsRegistry } from '.';

/**
 * LitBox upload-link settings.
 *
 * LitBox is the one product whose integration already exists — the file
 * browser, the `/_litbox` proxy and `LITBOX_API_URL` are all in place — so this
 * group deliberately does NOT register the shared seven connection settings.
 * Only what upload links genuinely add is here.
 *
 * `Litbox_Service_Api_Key` is the one new credential, and it exists for exactly
 * one reason: the existing proxy authenticates with the CALLER'S OWN LitBox
 * credential, which an anonymous uploader does not have. It is used on the
 * upload-link write path and nowhere else.
 */
export const createLitboxLinksSettings = () =>
	settingsRegistry.addGroup('LitBox', async function () {
		await this.add('Litbox_Upload_Links_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Litbox_Upload_Links_Enabled',
			i18nDescription: 'Litbox_Upload_Links_Enabled_Description',
		});

		await this.add('Litbox_Service_Api_Key', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'Litbox_Service_Api_Key',
			i18nDescription: 'Litbox_Service_Api_Key_Description',
			enableQuery: { _id: 'Litbox_Upload_Links_Enabled', value: true },
		});

		await this.add('Litbox_Upload_Link_Default_Expiry_Days', 30, {
			type: 'int',
			public: true,
			i18nLabel: 'Litbox_Upload_Link_Default_Expiry_Days',
			i18nDescription: 'Litbox_Upload_Link_Default_Expiry_Days_Description',
			enableQuery: { _id: 'Litbox_Upload_Links_Enabled', value: true },
		});

		await this.add('Litbox_Upload_Link_Max_File_MB', 50, {
			type: 'int',
			public: true,
			i18nLabel: 'Litbox_Upload_Link_Max_File_MB',
			i18nDescription: 'Litbox_Upload_Link_Max_File_MB_Description',
			enableQuery: { _id: 'Litbox_Upload_Links_Enabled', value: true },
		});

		await this.add('Litbox_Upload_Link_Max_Files', 25, {
			type: 'int',
			public: true,
			i18nLabel: 'Litbox_Upload_Link_Max_Files',
			i18nDescription: 'Litbox_Upload_Link_Max_Files_Description',
			enableQuery: { _id: 'Litbox_Upload_Links_Enabled', value: true },
		});
	});
