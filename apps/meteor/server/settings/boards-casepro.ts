import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the CasePro READ CLIENT (M2).
 *
 * - CasePro_Enabled   : master switch the read client honors.
 * - CasePro_Base_URL  : the live CasePro/MCP base URL (only used when transport = rest).
 * - CasePro_Transport : 'stub' (default — mock rows, zero config) or 'rest' (live fetch).
 * - CasePro_Intake_Capture_Base : the CasePro CRM base URL for the PUBLIC intake
 *   capture endpoint (`{base}/api/v1/intake-questionnaires/capture?org=&source=`)
 *   used by boards forms with `intakeRouting:'casepro-direct'`. DISTINCT from
 *   CasePro_Base_URL (the MCP connector base) — the capture lane is auth-less and
 *   points at the CRM backend itself. Must be https; the outbound POST is host-pinned
 *   to this base. Independent of CasePro_Enabled/CasePro_Transport by design: a firm
 *   can route public forms into CasePro without turning on the full board sync.
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

		await this.add('CasePro_Intake_Capture_Base', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Intake_Capture_Base',
			i18nDescription: 'CasePro_Intake_Capture_Base_Description',
			placeholder: 'https://crm.stg-omnisai.io',
		});
	});
