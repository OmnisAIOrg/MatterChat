export type Themes = 'light' | 'dark' | 'high-contrast';

/**
 * MATTERCHAT — Paper & Sky skins.
 *
 * A skin is a different axis from a colour scheme: it changes material, shape and
 * typography, not only palette. It rides on the same `themeAppearence` preference
 * because the server stores that value as a free-form string — `{ type: 'string' }`
 * in the REST schema and `Match.Optional(String)` in the Meteor method — so adding
 * skins needs no backend change and syncs across web, PWA and desktop for free.
 *
 * Each value carries its sky tint. The green default is the bare `paper-sky`, so
 * that value stays stable if the tint set ever changes.
 *
 * Paper & Sky has no light/dark variant: its four sky states replace that axis.
 * A user who wants a colour scheme picks `light`, `dark`, `auto` or `high-contrast`
 * and gets the Variant B world instead.
 *
 * Skins must never reach Fuselage's `PaletteStyleTag`, whose own `Themes` union is
 * `light | dark | high-contrast`. `useThemeMode` resolves every skin to `dark`, so
 * any core component we have not re-skinned falls back to a coherent dark palette
 * rather than an unstyled one.
 */
export type Skins = 'paper-sky' | 'paper-sky-blue' | 'paper-sky-indigo' | 'paper-sky-amber' | 'paper-sky-rose' | 'paper-sky-graphite';

export type ThemePreference = Themes | Skins | 'auto';
