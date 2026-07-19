import { PaletteStyleTag } from '@rocket.chat/fuselage';
import { useThemeMode } from '@rocket.chat/ui-client';
import { useEffect } from 'react';

import { codeBlock } from '../lib/codeBlockStyles';

/**
 * GREEN "Variant B" — Electron titlebar drag region.
 *
 * The desktop app uses a hidden-inset titlebar (the macOS traffic lights sit INSIDE the dark global
 * NavBar). For the user to drag the window by that dark bar, the NavBar container must be a drag region
 * and its interactive children must opt OUT, or you couldn't click them. The NavBar is a Fuselage
 * component (`.rcx-navbar`) we don't own, so we set this with a tiny global rule rather than threading a
 * className prop. `app-region` is a no-op in a normal browser (it only does anything in the Electron
 * frameless window), so this is inert on the web/PWA and only activates in the desktop shell. We set
 * both the standard and `-webkit-` forms for Chromium/Electron coverage.
 */
const NAVBAR_DRAG_REGION_CSS = `
.rcx-navbar {
	-webkit-app-region: drag;
	app-region: drag;
}
.rcx-navbar button,
.rcx-navbar a,
.rcx-navbar input,
.rcx-navbar [role='button'],
.rcx-navbar [role='search'],
.rcx-navbar [role='combobox'],
.rcx-navbar [tabindex] {
	-webkit-app-region: no-drag;
	app-region: no-drag;
}
`;

/**
 * GREEN "Variant B" — the floating rounded-window frame.
 *
 * This styles ONLY the three containers that sit ABOVE the React app layout — <html>, <body>, and
 * #react-root — so it never touches #rocket-chat or the app's flex/height chain. That distinction is
 * the whole ballgame: an earlier attempt put the frame ON #rocket-chat (inside the flex layout) and
 * collapsed the entire shell to blank. Framing the mount point instead leaves the app's internal
 * layout completely intact (verified live in-browser before shipping — all regions measured full-height).
 *
 * Layout: <body> becomes the rounded GREEN card (8px from the viewport, rounded, the green gradient),
 * floating on a near-black backdrop (<html>); #react-root is the rounded dark APP window pinned 14px
 * inside the green. 100vh/100vw make it adapt automatically to the PWA standalone window and the
 * Electron desktop frame. Fixed-position overlays (modals/toasts/menus) escape the body clip because
 * <body> has no transform, so they still render over the whole window.
 */
const MATTERCHAT_FRAME_CSS = `
html {
	background: #0C0F14 !important;
}
body {
	position: relative !important;
	margin: 8px !important;
	width: calc(100vw - 16px) !important;
	height: calc(100vh - 16px) !important;
	box-sizing: border-box !important;
	overflow: hidden !important;
	border-radius: 22px !important;
	background: linear-gradient(165deg, #2fa251 0%, #1f8a3a 55%, #176b2c 100%) !important;
	background-attachment: fixed !important;
	box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55) !important;
}
#react-root {
	position: absolute !important;
	inset: 14px !important;
	width: auto !important;
	height: auto !important;
	overflow: hidden !important;
	border-radius: 15px !important;
	background: #1A212C !important;
	box-shadow: 0 1px 0 rgba(255, 255, 255, 0.10) inset, 0 0 0 1px rgba(0, 0, 0, 0.22) !important;
}
/* MATTERCHAT: on phones the floating-window frame costs 44px of width (8px body margin +
   14px react-root inset per side) — go full-bleed edge-to-edge below the md breakpoint.
   100dvh (with 100vh fallback above it) tracks iOS Safari's collapsing toolbar. */
@media (max-width: 767.98px) {
	body {
		margin: 0 !important;
		width: 100vw !important;
		height: 100vh !important;
		height: 100dvh !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}
	#react-root {
		inset: 0 !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}
}
/* DESKTOP APP (Electron): the floating green card is a web/PWA nicety that CLASHES with the native
   window chrome — it insets the app ~22px so the macOS traffic lights (fixed at 16,16 by the wrapper)
   land in the green border instead of on the NavBar. Go full-bleed so the OS window is the only frame
   and the NavBar reaches the top-left. body.mc-desktop-app is toggled from JS (matterchatDesktop). */
body.mc-desktop-app {
	margin: 0 !important;
	width: 100vw !important;
	height: 100vh !important;
	border-radius: 0 !important;
	box-shadow: none !important;
	background: #1A212C !important;
}
body.mc-desktop-app #react-root {
	inset: 0 !important;
	border-radius: 0 !important;
	box-shadow: none !important;
}
/* macOS only (hidden-inset traffic lights sit top-LEFT): reserve room so the NavBar's leftmost
   controls don't sit under the lights. Win/Linux use a right-side titleBarOverlay → no left pad. */
body.mc-desktop-mac .rcx-navbar {
	padding-left: 82px !important;
}
`;

/**
 * ============================================================================
 * "LEDGER-DENSE" — the MatterChat brand skin for the CHAT SURFACE (Wave 2).
 * ============================================================================
 *
 * Goal: a legal-pad / docket look — warm ruled paper in light, a calm dense dark surface in dark —
 * with brand GREEN reserved as the ACTION color (links, focus, mentions, primary/send controls).
 *
 * HOW THIS STAYS FORK-SAFE (no core component edits — token/CSS-var + scoped-CSS only, all in THIS file):
 *   1. A custom `PaletteStyleTag` (the codeBlock precedent) that overrides a handful of `--rcx-color-*`
 *      design tokens scoped to `.rcx-content--main`. Fuselage renders every accent (links, focus rings,
 *      primary buttons, selection, the room background) from these tokens, so re-pointing them re-brands
 *      those accents everywhere on the chat surface without touching a single component.
 *   2. A small scoped raw-CSS `<style>` for the ledger specifics tokens don't express: the ruled-paper
 *      texture, the serif "case caption" room title, the left-rail message cards, the density tighten,
 *      and the green typing indicator.
 *
 * SCOPING NOTE — `.rcx-content--main` is added to <body> (AppLayout.tsx), so these `--rcx-color-*` vars
 * inherit app-wide via CSS custom-property inheritance. That is fine and intentional: the sidebar
 * (`.rcx-sidebar--main`/`.rcx-sidepanel`/`.rcx-navbar`) and modals/menus (`.rcx-tile`) each re-declare
 * the FULL palette on their own roots (see the two PaletteStyleTags below), which SHADOWS our body-level
 * overrides inside those subtrees. Net effect: the brand lands on the room (header + message list +
 * composer) and other main-content screens, while the shell chrome and popovers stay stock.
 *
 * High-contrast is left entirely stock (accessibility theme) — see `branded` gate in the component.
 *
 * `.rcx-*` CLASSES WE LEAN ON (could rename on a Rocket.Chat/Fuselage upgrade — re-verify then):
 *   - `.rcx-content--main`            body-level scope for the palette (same as base + codeBlock tags).
 *   - `.rcx-room-header` + its `h1`   room "case caption" title (RC itself queries this class by name).
 *   - `.messages-list`               the message-list <ul> (RC template class, not a Fuselage class).
 *   - `.rcx-message[data-own]`        per-message row + own/other marker (data-own set in RoomMessage).
 *   - `.rcx-message--sequential`      grouped follow-on messages (density).
 *   - `.rcx-message-header__{username,time}`  metadata sizing.
 *   - `.rc-message-box__activity-wrapper`     the "X is typing" status text (legacy `rc-` class).
 *   - `--rcx-message-highlight-colors-background-critical-color`  the @you mention chip fill.
 */

type LedgerTokens = {
	// palette tokens
	surfaceRoom: string;
	link: string;
	strokeHighlight: string;
	strokeExtraLightHighlight: string;
	shadowHighlight: string;
	surfaceSelected: string;
	// ledger raw-css accents
	cardOwnBg: string;
	cardOtherBg: string;
	railOwn: string;
	railOther: string;
	mentionYouBg: string;
	typing: string;
	// paper texture (light only; empty in dark for a calm flat surface)
	ruledLines: string;
	// ---- app-wide ledger custom properties (Wave 2b) ----
	// Consumed as `var(--mc-*)` by the fork-owned screens (My Day / Boards / Matter
	// Workspace / LitBox Files) via client/views/boards/lib/ledger.ts. Values REUSE the
	// chat-surface palette above — one language, no drift. `--mc-ledger-card`/`-tint`
	// are the SOLID equivalents of the (translucent) message-card tints.
	appPaper: string; // page ground (= surfaceRoom)
	appCard: string; // paper card face (#fffdf6 / #1A2029)
	appCardTint: string; // warm tinted card (#f2efe2 / #182420)
	appRule: string; // khaki (light) / slate (dark) hairline (= railOther)
	appAccent: string; // green ACTION accent, theme-corrected (= link)
	solGreen: string; // SOL heat >90d
	solAmber: string; // SOL heat ≤90d
	solRed: string; // SOL heat ≤30d / passed
};

// Brand green stays the ACTION color in both themes. White labels keep >= 5.4:1 on this fill.
const BRAND = { default: '#1B7A2E', hover: '#176B2C', press: '#125A24' } as const;

const LIGHT_LEDGER: LedgerTokens = {
	surfaceRoom: '#FAF7EE', // warm paper
	link: '#15692A', // darker green — ~6.8:1 on paper
	strokeHighlight: '#1B7A2E',
	strokeExtraLightHighlight: '#C8E7CF',
	shadowHighlight: '#D6EFDC', // soft green focus halo (mirrors stock blue #d1ebfe)
	surfaceSelected: '#E4F3E8',
	cardOtherBg: 'rgba(255, 253, 246, 0.72)', // #fffdf6, translucent so ruled lines read through
	cardOwnBg: 'rgba(243, 239, 224, 0.82)', // #f2efe2 warm tint
	railOther: '#C9BE9A', // warm khaki
	railOwn: '#1B7A2E', // brand green
	mentionYouBg: '#1B7A2E',
	typing: '#1B7A2E',
	ruledLines: `repeating-linear-gradient(
		to bottom,
		transparent 0,
		transparent 27px,
		rgba(150, 130, 80, 0.09) 27px,
		rgba(150, 130, 80, 0.09) 28px
	)`,
	appPaper: '#FAF7EE', // = surfaceRoom
	appCard: '#FFFDF6', // solid cardOtherBg
	appCardTint: '#F2EFE2', // solid cardOwnBg
	appRule: '#C9BE9A', // = railOther (warm khaki)
	appAccent: '#15692A', // = link (~6.8:1 on paper)
	solGreen: '#1B7A2E', // brand green
	solAmber: '#B45309', // warm amber, ~4.9:1 on paper
	solRed: '#C0212E', // docket red, ~5.9:1 on paper
};

const DARK_LEDGER: LedgerTokens = {
	surfaceRoom: '#12161D', // calm dense dark surface (NOT inverted paper)
	link: '#5BD07E', // bright green — ~8:1 on the dark surface
	strokeHighlight: '#43B15F',
	strokeExtraLightHighlight: '#2C5638',
	shadowHighlight: 'rgba(67, 177, 95, 0.28)',
	surfaceSelected: '#24352A',
	cardOtherBg: '#1A2029',
	cardOwnBg: '#182420', // faint green-shifted dark card
	railOther: '#3A414D', // slate
	railOwn: '#3FA85C', // green
	mentionYouBg: '#1B7A2E',
	typing: '#7FD79A',
	ruledLines: 'none', // dark = flat, no paper texture
	appPaper: '#12161D', // = surfaceRoom (calm dense dark, never inverted paper)
	appCard: '#1A2029', // = cardOtherBg
	appCardTint: '#182420', // = cardOwnBg
	appRule: '#3A414D', // = railOther (slate)
	appAccent: '#5BD07E', // = link (~8:1 on the dark surface)
	solGreen: '#3FA85C', // = railOwn — reads on dark cards
	solAmber: '#E8A33D',
	solRed: '#E4586D',
};

/**
 * Custom palette string (passed as `palette=` to PaletteStyleTag, mirroring codeBlock). Only the handful
 * of accent + surface tokens we intend to re-brand — everything else falls through to the base theme tag.
 */
const buildLedgerPalette = (t: LedgerTokens): string => `.rcx-content--main {
	--rcx-color-surface-room: ${t.surfaceRoom};
	--rcx-color-font-info: ${t.link};
	--rcx-color-stroke-highlight: ${t.strokeHighlight};
	--rcx-color-stroke-extra-light-highlight: ${t.strokeExtraLightHighlight};
	--rcx-color-shadow-highlight: ${t.shadowHighlight};
	--rcx-color-surface-selected: ${t.surfaceSelected};
	--rcx-color-button-background-primary-default: ${BRAND.default};
	--rcx-color-button-background-primary-hover: ${BRAND.hover};
	--rcx-color-button-background-primary-press: ${BRAND.press};
	--rcx-color-button-background-primary-focus: ${BRAND.default};
	--rcx-color-button-background-primary-keyfocus: ${BRAND.default};
	--mc-ledger-paper: ${t.appPaper};
	--mc-ledger-card: ${t.appCard};
	--mc-ledger-card-tint: ${t.appCardTint};
	--mc-ledger-rule: ${t.appRule};
	--mc-ledger-accent: ${t.appAccent};
	--mc-sol-green: ${t.solGreen};
	--mc-sol-amber: ${t.solAmber};
	--mc-sol-red: ${t.solRed};
}`;

/*
 * LOGIN SCREEN — deliberately NOT styled from here (Wave 2b decision, kept as a comment so
 * the next person doesn't re-attempt it): this component mounts inside LayoutWithSidebar,
 * which only renders in the LOGGED-IN chain (AuthenticationCheck → LoggedInArea →
 * TwoFactorAuthSetupCheck → LayoutWithSidebar). The logged-out login route renders
 * LoginPage → RegistrationRoute straight from the @rocket.chat/web-ui-registration package,
 * with NO fork-owned component in that tree — so a scoped CSS block here can never reach it,
 * and reaching it would require editing a core RC file (AppLayout/LoginPage), which the
 * fork-discipline guide reserves for last resorts. Revisit only as a marked one-line
 * core mount of a fork-owned style tag if the founder asks for the login skin explicitly.
 */

/**
 * Ledger raw CSS — the paper texture, serif caption title, left-rail message cards, density tighten,
 * the @you mention chip, and the green typing text. Composer focus ring + active Send icon are already
 * green via the palette tokens above (the composer border reads `--rcx-color-stroke-highlight` / halo
 * `--rcx-color-shadow-highlight`, and the active Send icon is an `info` button reading
 * `--rcx-color-font-info`), so they need no extra rule here.
 */
const buildLedgerCss = (t: LedgerTokens): string => `
/* Faint ruled paper behind the message list (light only; 'none' in dark). Left rails use inset
   box-shadow instead of a real border so nothing shifts the flex layout / avatar alignment. */
.rcx-content--main .messages-list {
	background-image: ${t.ruledLines};
}

/* "Case caption" — the room title only (an <h1> inside the header). Body/message text stays sans. */
.rcx-content--main .rcx-room-header h1 {
	font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
	font-weight: 600;
	letter-spacing: 0.005em;
}

/* Message cards with a 3px brand-green (own) / khaki-or-slate (other) left rail. Translucent card in
   light lets the ruled lines read through; solid card in dark sits on the dark surface. The rail is
   an inset box-shadow (no layout shift, avatars stay aligned) and stays on through every state; the
   card tint YIELDS to Fuselage's own selected/editing/highlight message backgrounds. */
.rcx-content--main .rcx-message[data-own='true'] {
	box-shadow: inset 3px 0 0 0 ${t.railOwn};
}
.rcx-content--main .rcx-message[data-own='false'] {
	box-shadow: inset 3px 0 0 0 ${t.railOther};
}
.rcx-content--main .rcx-message[data-own='true']:not(.rcx-message--selected):not(.rcx-message--editing):not(.rcx-message--highlight) {
	background-color: ${t.cardOwnBg};
}
.rcx-content--main .rcx-message[data-own='false']:not(.rcx-message--selected):not(.rcx-message--editing):not(.rcx-message--highlight) {
	background-color: ${t.cardOtherBg};
}

/* @you mention chip -> brand green, white label (Fuselage component var, inherited from the surface). */
.rcx-content--main {
	--rcx-message-highlight-colors-background-critical-color: ${t.mentionYouBg};
}

/* DENSITY: ~20-25% tighter message padding + closer metadata so more conversation fits in view.
   Defaults were .5rem/.25rem (message), .25rem (sequential), .125rem (header margins). */
.rcx-content--main .rcx-message {
	padding-top: 0.375rem;
	padding-bottom: 0.1875rem;
}
.rcx-content--main .rcx-message--sequential {
	padding-top: 0.1875rem;
	padding-bottom: 0.1875rem;
}
.rcx-content--main .rcx-message-header {
	margin-top: 0.0625rem;
	margin-bottom: 0.0625rem;
}
.rcx-content--main .rcx-message-header__username {
	font-size: 0.8125rem;
}
.rcx-content--main .rcx-message-header__time {
	font-size: 0.6875rem;
}

/* Typing/activity indicator ("X is typing") in brand green. (RC renders this as text, not dots.) */
.rcx-content--main .rc-message-box__activity-wrapper {
	color: ${t.typing};
}
`;

/**
 * PREMIUM REFRESH — wave3 chat surface styling (Chat.dc.html design)
 *
 * New high-fidelity token set for the premium-refresh design:
 * - Geist typography (already wired)
 * - Precise color palette with light/dark variants
 * - Refined spacing, shadows, and radius values
 * - Message list with day dividers and hover actions
 * - Frosted-glass headers and refined composer
 */

type PremiumRefreshTokens = {
	// Neutrals
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	border2: string;
	ink: string;
	ink2: string;
	ink3: string;
	// Primary green
	green: string;
	green2: string;
	greenSoft: string;
	greenLine: string;
	greenInk: string;
	onGreen: string;
	// Status colors
	red: string;
	redSoft: string;
	redLine: string;
	amber: string;
	amberSoft: string;
	amberLine: string;
	blue: string;
	blueSoft: string;
	blueLine: string;
	// Rail (dark sidebar) colors
	railBg: string;
	railBg2: string;
	railInk: string;
	railInk2: string;
	railLine: string;
	railHover: string;
	// Effects
	shadow1: string;
	shadow2: string;
	shadow3: string;
	bgGlass: string;
};

const LIGHT_PREMIUM: PremiumRefreshTokens = {
	bg: '#F6F6F3',
	surface: '#FFFFFF',
	surface2: '#FAFAF7',
	border: '#E7E6E0',
	border2: '#DBDAD3',
	ink: '#171D19',
	ink2: '#57615B',
	ink3: '#8E968F',
	green: '#17804D',
	green2: '#0F6A3D',
	greenSoft: '#E8F3ED',
	greenLine: '#CBE5D6',
	greenInk: '#116240',
	onGreen: '#FFFFFF',
	red: '#CF4438',
	redSoft: '#FBECEA',
	redLine: '#F2CFCB',
	amber: '#A97A18',
	amberSoft: '#F8F0DF',
	amberLine: '#EBD9B4',
	blue: '#3C6EB4',
	blueSoft: '#EAF1F9',
	blueLine: '#CDDDF0',
	railBg: '#0D1310',
	railBg2: '#111814',
	railInk: '#AEB8B1',
	railInk2: '#6E7A73',
	railLine: '#1F2823',
	railHover: '#1A231E',
	shadow1: '0 1px 2px rgba(23,29,25,.05),0 1px 3px rgba(23,29,25,.04)',
	shadow2: '0 1px 2px rgba(23,29,25,.05),0 8px 24px -8px rgba(23,29,25,.14)',
	shadow3: '0 2px 6px rgba(23,29,25,.06),0 24px 60px -12px rgba(23,29,25,.25)',
	bgGlass: 'rgba(246,246,243,.82)',
};

const DARK_PREMIUM: PremiumRefreshTokens = {
	bg: '#0F1512',
	surface: '#151C17',
	surface2: '#19211C',
	border: '#242D27',
	border2: '#2D372F',
	ink: '#E9EDEA',
	ink2: '#A2ACA5',
	ink3: '#707B74',
	green: '#3FBC7C',
	green2: '#57CD90',
	greenSoft: '#152A1E',
	greenLine: '#265C3F',
	greenInk: '#6FD6A3',
	onGreen: '#08130D',
	red: '#E0685D',
	redSoft: '#32201D',
	redLine: '#5C332D',
	amber: '#D3A24A',
	amberSoft: '#2E2717',
	amberLine: '#5A4A24',
	blue: '#7AA3D8',
	blueSoft: '#1B2532',
	blueLine: '#324B69',
	railBg: '#0B100D',
	railBg2: '#0F1511',
	railInk: '#AEB8B1',
	railInk2: '#69746D',
	railLine: '#1D2620',
	railHover: '#18201B',
	shadow1: '0 1px 2px rgba(0,0,0,.35)',
	shadow2: '0 1px 2px rgba(0,0,0,.4),0 10px 28px -8px rgba(0,0,0,.5)',
	shadow3: '0 2px 6px rgba(0,0,0,.4),0 24px 60px -12px rgba(0,0,0,.6)',
	bgGlass: 'rgba(15,21,18,.78)',
};

const buildPremiumRefreshPalette = (t: PremiumRefreshTokens): string => `.rcx-content--main {
	--mc-premium-bg: ${t.bg};
	--mc-premium-surface: ${t.surface};
	--mc-premium-surface2: ${t.surface2};
	--mc-premium-border: ${t.border};
	--mc-premium-border2: ${t.border2};
	--mc-premium-ink: ${t.ink};
	--mc-premium-ink2: ${t.ink2};
	--mc-premium-ink3: ${t.ink3};
	--mc-premium-green: ${t.green};
	--mc-premium-green2: ${t.green2};
	--mc-premium-greenSoft: ${t.greenSoft};
	--mc-premium-greenLine: ${t.greenLine};
	--mc-premium-greenInk: ${t.greenInk};
	--mc-premium-onGreen: ${t.onGreen};
	--mc-premium-red: ${t.red};
	--mc-premium-redSoft: ${t.redSoft};
	--mc-premium-redLine: ${t.redLine};
	--mc-premium-amber: ${t.amber};
	--mc-premium-amberSoft: ${t.amberSoft};
	--mc-premium-amberLine: ${t.amberLine};
	--mc-premium-blue: ${t.blue};
	--mc-premium-blueSoft: ${t.blueSoft};
	--mc-premium-blueLine: ${t.blueLine};
	--mc-premium-railBg: ${t.railBg};
	--mc-premium-railBg2: ${t.railBg2};
	--mc-premium-railInk: ${t.railInk};
	--mc-premium-railInk2: ${t.railInk2};
	--mc-premium-railLine: ${t.railLine};
	--mc-premium-railHover: ${t.railHover};
	--mc-premium-shadow1: ${t.shadow1};
	--mc-premium-shadow2: ${t.shadow2};
	--mc-premium-shadow3: ${t.shadow3};
	--mc-premium-bgGlass: ${t.bgGlass};
}`;

const buildPremiumRefreshCss = (t: PremiumRefreshTokens): string => `
/* MATTERCHAT PREMIUM REFRESH — Chat surface styling for the wave3 design */

/* Main content area background */
.rcx-content--main {
	background-color: var(--mc-premium-bg);
	color: var(--mc-premium-ink);
	font-family: 'Geist', system-ui, -apple-system, sans-serif;
	-webkit-font-smoothing: antialiased;
}

/* Room header — frosted glass effect */
.rcx-content--main .rcx-room-header {
	backdrop-filter: blur(14px);
	-webkit-backdrop-filter: blur(14px);
	background-color: ${t.bgGlass};
	border-bottom-color: var(--mc-premium-border);
	border-bottom-width: 1px;
	border-bottom-style: solid;
	padding: 12px 22px;
}

.rcx-content--main .rcx-room-header h1 {
	font-size: 14.5px;
	font-weight: 650;
	color: var(--mc-premium-ink);
}

/* Messages container and list background */
.rcx-content--main .messages-container-main,
.rcx-content--main .messages-box {
	background-color: var(--mc-premium-bg);
}

.rcx-content--main .messages-list {
	background-color: var(--mc-premium-bg);
	padding: 18px 26px 8px;
	max-width: 860px;
	margin: 0 auto;
}

/* MessageDivider (day separator) styling */
.rcx-content--main .rcx-message-divider {
	margin: 14px 0 10px;
	display: flex;
	align-items: center;
	gap: 12px;
}

.rcx-content--main .rcx-message-divider::before,
.rcx-content--main .rcx-message-divider::after {
	content: '';
	flex: 1;
	height: 1px;
	background-color: var(--mc-premium-border);
}

.rcx-content--main .rcx-message-divider .rcx-bubble {
	flex: 0;
	font-family: 'Geist Mono', ui-monospace, monospace;
	font-size: 10px;
	letter-spacing: 0.1em;
	color: var(--mc-premium-ink3);
	padding: 3px 11px;
	border-radius: 99px;
	border: 1px solid var(--mc-premium-border);
	background-color: var(--mc-premium-surface);
	white-space: nowrap;
	text-transform: uppercase;
}

/* Message row styling */
.rcx-content--main .rcx-message {
	padding: 9px 12px;
	border-radius: 11px;
	background-color: transparent;
	transition: background-color 120ms;
	margin: 0;
}

.rcx-content--main .rcx-message:hover {
	background-color: var(--mc-premium-surface);
}

/* Message header (username, time, badges) */
.rcx-content--main .rcx-message-header {
	display: flex;
	align-items: baseline;
	gap: 8px;
	margin: 0 0 2px 0;
}

.rcx-content--main .rcx-message-header__username {
	font-size: 13px;
	font-weight: 650;
	color: var(--mc-premium-ink);
}

.rcx-content--main .rcx-message-header__time {
	font-size: 11px;
	color: var(--mc-premium-ink3);
}

/* Message body text */
.rcx-content--main .rcx-message-body {
	margin-top: 2px;
	font-size: 13.5px;
	color: var(--mc-premium-ink);
	line-height: 1.5;
}

/* Message left container (avatar) */
.rcx-content--main .rcx-message-left-container {
	margin-right: 11px;
}

.rcx-content--main .rcx-message__avatar {
	width: 32px;
	height: 32px;
	border-radius: 9px;
}

/* Read receipt check marks */
.rcx-content--main .rcx-message-read-status {
	color: var(--mc-premium-green);
}

/* Message actions toolbar */
.rcx-content--main .rcx-message-actions {
	opacity: 0;
	transition: opacity 150ms;
	display: flex;
	gap: 2px;
}

.rcx-content--main .rcx-message:hover .rcx-message-actions {
	opacity: 1;
}

.rcx-content--main .rcx-message-actions button {
	width: 24px;
	height: 24px;
	border-radius: 7px;
	color: var(--mc-premium-ink3);
	background-color: transparent;
	border: none;
	cursor: pointer;
	display: grid;
	place-items: center;
	transition: all 120ms;
}

.rcx-content--main .rcx-message-actions button:hover {
	color: var(--mc-premium-ink);
}

/* Composer section styling (rc-message-box is the footer wrapper) */
.rcx-content--main .rc-message-box {
	padding: 14px 26px 18px;
	background-color: var(--mc-premium-bg);
}

.rcx-content--main .rc-message-box > div {
	max-width: 860px;
	margin: 0 auto;
}

/* Message composer (ui-composer MessageComposer component) */
.rcx-content--main .rcx-message-composer {
	background-color: var(--mc-premium-surface);
	border: 1px solid var(--mc-premium-border2);
	border-radius: 13px;
	box-shadow: var(--mc-premium-shadow1);
	transition: all 150ms;
}

.rcx-content--main .rcx-message-composer:hover {
	border-color: var(--mc-premium-ink3);
}

.rcx-content--main .rcx-message-composer:focus-within {
	border-color: var(--mc-premium-ink3);
}

/* Message composer input area */
.rcx-content--main .rcx-message-composer__input {
	color: var(--mc-premium-ink);
	padding: 11px 14px;
	border: none;
}

.rcx-content--main .rcx-message-composer__input::placeholder {
	color: var(--mc-premium-ink3);
}

/* Send button (primary action in composer) */
.rcx-content--main .rcx-message-composer__toolbar .rcx-button--primary {
	background-color: var(--mc-premium-green);
	color: var(--mc-premium-onGreen);
	border-radius: 9px;
	border: none;
	cursor: pointer;
	transition: all 150ms;
}

.rcx-content--main .rcx-message-composer__toolbar .rcx-button--primary:hover {
	background-color: var(--mc-premium-green2);
}

/* Message composer toolbar section */
.rcx-content--main .rcx-message-composer__toolbar {
	border-top-color: var(--mc-premium-border);
	border-top-width: 1px;
	border-top-style: solid;
	padding: 5px 9px;
	display: flex;
	gap: 1px;
}

/* Toolbar buttons and formatting options */
.rcx-content--main .rcx-message-composer__toolbar .rcx-button,
.rcx-content--main .rcx-message-composer__toolbar .rcx-icon-button {
	color: var(--mc-premium-ink3);
	border-radius: 8px;
	cursor: pointer;
	background-color: transparent;
	border: none;
	transition: all 120ms;
}

.rcx-content--main .rcx-message-composer__toolbar .rcx-button:hover,
.rcx-content--main .rcx-message-composer__toolbar .rcx-icon-button:hover {
	background-color: var(--mc-premium-surface2);
	color: var(--mc-premium-ink);
}

/* Legacy class support for backward compatibility */
.rcx-content--main .rcx-message-box {
	background-color: var(--mc-premium-surface);
	border: 1px solid var(--mc-premium-border2);
	border-radius: 13px;
	box-shadow: var(--mc-premium-shadow1);
	transition: all 150ms;
}

.rcx-content--main .rcx-message-box:hover,
.rcx-content--main .rcx-message-box:focus-within {
	border-color: var(--mc-premium-ink3);
}

/* Avatar styling — ensure proper radius */
.rcx-content--main .rcx-avatar {
	border-radius: 9px;
}

/* Typography helpers */
.rcx-content--main .rcx-badge {
	font-family: 'Geist Mono', ui-monospace, monospace;
	font-size: 8.5px;
	letter-spacing: 0.08em;
	font-weight: 600;
	padding: 2px 6px;
	border-radius: 5px;
}

.rcx-content--main .rcx-badge--success {
	background-color: var(--mc-premium-greenSoft);
	border: 1px solid var(--mc-premium-greenLine);
	color: var(--mc-premium-greenInk);
}

/* Status indicators */
.rcx-content--main .status-online {
	background-color: var(--mc-premium-green);
	width: 8px;
	height: 8px;
	border-radius: 99px;
	border: 2px solid var(--mc-premium-bg);
	animation: mcPulse 2.6s ease-out infinite;
}

@keyframes mcPulse {
	0% {
		box-shadow: 0 0 0 0 rgba(63, 188, 124, 0.55);
	}
	70% {
		box-shadow: 0 0 0 5px rgba(63, 188, 124, 0);
	}
	100% {
		box-shadow: 0 0 0 0 rgba(63, 188, 124, 0);
	}
}
`;

/**
 * PREMIUM DASHBOARD — Wave 3 refresh design tokens
 * ============================================================================
 *
 * Modern card-based design with Geist typography and contemporary shadows.
 * Used by the new PremiumDashboard component (wave3/s-dashboard feature).
 */

type DashboardTokens = {
	bg: string;
	surface: string;
	border: string;
	ink: string;
	ink2: string;
	ink3: string;
	green: string;
	greenLight: string;
	greenSoft: string;
	red: string;
	amber: string;
	blue: string;
};

const PREMIUM_LIGHT: DashboardTokens = {
	bg: '#F6F6F3',
	surface: '#FFFFFF',
	border: '#E7E6E0',
	ink: '#171D19',
	ink2: '#57615B',
	ink3: '#8E968F',
	green: '#17804D',
	greenLight: '#0F6A3D',
	greenSoft: '#E8F3ED',
	red: '#CF4438',
	amber: '#A97A18',
	blue: '#3C6EB4',
};

const PREMIUM_DARK: DashboardTokens = {
	bg: '#0F1512',
	surface: '#151C17',
	border: '#242D27',
	ink: '#E9EDEA',
	ink2: '#A2ACA5',
	ink3: '#707B74',
	green: '#3FBC7C',
	greenLight: '#57CD90',
	greenSoft: '#152A1E',
	red: '#E0685D',
	amber: '#D3A24A',
	blue: '#7AA3D8',
};

const buildPremiumDashboardCss = (theme: string): string => {
	const t = theme === 'dark' ? PREMIUM_DARK : PREMIUM_LIGHT;

	return `:root[data-theme="${theme}"] {
		--premium-dashboard-bg: ${t.bg};
		--premium-dashboard-surface: ${t.surface};
		--premium-dashboard-border: ${t.border};
		--premium-dashboard-ink: ${t.ink};
		--premium-dashboard-ink2: ${t.ink2};
		--premium-dashboard-ink3: ${t.ink3};
		--premium-dashboard-green: ${t.green};
		--premium-dashboard-green-light: ${t.greenLight};
		--premium-dashboard-green-soft: ${t.greenSoft};
		--premium-dashboard-red: ${t.red};
		--premium-dashboard-red-soft: ${theme === 'dark' ? 'rgba(224, 104, 93, 0.12)' : 'rgba(207, 68, 56, 0.12)'};
		--premium-dashboard-red-line: ${theme === 'dark' ? 'rgba(224, 104, 93, 0.3)' : 'rgba(207, 68, 56, 0.3)'};
		--premium-dashboard-amber: ${t.amber};
		--premium-dashboard-amber-soft: ${theme === 'dark' ? 'rgba(211, 162, 74, 0.12)' : 'rgba(169, 122, 24, 0.12)'};
		--premium-dashboard-blue: ${t.blue};
		--premium-dashboard-blue-soft: ${theme === 'dark' ? 'rgba(122, 163, 216, 0.12)' : 'rgba(60, 110, 180, 0.12)'};
	}`;
};

export const MainLayoutStyleTags = () => {
	const [, , theme] = useThemeMode();

	// Desktop app (Electron): tag <body> so the full-bleed frame + macOS traffic-light padding above
	// activate. Inert on web/PWA (matterchatDesktop is only injected by the desktop wrapper's preload).
	useEffect(() => {
		const w = window as unknown as { matterchatDesktop?: unknown };
		if (!w.matterchatDesktop) return undefined;
		document.body.classList.add('mc-desktop-app');
		const isMac = /Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent);
		if (isMac) document.body.classList.add('mc-desktop-mac');
		return () => document.body.classList.remove('mc-desktop-app', 'mc-desktop-mac');
	}, []);

	// Brand the light and dark themes; leave high-contrast (a11y) entirely stock.
	const branded = theme === 'light' || theme === 'dark';
	const ledger = theme === 'dark' ? DARK_LEDGER : LIGHT_LEDGER;
	const premium = theme === 'dark' ? DARK_PREMIUM : LIGHT_PREMIUM;

	return (
		<>
			<PaletteStyleTag theme={theme} selector='.rcx-content--main, .rcx-tile' tagId={`main-palette-${theme}`} />
			<PaletteStyleTag theme='dark' selector='.rcx-sidebar--main, .rcx-sidepanel, .rcx-navbar' tagId='sidebar-palette' />
			{theme === 'dark' && <PaletteStyleTag selector='.rcx-content--main' palette={codeBlock} tagId='codeBlock-palette' />}
			{/* Ledger-dense brand accents on the chat surface — custom-palette precedent = codeBlock above. */}
			{branded && <PaletteStyleTag selector='.rcx-content--main' palette={buildLedgerPalette(ledger)} tagId={`ledger-palette-${theme}`} />}
			{/* Premium refresh tokens — wave3 chat design tokens. */}
			{branded && <PaletteStyleTag selector='.rcx-content--main' palette={buildPremiumRefreshPalette(premium)} tagId={`premium-refresh-palette-${theme}`} />}
			{/* Static, no user input — the drag-region rule is a constant string (mirrors RawText's pattern). */}
			<style dangerouslySetInnerHTML={{ __html: NAVBAR_DRAG_REGION_CSS }} />
			{/* Static, no user input — the frame rule is a constant string. */}
			<style dangerouslySetInnerHTML={{ __html: MATTERCHAT_FRAME_CSS }} />
			{/* Static, theme-derived constant string — ledger accents Fuselage tokens don't cover. */}
			{branded && <style dangerouslySetInnerHTML={{ __html: buildLedgerCss(ledger) }} />}
			{/* Static, theme-derived constant string — premium refresh chat styling. */}
			{branded && <style dangerouslySetInnerHTML={{ __html: buildPremiumRefreshCss(premium) }} />}
			{/* Premium dashboard tokens — Wave 3 refresh design. */}
			{branded && <style dangerouslySetInnerHTML={{ __html: buildPremiumDashboardCss(theme) }} />}
		</>
	);
};
