import { settingsRegistry } from '.';

/**
 * Settings for "Sign in with OmnisAI" (CentralizedAuth OIDC login).
 *
 * - OmnisAI_OIDC_Enabled      : master switch. Gates BOTH the login button (public) and the
 *                               server-side /_omnisai/authorize route. Off by default so a
 *                               fresh MatterChat is fully standalone.
 * - OmnisAI_OIDC_Button_Label : the login-screen button text (public).
 * - OmnisAI_OIDC_Issuer        : CentralizedAuth issuer base URL (server-only).
 * - OmnisAI_OIDC_Client_Id     : the OIDC client id (server-only).
 * - OmnisAI_OIDC_Client_Secret : shared app secret for strict HS256 id_token signature verification
 *                                (server-only, secret). Empty by default → the id_token verifier stays
 *                                fail-soft (current live behavior). Set it to enforce the signature.
 *                                See app/omnisai-oauth/server/verifyIdToken.ts and DECISIONS.md.
 *
 * Issuer + client id resolve from THESE settings first (seeded per-environment via
 * OVERWRITE_SETTING_OmnisAI_OIDC_Issuer / _Client_Id), then fall back to the env vars
 * OMNISAI_OIDC_ISSUER / _CLIENT_ID. Settings persist in Mongo, so the login keeps working even on a
 * pod whose container env didn't carry the OMNISAI_OIDC_* vars (see app/omnisai-oauth/server/index.ts
 * getConfig). Scope stays env-only (OMNISAI_OIDC_SCOPE) — it always has a safe built-in default.
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

		// Server-only OIDC endpoint config. Seeded per-environment via OVERWRITE_SETTING_* and read by
		// getConfig (settings first, env fallback). Not public — only the server redirect dance needs them.
		await this.add('OmnisAI_OIDC_Issuer', '', {
			type: 'string',
			public: false,
			i18nLabel: 'OmnisAI_OIDC_Issuer',
			i18nDescription: 'OmnisAI_OIDC_Issuer_Description',
		});

		await this.add('OmnisAI_OIDC_Client_Id', '', {
			type: 'string',
			public: false,
			i18nLabel: 'OmnisAI_OIDC_Client_Id',
			i18nDescription: 'OmnisAI_OIDC_Client_Id_Description',
		});

		// Shared app secret for strict HS256 id_token signature verification. Empty by default → the
		// verifier stays fail-soft (current live behavior). Not public; marked secret so it is redacted.
		await this.add('OmnisAI_OIDC_Client_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'OmnisAI_OIDC_Client_Secret',
			i18nDescription: 'OmnisAI_OIDC_Client_Secret_Description',
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

		// Self-serve firms (public signup → create firm → invite teammates).
		// Off by default; enabled per-deployment via OVERWRITE_SETTING_*.
		await this.add('Firms_SelfServe_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Firms_SelfServe_Enabled',
			i18nDescription: 'Firms_SelfServe_Enabled_Description',
		});

		// When self-serve is on, scope the user directory / search surfaces so
		// members of one firm cannot enumerate members of another.
		await this.add('Firms_Scoped_Directory', true, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Firms_Scoped_Directory',
			i18nDescription: 'Firms_Scoped_Directory_Description',
		});
	});
