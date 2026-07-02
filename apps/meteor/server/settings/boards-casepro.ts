import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the CasePro READ CLIENT (M2).
 *
 * - CasePro_Enabled   : master switch the read client honors.
 * - CasePro_Base_URL  : the live CasePro/MCP base URL (only used when transport = rest).
 * - CasePro_Transport : 'stub' (default — mock rows, zero config) or 'rest' (live fetch).
 *
 * Defaulting to the stub means a fresh MatterChat boots and renders a complete
 * MatterSnapshot with no CasePro credentials. Flip to 'rest' + set the base URL
 * once the OIDC/KeyGate auth seam (transport.ts TODO(auth)) is wired.
 *
 * Auth-mode + secret settings (service_key/bearer/cookie) are intentionally NOT
 * added here yet — they land with the auth handshake in a later phase so the
 * secrets don't sit unused.
 */
export const createBoardsCaseProSettings = () =>
	settingsRegistry.addGroup('CasePro', async function () {
		await this.add('CasePro_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CasePro_Enabled',
			i18nDescription: 'CasePro_Enabled_Description',
		});

		await this.add('CasePro_Transport', 'stub', {
			type: 'select',
			public: false,
			i18nLabel: 'CasePro_Transport',
			i18nDescription: 'CasePro_Transport_Description',
			values: [
				{ key: 'stub', i18nLabel: 'CasePro_Transport_Stub' },
				{ key: 'rest', i18nLabel: 'CasePro_Transport_Rest' },
			],
		});

		await this.add('CasePro_Base_URL', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Base_URL',
			i18nDescription: 'CasePro_Base_URL_Description',
			placeholder: 'https://casepro-mcp-v2.stg-omnisai.io',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: 'rest',
			},
		});

		// Comms-log: auto-log matter-linked channels' messages onto the matter's
		// communication history in CasePro. Global kill switch (the per-channel
		// opt-out lives on the room: caseProCommsLog.enabled, channel admin panel).
		// Default ON — but only effective while CasePro_Enabled is also on.
		await this.add('CasePro_Comms_Log_Enabled', true, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CasePro_Comms_Log_Enabled',
			i18nDescription: 'CasePro_Comms_Log_Enabled_Description',
			enableQuery: {
				_id: 'CasePro_Enabled',
				value: true,
			},
		});

		// Where digests are POSTed. The CRM backend can live on a different host
		// than the MCP connector base URL, so this may be an absolute URL
		// (e.g. https://casepro-api.stg-omnisai.io/matterchat-messages/ingest).
		// A bare path is resolved against CasePro_Base_URL.
		await this.add('CasePro_Comms_Log_Ingest_URL', 'matterchat-messages/ingest', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Comms_Log_Ingest_URL',
			i18nDescription: 'CasePro_Comms_Log_Ingest_URL_Description',
			placeholder: 'https://casepro-api.stg-omnisai.io/matterchat-messages/ingest',
			enableQuery: {
				_id: 'CasePro_Comms_Log_Enabled',
				value: true,
			},
		});
	});
