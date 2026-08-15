import { settingsRegistry } from '.';

const pushEnabledWithoutGateway = [
	{
		_id: 'Push_enable',
		value: true,
	},
	{
		_id: 'Push_enable_gateway',
		value: false,
	},
];

export const createPushSettings = () =>
	settingsRegistry.addGroup('Push', async function () {
		await this.add('Push_enable', true, {
			type: 'boolean',
			public: true,
			alert: 'Push_Setting_Requires_Restart_Alert',
		});

		// TODO: Push_UseLegacy should be removed in 8.0.0, as well as Push_gcm_project_number and Push_gcm_api_key
		await this.add('Push_UseLegacy', false, {
			type: 'boolean',
			hidden: true,
			alert: 'Push_Setting_Legacy_Warning',
		});

		await this.add('Push_enable_gateway', true, {
			type: 'boolean',
			alert: 'Push_Setting_Requires_Restart_Alert',
			enableQuery: [
				{
					_id: 'Push_enable',
					value: true,
				},
				{
					_id: 'Register_Server',
					value: true,
				},
				{
					_id: 'Cloud_Service_Agree_PrivacyTerms',
					value: true,
				},
			],
		});
		await this.add('Push_gateway', 'https://gateway.rocket.chat', {
			type: 'string',
			i18nDescription: 'Push_gateway_description',
			alert: 'Push_Setting_Requires_Restart_Alert',
			multiline: true,
			enableQuery: [
				{
					_id: 'Push_enable',
					value: true,
				},
				{
					_id: 'Push_enable_gateway',
					value: true,
				},
			],
		});
		await this.add('Push_production', true, {
			type: 'boolean',
			public: true,
			alert: 'Push_Setting_Requires_Restart_Alert',
			enableQuery: pushEnabledWithoutGateway,
		});
		await this.add('Push_test_push', 'push_test', {
			type: 'action',
			actionText: 'Send_a_test_push_to_my_user',
			enableQuery: {
				_id: 'Push_enable',
				value: true,
			},
		});
		await this.section('Certificates_and_Keys', async function () {
			// MatterChat: token-based (.p8) APNs auth for self-hosted push. Apple's current provider
			// auth mechanism is a `.p8` ES256 key + Key ID + Team ID instead of a cert/key pair.
			// `certificate` is the default so existing deployments keep today's behaviour, and the
			// PUSH_APN_* env vars take precedence over these settings at read time
			// (see server/configuration/pushNotification.ts).
			await this.add('Push_APN_Auth_Type', 'certificate', {
				type: 'select',
				values: [
					{ key: 'certificate', i18nLabel: 'Push_APN_Auth_Type_Certificate' },
					{ key: 'token', i18nLabel: 'Push_APN_Auth_Type_Token' },
				],
				i18nLabel: 'Push_APN_Auth_Type',
				i18nDescription: 'Push_APN_Auth_Type_Description',
				alert: 'Push_Setting_Requires_Restart_Alert',
				enableQuery: pushEnabledWithoutGateway,
			});
			await this.add('Push_APN_Token_Key', '', {
				type: 'string',
				multiline: true,
				secret: true,
				i18nLabel: 'Push_APN_Token_Key',
				i18nDescription: 'Push_APN_Token_Key_Description',
				alert: 'Push_Setting_Requires_Restart_Alert',
				enableQuery: [...pushEnabledWithoutGateway, { _id: 'Push_APN_Auth_Type', value: 'token' }],
			});
			await this.add('Push_APN_Token_Key_ID', '', {
				type: 'string',
				secret: true,
				i18nLabel: 'Push_APN_Token_Key_ID',
				i18nDescription: 'Push_APN_Token_Key_ID_Description',
				alert: 'Push_Setting_Requires_Restart_Alert',
				enableQuery: [...pushEnabledWithoutGateway, { _id: 'Push_APN_Auth_Type', value: 'token' }],
			});
			await this.add('Push_APN_Team_ID', '', {
				type: 'string',
				secret: true,
				i18nLabel: 'Push_APN_Team_ID',
				i18nDescription: 'Push_APN_Team_ID_Description',
				alert: 'Push_Setting_Requires_Restart_Alert',
				enableQuery: [...pushEnabledWithoutGateway, { _id: 'Push_APN_Auth_Type', value: 'token' }],
			});
			await this.add('Push_APN_Bundle_ID', '', {
				type: 'string',
				i18nLabel: 'Push_APN_Bundle_ID',
				i18nDescription: 'Push_APN_Bundle_ID_Description',
				alert: 'Push_Setting_Requires_Restart_Alert',
				enableQuery: pushEnabledWithoutGateway,
			});
			await this.add('Push_apn_passphrase', '', {
				type: 'string',
				enableQuery: [],
				secret: true,
			});
			await this.add('Push_apn_key', '', {
				type: 'string',
				multiline: true,
				enableQuery: [],
				secret: true,
			});
			await this.add('Push_apn_cert', '', {
				type: 'string',
				multiline: true,
				enableQuery: [],
				secret: true,
			});
			await this.add('Push_apn_dev_passphrase', '', {
				type: 'string',
				enableQuery: [],
				secret: true,
			});
			await this.add('Push_apn_dev_key', '', {
				type: 'string',
				multiline: true,
				enableQuery: [],
				secret: true,
			});
			await this.add('Push_apn_dev_cert', '', {
				type: 'string',
				multiline: true,
				enableQuery: [],
				secret: true,
			});
			await this.add('Push_gcm_api_key', '', {
				type: 'string',
				hidden: true,
				enableQuery: [
					{
						_id: 'Push_UseLegacy',
						value: true,
					},
				],
				secret: true,
			});

			await this.add('Push_google_api_credentials', '', {
				type: 'code',
				multiline: true,
				enableQuery: [
					{
						_id: 'Push_UseLegacy',
						value: false,
					},
				],
				secret: true,
			});

			return this.add('Push_gcm_project_number', '', {
				type: 'string',
				hidden: true,
				enableQuery: [
					{
						_id: 'Push_UseLegacy',
						value: true,
					},
				],
				secret: true,
			});
		});
		await this.section('Privacy', async function () {
			await this.add('Push_show_username_room', true, {
				type: 'boolean',
				public: true,
			});
			await this.add('Push_show_message', true, {
				type: 'boolean',
				public: true,
			});
			await this.add('Push_request_content_from_server', true, {
				type: 'boolean',
				enterprise: true,
				invalidValue: false,
				modules: ['push-privacy'],
			});
		});

		// MatterChat Web Push (VAPID) — browser/PWA background push (see spec B.4).
		// Prefer env (WEB_PUSH_VAPID_*) which take precedence in app/web-push/server;
		// these settings are the admin-UI fallback. The PUBLIC key is `public` so the
		// PWA client can read it to subscribe; private key + subject are secret.
		return this.section('WebPush', async function () {
			await this.add('WebPush_VAPID_Public', '', {
				type: 'string',
				public: true,
				i18nLabel: 'WebPush_VAPID_Public',
				i18nDescription: 'WebPush_VAPID_Public_Description',
			});
			await this.add('WebPush_VAPID_Private', '', {
				type: 'string',
				secret: true,
				i18nLabel: 'WebPush_VAPID_Private',
			});
			return this.add('WebPush_Subject', 'mailto:ops@omnisai.io', {
				type: 'string',
				i18nLabel: 'WebPush_Subject',
				i18nDescription: 'WebPush_Subject_Description',
			});
		});
	});
