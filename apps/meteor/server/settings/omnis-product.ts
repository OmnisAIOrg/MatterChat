import type { ISetting, SettingValue } from '@rocket.chat/core-typings';

/**
 * The seven settings every Omnis product integration registers, in one place.
 *
 * Mirrors the CasePro group (`server/settings/boards-casepro.ts`) so the admin
 * screen reads consistently across products, and so the resolver in
 * `server/lib/omnis/config.ts` has exactly one setting-id convention to honour.
 *
 * **`stub` is the default, deliberately.** It serves representative rows with
 * zero configuration, so the entire feature — widget, panels, actions, receipts
 * — is reviewable before a single credential exists, and QA gets a
 * deterministic fixture. `<Product>_Transport` is public so the client can tell
 * stub from live and show its `DEMO DATA` tag; the value itself is not a secret.
 */

/** The `this` context inside a `settingsRegistry.addGroup` / `.section` callback. */
export type OmnisSettingAdder = {
	add(id: string, value: SettingValue, options: Partial<ISetting>): Promise<void>;
};

export type OmnisProductSettingsOptions = {
	/** Setting-id prefix, e.g. `AutoDoc` → `AutoDoc_Enabled`. */
	product: string;
	/** Shown in the admin UI as the base-URL placeholder. */
	baseUrlPlaceholder?: string;
	/** Shown in the admin UI as the web-URL placeholder. */
	webUrlPlaceholder?: string;
};

export async function addOmnisConnectionSettings(ctx: OmnisSettingAdder, options: OmnisProductSettingsOptions): Promise<void> {
	const { product } = options;
	const liveOnly = { _id: `${product}_Transport`, value: 'native' };

	// Master switch. Public: the client gates the entire widget on it.
	await ctx.add(`${product}_Enabled`, false, {
		type: 'boolean',
		public: true,
		i18nLabel: `${product}_Enabled`,
		i18nDescription: `${product}_Enabled_Description`,
	});

	// Public so the client can show DEMO DATA when serving fixtures.
	await ctx.add(`${product}_Transport`, 'stub', {
		type: 'select',
		public: true,
		i18nLabel: `${product}_Transport`,
		i18nDescription: `${product}_Transport_Description`,
		values: [
			{ key: 'stub', i18nLabel: 'Omnis_Transport_Stub' },
			{ key: 'native', i18nLabel: 'Omnis_Transport_Native' },
		],
	});

	await ctx.add(`${product}_Base_URL`, '', {
		type: 'string',
		public: false,
		i18nLabel: `${product}_Base_URL`,
		i18nDescription: `${product}_Base_URL_Description`,
		...(options.baseUrlPlaceholder ? { placeholder: options.baseUrlPlaceholder } : {}),
		enableQuery: liveOnly,
	});

	await ctx.add(`${product}_Auth_Mode`, 'internal-key', {
		type: 'select',
		public: false,
		i18nLabel: `${product}_Auth_Mode`,
		i18nDescription: `${product}_Auth_Mode_Description`,
		values: [
			{ key: 'internal-key', i18nLabel: 'Omnis_Auth_Mode_Internal_Key' },
			{ key: 'bearer', i18nLabel: 'Omnis_Auth_Mode_Bearer' },
		],
		enableQuery: liveOnly,
	});

	await ctx.add(`${product}_Api_Key`, '', {
		type: 'string',
		public: false,
		secret: true,
		i18nLabel: `${product}_Api_Key`,
		i18nDescription: `${product}_Api_Key_Description`,
		enableQuery: liveOnly,
	});

	await ctx.add(`${product}_Org_Id`, '', {
		type: 'string',
		public: false,
		i18nLabel: `${product}_Org_Id`,
		i18nDescription: `${product}_Org_Id_Description`,
		enableQuery: liveOnly,
	});

	// Public: the client hides "Open in <product>" links when this is empty.
	await ctx.add(`${product}_Web_URL`, '', {
		type: 'string',
		public: true,
		i18nLabel: `${product}_Web_URL`,
		i18nDescription: `${product}_Web_URL_Description`,
		...(options.webUrlPlaceholder ? { placeholder: options.webUrlPlaceholder } : {}),
	});
}
