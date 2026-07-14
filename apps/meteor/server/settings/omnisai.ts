import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for "Sign in with OmnisAI" (CentralizedAuth OIDC login).
 *
 * - OmnisAI_OIDC_Enabled      : master switch. Gates BOTH the login button (public) and the
 *                               server-side /_omnisai/authorize route. Off by default so a
 *                               fresh MatterChat is fully standalone.
 * - OmnisAI_OIDC_Button_Label : the login-screen button text (public).
 *
 * The issuer URL / client id / scope are supplied via env (OMNISAI_OIDC_ISSUER, _CLIENT_ID,
 * _SCOPE) for now — infra-level config the admin sets per environment.
 */
export const createOmnisAIOAuthSettings = () =>
	settingsRegistry.addGroup('OmnisAI', async function () {
		await this.add('OmnisAI_OIDC_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'OmnisAI_OIDC_Enabled',
			i18nDescription: 'OmnisAI_OIDC_Enabled_Description',
		});

		await this.add('OmnisAI_OIDC_Button_Label', 'Sign in with OmnisAI', {
			type: 'string',
			public: true,
			i18nLabel: 'OmnisAI_OIDC_Button_Label',
		});

		// Cross-firm (Omnis Counsel / CFCS) — opt-in, off by default (standalone principle).
		await this.add('CrossFirm_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CrossFirm_Enabled',
			i18nDescription: 'CrossFirm_Enabled_Description',
		});

		await this.add('CrossFirm_CFCS_URL', '', {
			type: 'string',
			public: true,
			i18nLabel: 'CrossFirm_CFCS_URL',
			i18nDescription: 'CrossFirm_CFCS_URL_Description',
		});

		await this.add('CrossFirm_Firm_Name', '', {
			type: 'string',
			public: true,
			i18nLabel: 'CrossFirm_Firm_Name',
			i18nDescription: 'CrossFirm_Firm_Name_Description',
		});
	});
