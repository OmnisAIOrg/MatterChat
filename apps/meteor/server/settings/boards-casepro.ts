import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the CasePro integration (M2 read client + live wire).
 *
 * - CasePro_Enabled   : master switch the read client + write-through sync honor.
 * - CasePro_Transport : 'stub' (default — mock rows, zero config) or 'rest' (live MCP gateway).
 * - CasePro_Base_URL  : the live casepro-mcp-v2 gateway base URL (transport = rest only).
 * - CasePro_Auth_Mode : 'mcp-key' (route A — X-MCP-API-Key header, the deployed gateway's
 *                       auth) or 'keygate' (route B — declared STUB; falls back to the stub
 *                       transport until the KeyGate handshake lands).
 * - CasePro_Org_ID    : the X-Organization-ID scope; env CASEPRO_ORG_ID overrides.
 * - CasePro_Web_URL   : the CasePro WEB APP base URL for "Open in CasePro" deep links
 *                       (empty = links hidden). This is the human UI, not the gateway.
 *
 * SECRETS ARE NEVER SETTINGS: the MCP API key comes exclusively from env
 * `CASEPRO_MCP_API_KEY` (sealed secret in the deploy). With transport = rest and no
 * key, the transport refuses and serves the stub with a loud warning — it never
 * sends an unauthenticated request.
 *
 * Defaulting to the stub means a fresh MatterChat boots and renders a complete
 * MatterSnapshot with no CasePro credentials.
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

		await this.add('CasePro_Auth_Mode', 'mcp-key', {
			type: 'select',
			public: false,
			i18nLabel: 'CasePro_Auth_Mode',
			i18nDescription: 'CasePro_Auth_Mode_Description',
			values: [
				{ key: 'mcp-key', i18nLabel: 'CasePro_Auth_Mode_McpKey' },
				{ key: 'keygate', i18nLabel: 'CasePro_Auth_Mode_KeyGate' },
			],
			enableQuery: {
				_id: 'CasePro_Transport',
				value: 'rest',
			},
		});

		await this.add('CasePro_Org_ID', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Org_ID',
			i18nDescription: 'CasePro_Org_ID_Description',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: 'rest',
			},
		});

		await this.add('CasePro_Web_URL', '', {
			type: 'string',
			public: true,
			i18nLabel: 'CasePro_Web_URL',
			i18nDescription: 'CasePro_Web_URL_Description',
			placeholder: 'https://casepro.stg-omnisai.io',
		});
	});
