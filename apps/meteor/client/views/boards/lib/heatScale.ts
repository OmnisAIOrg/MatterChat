/**
 * heatScale — THE shared deadline/SOL "heat" color scale for every Boards surface.
 *
 * One urgency semantic (green = on plan / amber = at risk / red = danger) was being
 * expressed by three separate color systems (lib/ledger.ts, lib/ledgerTheme.ts,
 * card/ledgerStyles.tsx) — two of them with a light `#e0a63c` amber that fails
 * contrast on the warm paper ground. This module is the single source of truth:
 * the hex values mirror MainLayoutStyleTags.tsx's `--mc-sol-*` tokens exactly
 * (light amber ~4.9:1 / red ~5.9:1 on the #FAF7EE paper), so chat surface and
 * Boards always agree. Change heat colors HERE and nowhere else.
 *
 * Thresholds (>90d green / ≤90d amber / ≤30d-or-passed red) stay in
 * card/matter/matterFormatters.ts — this module is colors only.
 *
 * FORK-SAFE: new fork-owned file; consumers are all fork-owned components.
 */

export type HeatLevel = 'green' | 'amber' | 'red';

export type HeatColors = Record<HeatLevel, string>;

/** LIGHT theme — inks tuned for the warm paper ground (#FAF7EE / #fffdf6 cards). */
export const HEAT_LIGHT: HeatColors = {
	green: '#1B7A2E', // brand green
	amber: '#B45309', // warm amber, ~4.9:1 on paper
	red: '#C0212E', // docket red, ~5.9:1 on paper
};

/** DARK theme — brightened to read on the calm dense dark surfaces (#12161D / #1A2029). */
export const HEAT_DARK: HeatColors = {
	green: '#3FA85C',
	amber: '#E8A33D',
	red: '#E4586D',
};

/**
 * CSS-var flavor — resolves to the active theme's `--mc-sol-*` tokens (declared
 * in MainLayoutStyleTags.tsx) with the LIGHT values as fallback for the stock
 * high-contrast theme, where the branded palette is absent.
 */
export const HEAT_VARS: HeatColors = {
	green: `var(--mc-sol-green, ${HEAT_LIGHT.green})`,
	amber: `var(--mc-sol-amber, ${HEAT_LIGHT.amber})`,
	red: `var(--mc-sol-red, ${HEAT_LIGHT.red})`,
};

/** Translucent fills for pills/tints — light theme. */
export const HEAT_SOFT_LIGHT: HeatColors = {
	green: 'rgba(27, 122, 46, 0.10)',
	amber: 'rgba(180, 83, 9, 0.12)',
	red: 'rgba(192, 33, 46, 0.10)',
};

/** Translucent fills for pills/tints — dark theme. */
export const HEAT_SOFT_DARK: HeatColors = {
	green: 'rgba(63, 168, 92, 0.14)',
	amber: 'rgba(232, 163, 61, 0.18)',
	red: 'rgba(228, 88, 109, 0.18)',
};

/** The solid scale for a resolved theme flag (dark stays calm dark; high-contrast → light inks). */
export const heatForTheme = (dark: boolean): HeatColors => (dark ? HEAT_DARK : HEAT_LIGHT);
