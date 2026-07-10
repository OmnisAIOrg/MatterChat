import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the CasePro READ CLIENT (M2) + live transports.
 *
 * - CasePro_Enabled   : master switch the read client honors (public — the client
 *                       banner logic needs it).
 * - CasePro_Transport : 'stub' (default — mock rows, zero config), 'native'
 *                       (direct REST against CasePro), or 'mcp' (the CasePro MCP
 *                       endpoint). Public so the client can tell stub vs live;
 *                       the value itself is not a secret.
 * - CasePro_Base_URL  : the live CasePro base URL (only used when transport != stub).
 * - CasePro_Auth_Mode : 'internal-key' (service-key header) or 'bearer' (bearer token).
 * - CasePro_Api_Key   : the secret credential for whichever auth mode is selected.
 * - CasePro_Org_Id    : the CasePro organization every read/write is scoped to.
 * - CasePro_Mcp_Path  : path of the MCP endpoint on the base URL (mcp transport only).
 * - CasePro_Snapshot_Refresh_Interval : minutes between snapshot refreshes
 *                       (default 30; consumers clamp to a minimum of 5).
 *
 * Defaulting to the stub means a fresh MatterChat boots and renders a complete
 * MatterSnapshot with no CasePro credentials. Flip the transport to 'native' or
 * 'mcp' + set the base URL / auth settings to go live.
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
			public: true,
			i18nLabel: 'CasePro_Transport',
			i18nDescription: 'CasePro_Transport_Description',
			values: [
				{ key: 'stub', i18nLabel: 'CasePro_Transport_Stub' },
				{ key: 'native', i18nLabel: 'CasePro_Transport_Native' },
				{ key: 'mcp', i18nLabel: 'CasePro_Transport_Mcp' },
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
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Auth_Mode', 'internal-key', {
			type: 'select',
			public: false,
			i18nLabel: 'CasePro_Auth_Mode',
			i18nDescription: 'CasePro_Auth_Mode_Description',
			values: [
				{ key: 'internal-key', i18nLabel: 'CasePro_Auth_Mode_Internal_Key' },
				{ key: 'bearer', i18nLabel: 'CasePro_Auth_Mode_Bearer' },
			],
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Api_Key', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'CasePro_Api_Key',
			i18nDescription: 'CasePro_Api_Key_Description',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Org_Id', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Org_Id',
			i18nDescription: 'CasePro_Org_Id_Description',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Mcp_Path', '/mcp/v2', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Mcp_Path',
			i18nDescription: 'CasePro_Mcp_Path_Description',
			placeholder: '/mcp/v2',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: 'mcp',
			},
		});

		await this.add('CasePro_Snapshot_Refresh_Interval', 30, {
			type: 'int',
			public: false,
			i18nLabel: 'CasePro_Snapshot_Refresh_Interval',
			i18nDescription: 'CasePro_Snapshot_Refresh_Interval_Description',
		});
	});
