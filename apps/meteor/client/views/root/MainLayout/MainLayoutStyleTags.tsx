import { PaletteStyleTag } from '@rocket.chat/fuselage';
import { useThemeMode } from '@rocket.chat/ui-client';

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

export const MainLayoutStyleTags = () => {
	const [, , theme] = useThemeMode();

	// Brand the light and dark themes; leave high-contrast (a11y) entirely stock.
	const branded = theme === 'light' || theme === 'dark';
	const ledger = theme === 'dark' ? DARK_LEDGER : LIGHT_LEDGER;

	return (
		<>
			<PaletteStyleTag theme={theme} selector='.rcx-content--main, .rcx-tile' tagId={`main-palette-${theme}`} />
			<PaletteStyleTag theme='dark' selector='.rcx-sidebar--main, .rcx-sidepanel, .rcx-navbar' tagId='sidebar-palette' />
			{theme === 'dark' && <PaletteStyleTag selector='.rcx-content--main' palette={codeBlock} tagId='codeBlock-palette' />}
			{/* Ledger-dense brand accents on the chat surface — custom-palette precedent = codeBlock above. */}
			{branded && <PaletteStyleTag selector='.rcx-content--main' palette={buildLedgerPalette(ledger)} tagId={`ledger-palette-${theme}`} />}
			{/* Static, no user input — the drag-region rule is a constant string (mirrors RawText's pattern). */}
			<style dangerouslySetInnerHTML={{ __html: NAVBAR_DRAG_REGION_CSS }} />
			{/* Static, no user input — the frame rule is a constant string. */}
			<style dangerouslySetInnerHTML={{ __html: MATTERCHAT_FRAME_CSS }} />
			{/* Static, theme-derived constant string — ledger accents Fuselage tokens don't cover. */}
			{branded && <style dangerouslySetInnerHTML={{ __html: buildLedgerCss(ledger) }} />}
		</>
	);
};
