import type { ThemePreference as ThemeMode, Themes, Skins } from '@rocket.chat/core-typings';
import { useDarkMode } from '@rocket.chat/fuselage-hooks';
import { useEndpoint, useUserPreference } from '@rocket.chat/ui-contexts';
import { useCallback, useState } from 'react';

/**
 * MATTERCHAT — every Paper & Sky skin, in picker order. Green first, then the tint
 * family. Adding a tint means adding it here, to `Skins` in core-typings, and to the
 * sky ramps in `PaperSkyStyleTags` — no backend and no new preference key.
 */
export const SKINS: readonly Skins[] = [
	'paper-sky',
	'paper-sky-blue',
	'paper-sky-indigo',
	'paper-sky-amber',
	'paper-sky-rose',
	'paper-sky-graphite',
] as const;

export const isSkin = (value: ThemeMode): value is Skins => (SKINS as readonly string[]).includes(value);

/**
 * Returns the current option set by the user, the theme mode resolved given the user configuration and OS (if applies) and a function to set it.
 *
 * MATTERCHAT: a Paper & Sky skin always resolves to `dark`. Fuselage's own `Themes`
 * union is `light | dark | high-contrast`, so a skin value must never reach
 * `PaletteStyleTag` — resolving to `dark` keeps every core component we have not
 * re-skinned on a coherent palette instead of an unstyled one. Read the skin itself
 * with `useSkin`.
 *
 * @param defaultThemeMode The default theme mode to use if the user has not set any.
 * @returns [currentThemeMode, setThemeMode, resolvedThemeMode]
 */
export const useThemeMode = (): [
	currentThemeMode: ThemeMode,
	setThemeMode: (value: ThemeMode) => () => void,
	resolvedThemeMode: Themes,
] => {
	const themeMode = useUserPreference<ThemeMode>('themeAppearence') || 'auto';

	const saveUserPreferences = useEndpoint('POST', '/v1/users.setPreferences');

	const [updaters] = useState((): Record<ThemeMode, () => ReturnType<typeof saveUserPreferences>> => {
		const set = (themeAppearence: ThemeMode) => () => saveUserPreferences({ data: { themeAppearence } });

		return {
			'light': set('light'),
			'dark': set('dark'),
			'auto': set('auto'),
			'high-contrast': set('high-contrast'),
			'paper-sky': set('paper-sky'),
			'paper-sky-blue': set('paper-sky-blue'),
			'paper-sky-indigo': set('paper-sky-indigo'),
			'paper-sky-amber': set('paper-sky-amber'),
			'paper-sky-rose': set('paper-sky-rose'),
			'paper-sky-graphite': set('paper-sky-graphite'),
		};
	});

	const setTheme = useCallback((value: ThemeMode): (() => void) => updaters[value], [updaters]);

	const useTheme = () => {
		// A skin forces dark. `useDarkMode` is still called unconditionally — it is a hook.
		if (useDarkMode(themeMode === 'auto' ? undefined : themeMode === 'dark' || isSkin(themeMode))) {
			return 'dark';
		}
		if (themeMode === 'high-contrast') {
			return 'high-contrast';
		}
		return 'light';
	};

	return [themeMode, setTheme, useTheme()];
};

/**
 * MATTERCHAT — the active Paper & Sky skin, or `undefined` on a plain colour scheme.
 *
 * This is the switch every Paper & Sky style tag hangs off, and the gate that turns
 * the Variant B skin off. Deliberately reads the preference directly rather than
 * going through `useThemeMode`, so callers that only care about the skin do not pull
 * in the endpoint and updater machinery.
 */
export const useSkin = (): Skins | undefined => {
	const themeMode = useUserPreference<ThemeMode>('themeAppearence') || 'auto';
	return isSkin(themeMode) ? themeMode : undefined;
};

/**
 * MATTERCHAT — light/dark for SURFACE tokens, as opposed to for Fuselage.
 *
 * Use this anywhere a component picks between a light and a dark token set for
 * things it paints itself (`theme === 'dark' ? DARK : LIGHT`). A Paper & Sky skin
 * reports `dark` to `useThemeMode`, because Fuselage's `Themes` union cannot hold a
 * skin — but Paper & Sky's surfaces are warm PAPER, not dark. Branching on the raw
 * theme therefore renders charcoal cards on the green sky, which is precisely how
 * the Matters, Reports and Caseload screens ended up looking untouched by the theme
 * while being, technically, entirely correct.
 *
 * Rule of thumb: `useThemeMode` for anything handed to Fuselage; `useSurfaceMode`
 * for anything you colour yourself.
 */
export const useSurfaceMode = (): Themes => {
	const [, , theme] = useThemeMode();
	const skin = useSkin();
	return skin ? 'light' : theme;
};
