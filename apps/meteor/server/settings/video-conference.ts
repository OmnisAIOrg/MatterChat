import { settingsRegistry } from '.';

export const createVConfSettings = () =>
	settingsRegistry.addGroup('Video_Conference', async function () {
		await this.add('VideoConf_Default_Provider', '', {
			type: 'lookup',
			lookupEndpoint: 'v1/video-conference.providers',
			public: true,
		});

		await this.add('VideoConf_Mobile_Ringing', false, {
			type: 'boolean',
			public: true,
			enterprise: true,
			modules: ['videoconference-enterprise'],
			invalidValue: false,
			alert: 'VideoConf_Mobile_Ringing_Alert',
		});

		// MATTERCHAT: re-declared in MIT. These six settings were previously registered only by the
		// EE-only apps/meteor/ee/server/settings/video-conference.ts, but they are read by MIT server
		// code (apps/meteor/server/services/video-conference/service.ts:431-434, :1118, :1143) and by
		// MIT client hooks. Without an MIT declaration, removing the ee/ tree makes settings.get()
		// return undefined and video conferencing silently dies. Same ids/types/public flags/defaults
		// as the EE declarations, minus the enterprise/modules/invalidValue license machinery.
		const discussionsEnabled = { _id: 'Discussion_enabled', value: true };

		await this.add('VideoConf_Enable_DMs', true, {
			type: 'boolean',
			public: true,
		});

		await this.add('VideoConf_Enable_Channels', true, {
			type: 'boolean',
			public: true,
		});

		await this.add('VideoConf_Enable_Groups', true, {
			type: 'boolean',
			public: true,
		});

		await this.add('VideoConf_Enable_Teams', true, {
			type: 'boolean',
			public: true,
		});

		await this.add('VideoConf_Enable_Persistent_Chat', false, {
			type: 'boolean',
			public: true,
			alert: 'VideoConf_Enable_Persistent_Chat_Alert',
			enableQuery: [discussionsEnabled],
		});

		const persistentChatEnabled = { _id: 'VideoConf_Enable_Persistent_Chat', value: true };

		await this.add('VideoConf_Persistent_Chat_Discussion_Name', 'Video Call Chat', {
			type: 'string',
			public: true,
			i18nDescription: 'VideoConf_Persistent_Chat_Discussion_Name_Description',
			enableQuery: [discussionsEnabled, persistentChatEnabled],
		});

		// #ToDo: Those should probably be handled by the apps themselves
		await this.add('Jitsi_Click_To_Join_Count', 0, {
			type: 'int',
			hidden: true,
		});
		await this.add('Jitsi_Start_SlashCommands_Count', 0, {
			type: 'int',
			hidden: true,
		});
	});
