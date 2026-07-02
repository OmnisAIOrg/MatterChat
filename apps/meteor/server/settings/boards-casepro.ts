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

		// -------------------------------------------------------------------------
		// CasePro CLIENT-message two-way sync (client↔firm portal thread → a per-matter
		// "Client" channel, distinct from the internal matter channel). Gated OFF by
		// default until a firm configures it; the sync engine is inert while OFF.
		// Reads/writes to CasePro `client_messages` use the CasePro service endpoint
		// (GET/POST /service/matters/:id/client-messages) via the SAME REST transport +
		// service auth the casepro-live-wire lane wires (transport.authHeaders seam —
		// this lane does NOT touch that auth internal).
		// -------------------------------------------------------------------------
		await this.add('CasePro_Client_Sync_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CasePro_Client_Sync_Enabled',
			i18nDescription: 'CasePro_Client_Sync_Enabled_Description',
			enableQuery: {
				_id: 'CasePro_Enabled',
				value: true,
			},
		});

		// The service base URL for the CasePro CRM backend (the `/service/*` endpoints
		// live on the CRM API, NOT the MCP connector). Blank => falls back to CasePro_Base_URL.
		await this.add('CasePro_Client_Sync_API_URL', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Client_Sync_API_URL',
			i18nDescription: 'CasePro_Client_Sync_API_URL_Description',
			placeholder: 'https://crm-app.stg-omnisai.io/api/v1',
			enableQuery: {
				_id: 'CasePro_Client_Sync_Enabled',
				value: true,
			},
		});

		// Inbound poll cadence (cron string). Default: every minute. The outbound leg is
		// event-driven (afterSaveMessage), so this only paces the client→firm ingest.
		await this.add('CasePro_Client_Sync_Poll_Schedule', '* * * * *', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Client_Sync_Poll_Schedule',
			i18nDescription: 'CasePro_Client_Sync_Poll_Schedule_Description',
			enableQuery: {
				_id: 'CasePro_Client_Sync_Enabled',
				value: true,
			},
		});
	});
