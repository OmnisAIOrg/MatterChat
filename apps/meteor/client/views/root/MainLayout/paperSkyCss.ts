/**
 * Paper & Sky — the stylesheet, in four stages.
 * ============================================================================
 *
 * Split out of `PaperSkyStyleTags.tsx` so the component stays about behaviour
 * (which sky is showing, where it mounts) and this file stays about appearance.
 *
 * THE RULE, from the canonical stylesheet:
 *
 *     If you read it, it is PAPER. If it frames what you read, it is GLASS.
 *
 * Everything is scoped under `body[data-skin]`, so none of it can reach a user on
 * light, dark, high-contrast or auto. Nothing here edits a Rocket.Chat core file.
 *
 * TWO SEAMS DO THE HEAVY LIFTING — prefer them over new selectors:
 *
 *   1. `--mc-ledger-*`. MatterChat's own screens (My Day, boards, matters, LitBox)
 *      set colours inline via constants in `views/boards/lib/ledger.ts`, and every
 *      one is already `var(--mc-ledger-X, #fallback)`. Redefining five variables
 *      reskins ~98 inline styles across 29 files with no specificity fight. Whoever
 *      wrote ledger.ts left this hook in on purpose; use it.
 *   2. `--rcx-color-*`. Fuselage renders from these, so a token change reskins core
 *      components without touching them.
 *
 * `!important` appears only where an inline `style=` attribute must be beaten, or
 * where a `body.mc-*` rule from the Variant B skin is written to win. It is not a
 * default.
 *
 * `-webkit-backdrop-filter` is hand-written beside every `backdrop-filter`: these
 * tags inject at runtime and bypass PostCSS/autoprefixer, so the browser sees
 * exactly this. (LandingPage's rule is the OPPOSITE — Lightning CSS there collapses
 * a hand-written pair to the webkit form alone.)
 */

/** Smoked — the only material white body text clears AA on, in every sky state.
 *
 * THE SMOKE IS GREEN, NOT BLACK (founder, 2026-08-12: "literally no dark grey —
 * only green sky glass and warm paper"). Black smoke over the sky's dark stops
 * composited to a neutral charcoal; a deep-green base keeps every glass surface
 * unmistakably part of the sky. White on this over the brightest stop (#7AD397)
 * still clears AA (~6:1 measured on the composite). */
const SMOKED = `
	-webkit-backdrop-filter: blur(50px) saturate(180%);
	backdrop-filter: blur(50px) saturate(180%);
	background: rgba(6, 40, 23, 0.60);
	border-color: rgba(255, 255, 255, 0.24);
`;

/** Frosted — cards and containers that are not body copy. */
const FROSTED = `
	-webkit-backdrop-filter: blur(44px) saturate(185%);
	backdrop-filter: blur(44px) saturate(185%);
	background: linear-gradient(135deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.09) 52%, rgba(255, 255, 255, 0.15));
	border-color: rgba(255, 255, 255, 0.34);
`;

/** Clear — chips, pills, things that must stay legible-through. Never body text. */
const CLEAR = `
	-webkit-backdrop-filter: blur(32px) saturate(180%);
	backdrop-filter: blur(32px) saturate(180%);
	background: rgba(255, 255, 255, 0.10);
	border-color: rgba(255, 255, 255, 0.22);
`;

// ============================================================================
// STAGE 1 — TOKENS + SHELL
// ============================================================================

export const SHELL_CSS = `
body[data-skin] {
	--ps-paper: #FAF5EA;
	--ps-paper-bright: #FFFDF6;
	--ps-rim: #FFFEFA;
	--ps-hairline: #E4D9C0;
	--ps-ink: #2C2A21;
	--ps-ink-quiet: #4A463A;
	--ps-ink-faint: #8A8471;
	--ps-on-sky: #FFFFFF;
	--ps-on-sky-2: rgba(255, 255, 255, 0.85);
	--ps-on-sky-3: rgba(255, 255, 255, 0.70);
	--ps-mint: #8FE3A5;
	--ps-lift: 0 1px 12px rgba(10, 40, 20, 0.35);
	--ps-radius: 22px;
	--ps-card-shadow: inset 0 1px 0 var(--ps-rim), 0 10px 26px -14px rgba(0, 0, 0, 0.55);

	/* THE LEDGER SEAM. Every inline colour on MatterChat's own screens reads these.
	   The page ground goes TRANSPARENT so the sky shows through it — that single
	   line is what turns My Day, boards, matters and LitBox from opaque cream pages
	   into paper cards floating on the sky. */
	--mc-ledger-paper: transparent;
	--mc-ledger-card: var(--ps-paper);
	--mc-ledger-card-tint: #F2ECDC;
	--mc-ledger-rule: var(--ps-hairline);
	--mc-ledger-accent: #17804D;

	/* TEXT DIRECTLY ON THE SKY cannot be one colour. White fails on the bright
	   morning/day stops (measured ~1.9:1 on #7AD397) and deep ink fails on night.
	   data-sky on <body> (set beside data-skin) flips these per state; every
	   on-sky heading and empty state reads THESE, never a hard-coded white. */
	--ps-header-ink: var(--ps-on-sky);
	--ps-header-ink-2: var(--ps-on-sky-2);
	--ps-header-lift: var(--ps-lift);
}
/* Bright skies (stop 0 ≥ ~#3E9E63): ink, no lift — a dark shadow under dark ink
   reads as smudge. Night keeps the defaults above (white + lift). */
body[data-skin][data-sky='morning'],
body[data-skin][data-sky='day'],
body[data-skin][data-sky='dusk'] {
	--ps-header-ink: #0B3A22;
	--ps-header-ink-2: rgba(11, 58, 34, 0.78);
	--ps-header-lift: none;
}

/* THE WINDOW. The rounded floating shape is KEPT — near-black backdrop, 8px
   margin, 22px radius, drop shadow, org rail outside it. What is removed is the
   inner bezel: Variant B pins #react-root 14px inside a green gradient card, so a
   band frames the app on all four sides. Here the sky reaches the corners.

   NEVER put transform, filter or mix-blend-mode on body or #react-root. body
   carrying no transform is the only reason fixed-position modals, menus and toasts
   escape the body clip instead of being trapped inside the rounded window. */
body[data-skin] {
	background: #080D0A !important;
}
/* The backdrop OUTSIDE the rounded window. Variant B paints <html> #0C0F14, a
   blue-black, and a rule scoped to body can never reach <html> — so the 8px rim
   around the window stayed the old colour and read as a mismatched frame. Verified
   in the DOM: html computed rgb(12,15,20) while the window was rgb(8,13,10).
   The :has() form is already used for this exact purpose in depthSkin.ts. */
html:has(body[data-skin]) {
	background: #080D0A !important;
}
body[data-skin] #react-root {
	inset: 0 !important;
	border-radius: var(--ps-radius) !important;
	background: transparent !important;
	box-shadow: none !important;
}
@media (max-width: 767.98px) {
	body[data-skin] #react-root {
		border-radius: 0 !important;
	}
}

/* The sky sits at the bottom of the window's stacking order.

   z-index MUST be negative and #react-root MUST isolate. The NavBar (and the
   banner region) are STATIC siblings of #rocket-chat inside #react-root, and a
   positioned element at z-index 0 paints ABOVE every static sibling — which put
   the sky OVER the whole navbar. pointer-events:none made it a ghost: hit-testing
   passed through to the navbar underneath, so search and every control kept
   working while being fully invisible under the gradient. That was the "empty
   band" across the top of staging. isolation:isolate keeps the negative layer
   inside the window instead of slipping under <body>'s near-black backdrop. */
body[data-skin] #react-root {
	isolation: isolate;
}
body[data-skin] .ps-sky {
	position: absolute;
	inset: 0;
	z-index: -1;
	pointer-events: none;
	opacity: 0;
	transition: opacity 2s linear;
}
body[data-skin] .ps-sky[data-on='true'] {
	opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
	body[data-skin] .ps-sky {
		transition: none;
	}
}

/* Clear the ground so the sky is visible through the app.

   main#main-content > section is THE one that mattered, and it was found by
   reading the live DOM rather than the source. It is a Fuselage Box whose inline
   style is already background-color: var(--mc-ledger-paper, #FAF7EE) — so the
   ledger seam SHOULD have handled it, and the variable did resolve to
   transparent on that element. It still computed rgb(31,35,41), a 1114x939 grey
   slab over the whole main area. That grey was what made three rounds of fixes
   look like nothing had happened.

   .rcx-page is here for the same reason on MatterChat's own screens, which set an
   inline page background. */
body[data-skin] #rocket-chat,
body[data-skin] .rcx-content--main,
body[data-skin] .rcx-sidebar,
body[data-skin] .rcx-sidebar--main > *,
body[data-skin] .rcx-page,
body[data-skin] .rcx-page-content,
body[data-skin] main,
body[data-skin] main#main-content > section {
	background: transparent !important;
	background-color: transparent !important;
}
body[data-skin] #rocket-chat {
	position: relative;
	z-index: 1;
}

/* ---- CHROME: glass, and only glass ----

   MATTERCHAT'S OWN SHELL IS NOT ROCKET.CHAT'S. The nav rail and workspace rail are
   custom components (AppLeftRail.tsx) setting background-color: #1A212C through
   css-in-js, and the room column is a MatterChat template rather than a Fuselage
   one. None of the .rcx-* selectors reach any of it — which is why an earlier pass
   tinted the channel list and left the rails and the whole conversation area opaque
   navy. When adding a surface, check whether it is OURS before reaching for an rcx
   class. */
body[data-skin] .rcx-navbar,
body[data-skin] .rcx-sidebar--main,
body[data-skin] .rcx-sidepanel,
body[data-skin] .mc-rail-menu,
body[data-skin] .mc-rail-workspace {
	${SMOKED}
	background: rgba(6, 40, 23, 0.60) !important;
	background-color: rgba(6, 40, 23, 0.60) !important;
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

body[data-skin] .mc-rail-menu,
body[data-skin] .mc-rail-menu *,
body[data-skin] .mc-rail-workspace,
body[data-skin] .mc-rail-workspace * {
	color: var(--ps-on-sky) !important;
	border-color: rgba(255, 255, 255, 0.18);
}
/* The rail's own grooved chip carries its own fill. */
body[data-skin] .mc-rail-menu .mc-groove {
	background: rgba(6, 40, 23, 0.30) !important;
	border-color: rgba(255, 255, 255, 0.14) !important;
}

/* THE ROOM COLUMN. Template classes, not Fuselage ones, each with an opaque
   ground. Without these the sky stops at the channel list and the entire
   conversation sits on flat navy.

   .mc-room-layout is the stable hook added to RoomLayout.tsx: its Box carries
   bg='room' — an unstable emotion hash resolving to the DARK palette's
   surface-room — and it was the one full-width slab the earlier list never
   reached, which kept every conversation opaque charcoal. */
body[data-skin] .messages-box,
body[data-skin] .messages-container-main,
body[data-skin] .messages-container-wrapper,
body[data-skin] .messages-list,
body[data-skin] .rcx-room,
body[data-skin] .mc-room-layout,
body[data-skin] .rcx-vertical-bar,
body[data-skin] .rcx-contextual-bar {
	background: transparent !important;
	background-color: transparent !important;
}

/* THE ROOM HEADER RENDERS rcx-room-header AS AN ATTRIBUTE, NOT A CLASS —
   ui-client's Header.tsx passes it as a Box prop, so every .rcx-room-header
   CLASS selector in earlier passes matched nothing and the header stayed on the
   dark palette. Match both spellings, and clear the inner bg='room' strip. */
body[data-skin] .rcx-room-header,
body[data-skin] [rcx-room-header] {
	${FROSTED}
	background: linear-gradient(135deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.09) 52%, rgba(255, 255, 255, 0.15)) !important;
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
body[data-skin] [rcx-room-header] > .rcx-box,
body[data-skin] .rcx-room-header > .rcx-box,
body[data-skin] header.rcx-room-header .rcx-box--full {
	background: transparent !important;
	background-color: transparent !important;
}

/* ---- TYPE ON GLASS: white on the SMOKED chrome (safe in every sky state);
   the FROSTED room header instead follows the sky-state header ink, because
   frosted glass goes light over the bright skies and white text drowns. ---- */
body[data-skin] .rcx-navbar,
body[data-skin] .rcx-navbar *,
body[data-skin] .rcx-sidebar--main,
body[data-skin] .rcx-sidebar--main *,
body[data-skin] .rcx-sidepanel,
body[data-skin] .rcx-sidepanel * {
	color: var(--ps-on-sky) !important;
	border-color: rgba(255, 255, 255, 0.18);
}
body[data-skin] .rcx-room-header,
body[data-skin] .rcx-room-header *,
body[data-skin] [rcx-room-header],
body[data-skin] [rcx-room-header] * {
	color: var(--ps-header-ink) !important;
	border-color: rgba(255, 255, 255, 0.18);
}
body[data-skin] .rcx-sidebar-item--clickable:hover {
	background: rgba(255, 255, 255, 0.16) !important;
}
body[data-skin] .rcx-sidebar-item--selected {
	background: rgba(255, 255, 255, 0.12) !important;
}

/* THE ROOM LIST IS SIDEBAR V2, NOT V1. The two .rcx-sidebar-item rules above are
   the v1 names and match nothing in this fork — Sidebar.tsx renders Fuselage's
   <SidebarV2/>. Every v2 child re-declares its own opaque
   --rcx-color-surface-sidebar fill (and the sidebar palette pins that to the DARK
   theme), which is what painted the near-black "Channels"/"Direct messages" bars
   and the banded navy rows over the smoked root. Clear the CHILDREN ONLY: the v2
   ROOT is the same element as .rcx-sidebar--main (Sidebar.tsx stacks both classes),
   and putting the root in this list silently un-smoked the whole column — bare
   bright sky where the rail's dark glass should be (founder: "too green"). */
body[data-skin] .rcx-sidebar-v2-collapse-group__bar,
body[data-skin] .rcx-sidebar-v2-accordion-item__bar,
body[data-skin] .rcx-sidebar-v2-footer,
body[data-skin] .rcx-sidebar-v2-media,
body[data-skin] .rcx-sidebar-v2-item {
	background: transparent !important;
	background-color: transparent !important;
}
body[data-skin] .rcx-sidebar-v2-item:hover,
body[data-skin] .rcx-sidebar-v2-item--focus {
	background: rgba(255, 255, 255, 0.16) !important;
}
body[data-skin] .rcx-sidebar-v2-item--selected {
	background: rgba(255, 255, 255, 0.12) !important;
}

/* Badges: white is unread, coral is a mention. */
body[data-skin] .rcx-badge {
	background: #ffffff !important;
	color: #0a2216 !important;
}
body[data-skin] .rcx-badge--danger,
body[data-skin] .rcx-badge--primary {
	background: #f0997b !important;
	color: #4a1b0c !important;
}
`;

// ============================================================================
// STAGE 2 — THE CHAT SURFACE
//
// Message rows become paper. This is where the paper/glass rule earns its keep:
// a frosted row is a backdrop-filter, so a room with ~50 visible rows would be 50
// GPU layers recompositing over a gradient that moves and never caches. Paper is
// opaque and costs nothing, and holds 13.2:1 in every sky state where white on
// frosted falls to 2.6:1 on the bright skies.
//
// Selectors are the ones the Variant B ledger skin already proved against this
// Rocket.Chat version — `.rcx-message[data-own]`, `.messages-list`,
// `.rcx-message-header__username` and friends. Re-verify them on any upstream bump.
// ============================================================================

export const CHAT_CSS = `
body[data-skin] .messages-list,
body[data-skin] .rcx-message-list {
	background: transparent !important;
}

/* The row is the sheet. Sequential (grouped) messages join the sheet above rather
   than starting a new one, or a burst of five replies reads as five documents. */
body[data-skin] .rcx-message {
	background: var(--ps-paper) !important;
	color: var(--ps-ink) !important;
	border-radius: 14px;
	margin: 4px 12px;
	padding: 10px 14px;
	box-shadow: var(--ps-card-shadow);
	border: 1px solid transparent;
}
body[data-skin] .rcx-message--sequential {
	margin-top: -1px;
	padding-top: 2px;
	border-top-left-radius: 0;
	border-top-right-radius: 0;
	box-shadow: none;
}
/* A burst of replies fuses into ONE document: the sheet above a joined row gives
   up its gap, bottom corners and downward shadow (which would paint a dark seam
   across the join), and the LAST sheet of the burst carries the group's drop
   shadow — without the inset rim, which would draw a cream hairline at the join. */
body[data-skin] .rcx-message--sequential:not(:has(+ .rcx-message--sequential)) {
	box-shadow: 0 10px 26px -14px rgba(0, 0, 0, 0.55);
}
body[data-skin] .rcx-message:has(+ .rcx-message--sequential) {
	margin-bottom: 0;
	border-bottom-left-radius: 0;
	border-bottom-right-radius: 0;
	box-shadow: inset 0 1px 0 var(--ps-rim);
}
body[data-skin] .rcx-message:hover {
	background: var(--ps-paper-bright) !important;
}

/* Own messages read brighter and carry the accent edge; Chi is brighter still. */
body[data-skin] .rcx-message[data-own='true'] {
	background: var(--ps-paper-bright) !important;
}
body[data-skin] .rcx-message--highlight,
body[data-skin] .rcx-message--selected {
	background: #FFF8E4 !important;
	border-color: var(--ps-hairline);
}

/* Ink, not white — this is paper now, and the sidebar's white-on-glass rule must
   not leak in. */
body[data-skin] .rcx-message,
body[data-skin] .rcx-message *,
body[data-skin] .rcx-message-body,
body[data-skin] .rcx-message-body * {
	color: var(--ps-ink);
}
body[data-skin] .rcx-message-header__username {
	color: var(--ps-ink) !important;
	font-weight: 700;
}
body[data-skin] .rcx-message-header__time,
body[data-skin] .rcx-message-header__role {
	color: var(--ps-ink-faint) !important;
}
body[data-skin] .rcx-message-body a,
body[data-skin] .rcx-message-body a:visited {
	color: #116240 !important;
	text-decoration-color: rgba(17, 98, 64, 0.4);
}

/* Mentions render as pills on paper rather than as coloured text. */
body[data-skin] .rcx-message .mention-link {
	background: #E8F3ED !important;
	color: #116240 !important;
	border-radius: 6px;
	padding: 1px 6px;
	font-weight: 600;
}
body[data-skin] .rcx-message .mention-link--me,
body[data-skin] .rcx-message .mention-link--group {
	background: #FBECEA !important;
	color: #8A2B1E !important;
}

/* Attachments and quotes are a second sheet on the first — a tint step, not a
   shadow, or nested shadows muddy the stack. */
body[data-skin] .rcx-message-attachment,
body[data-skin] .rcx-message-blocks,
body[data-skin] .rcx-attachment__details {
	background: var(--ps-paper-bright) !important;
	border: 1px solid var(--ps-hairline) !important;
	border-radius: 11px;
	box-shadow: none;
}

/* Code keeps a cool ground so it reads as machine text against warm paper. */
body[data-skin] .rcx-message code,
body[data-skin] .rcx-message pre {
	background: #F1EEE2 !important;
	color: #33301F !important;
	border: 1px solid var(--ps-hairline);
	border-radius: 7px;
}

/* Date divider is a pill ON the sky between sheets — green glass, never neutral.
   The background carries !important for the same reason the buttons needed it:
   the dark palette gives the bubble its own grey fill that otherwise wins. */
body[data-skin] .rcx-message-divider {
	background: transparent !important;
}
body[data-skin] .rcx-message-divider .rcx-bubble,
body[data-skin] .rcx-message-divider .rcx-divider-bubble {
	${SMOKED}
	background: rgba(6, 40, 23, 0.60) !important;
	background-color: rgba(6, 40, 23, 0.60) !important;
	color: var(--ps-on-sky) !important;
	text-shadow: var(--ps-lift);
	border-radius: 20px;
	border-style: solid;
	border-width: 1px;
}

/* The hover toolbar floats above the sheet — glass, so the sheet reads through. */
body[data-skin] .rcx-message-toolbar,
body[data-skin] .rcx-message-actions {
	${SMOKED}
	border-style: solid;
	border-width: 1px;
	border-radius: 11px;
}
body[data-skin] .rcx-message-toolbar *,
body[data-skin] .rcx-message-actions * {
	color: var(--ps-on-sky) !important;
}

body[data-skin] .rcx-message-read-status {
	color: #17804D !important;
}

/* THE COMPOSER IS PAPER, NOT CHROME (founder, 2026-08-12). The first cut smoked
   it, and it read as the one grey box on an all-green screen. By the theme's own
   rule it was always a reading surface — you read what you are typing. The
   !important is still load-bearing: the composer carries its own opaque ground. */
body[data-skin] .rcx-message-composer,
body[data-skin] .rcx-message-box,
body[data-skin] .rc-message-box {
	background: var(--ps-paper-bright) !important;
	background-color: var(--ps-paper-bright) !important;
	border: 1px solid var(--ps-hairline) !important;
	border-radius: 15px;
	box-shadow: var(--ps-card-shadow);
}
/* The composer's inner strips each carry their own DARK-palette fill — the input
   wrapper (.rcx-input-box__wrapper, rgb(38,41,49) measured) and an emotion-hashed
   toolbar box. Clear every box inside the sheet; deliberate fills (icon hover,
   send) re-assert themselves with !important below. */
body[data-skin] .rcx-message-composer__toolbar,
body[data-skin] .rcx-message-composer-toolbar,
body[data-skin] .rcx-message-box__toolbar,
body[data-skin] .rcx-message-composer .rcx-input-box__wrapper,
body[data-skin] .rcx-message-box .rcx-input-box__wrapper,
body[data-skin] .rc-message-box .rcx-input-box__wrapper,
body[data-skin] .rcx-message-composer .rcx-box,
body[data-skin] .rcx-message-box .rcx-box,
body[data-skin] .rc-message-box .rcx-box {
	/* !important is required: Fuselage Box PROPS compile to emotion rules that are
	   themselves !important, so a normal declaration loses at any specificity. The
	   deliberate fills below (icon hover, send) also carry !important and win by
	   coming later in this same sheet. */
	background: transparent !important;
	background-color: transparent !important;
}
body[data-skin] .rcx-message-composer,
body[data-skin] .rcx-message-composer *,
body[data-skin] .rcx-message-box *,
body[data-skin] .rcx-message-composer .rcx-box--with-inline-elements {
	color: var(--ps-ink) !important;
}
body[data-skin] .rcx-message-composer textarea::placeholder {
	color: var(--ps-ink-faint) !important;
}
/* Composer action icons read as quiet ink on the sheet — and they must NOT get the
   smoked chip treatment the on-sky buttons do (they are ON PAPER). */
body[data-skin] .rcx-message-composer .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger),
body[data-skin] .rcx-message-box .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger),
body[data-skin] .rc-message-box .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger) {
	background: transparent !important;
	-webkit-backdrop-filter: none;
	backdrop-filter: none;
	border: 1px solid transparent !important;
	color: var(--ps-ink-quiet) !important;
}
body[data-skin] .rcx-message-composer .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger):hover,
body[data-skin] .rcx-message-box .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger):hover,
body[data-skin] .rc-message-box .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger):hover {
	background: #F1EAD8 !important;
	border-color: var(--ps-hairline) !important;
}
/* The send action stays the accent. */
body[data-skin] .rcx-message-composer .rcx-button--primary,
body[data-skin] .rcx-message-box .rcx-button--primary,
body[data-skin] .rc-message-box .rcx-button--primary {
	background: #17804D !important;
	color: #ffffff !important;
	border-color: #17804D !important;
}
/* Legacy-class composer text (the fork's footer is .rc-message-box). */
body[data-skin] .rc-message-box,
body[data-skin] .rc-message-box * {
	color: var(--ps-ink);
}
/* Focus is the palette's mint, not the stock blue highlight — the one cold colour
   left on screen was the composer lighting up cornflower on every keystroke. */
body[data-skin] .rcx-message-composer:focus-within,
body[data-skin] .rcx-message-box:focus-within,
body[data-skin] .rc-message-box:focus-within {
	border-color: #17804D !important;
	box-shadow:
		var(--ps-card-shadow),
		0 0 0 2px rgba(23, 128, 77, 0.25);
}
`;

// ============================================================================
// STAGE 3 — SURFACES: home, boards, matters, settings, tables
//
// Most of this is inherited free from the `--mc-ledger-*` redefinition in
// SHELL_CSS. What remains is the Fuselage furniture those screens sit in, plus
// the handful of MatterChat class hooks (`.mc-card`, `.mc-board-header`).
// ============================================================================

export const SURFACES_CSS = `
/* Tiles and cards are paper. .mc-card is MatterChat's own hook on My Day. */
body[data-skin] .rcx-tile,
body[data-skin] .mc-card,
body[data-skin] .rcx-card {
	background: var(--ps-paper) !important;
	color: var(--ps-ink) !important;
	border-color: var(--ps-hairline) !important;
	box-shadow: var(--ps-card-shadow);
}
/* INK MUST REACH DESCENDANTS, NOT JUST THE CONTAINER.
   Setting color on the card alone is not enough: Fuselage's dark palette assigns
   colours to the elements INSIDE, and those win over an inherited value. Measured
   in the browser, that left white text on cream paper at 1.09:1 — invisible, not
   merely low — across the search results, tiles and modals. The container rule
   read as correct in the source the whole time. */
body[data-skin] .rcx-tile,
body[data-skin] .rcx-tile *,
body[data-skin] .mc-card,
body[data-skin] .mc-card *,
body[data-skin] .rcx-card,
body[data-skin] .rcx-card * {
	color: var(--ps-ink) !important;
	border-color: var(--ps-hairline);
}
/* Links keep the accent, or every link on paper reads as body copy. */
body[data-skin] .rcx-tile a,
body[data-skin] .mc-card a,
body[data-skin] .rcx-card a {
	color: #116240 !important;
}

/* Page headers sit ON the sky, above the paper. NOT hard-coded white: the header
   ink flips with the sky state (ink on the bright skies, white on night) — see the
   --ps-header-* tokens in SHELL_CSS. .mc-sky-header is MatterChat's own hook for
   the My Day greeting block, which is a bare Fuselage h1 that otherwise inherits
   the DARK palette's near-white font colour and washes out on a bright sky. */
body[data-skin] .rcx-page-header,
body[data-skin] .rcx-page-header *,
body[data-skin] .mc-board-header,
body[data-skin] .mc-board-header *,
body[data-skin] .mc-sky-header,
body[data-skin] .mc-sky-header * {
	color: var(--ps-header-ink) !important;
	text-shadow: var(--ps-header-lift);
	background: transparent !important;
}
/* The secondary line under an on-sky heading (the date, the deadline note). */
body[data-skin] .mc-sky-header h1 ~ * {
	color: var(--ps-header-ink-2) !important;
}

/* Tables are dense reading — paper, with the warm rule as the grid. */
body[data-skin] .rcx-table {
	background: var(--ps-paper) !important;
	border-radius: 14px;
	overflow: hidden;
	box-shadow: var(--ps-card-shadow);
}
body[data-skin] .rcx-table__cell,
body[data-skin] .rcx-table-cell {
	background: transparent !important;
	color: var(--ps-ink) !important;
	border-color: var(--ps-hairline) !important;
}
body[data-skin] .rcx-table__cell--header {
	color: var(--ps-ink-quiet) !important;
	background: #F4EFE1 !important;
}
body[data-skin] .rcx-table__row:hover .rcx-table__cell {
	background: var(--ps-paper-bright) !important;
}

/* Numeric columns line up — the design calls for tabular figures throughout. */
body[data-skin] .rcx-table,
body[data-skin] .mc-card {
	font-variant-numeric: tabular-nums;
}

/* Form furniture on paper. */
body[data-skin] .rcx-input-box,
body[data-skin] .rcx-select,
body[data-skin] .rcx-text-input {
	background: var(--ps-paper-bright) !important;
	color: var(--ps-ink) !important;
	border-color: var(--ps-hairline) !important;
}
body[data-skin] .rcx-input-box::placeholder {
	color: var(--ps-ink-faint) !important;
}

/* Accessibility & appearance and the other account pages are paper too, or the
   screen the user picks the theme ON is the one screen it never reaches. */
body[data-skin] .rcx-accordion-item {
	background: var(--ps-paper) !important;
	color: var(--ps-ink) !important;
	border-color: var(--ps-hairline) !important;
	border-radius: 12px;
	margin-block-end: 8px;
	padding-inline: 12px;
}
body[data-skin] .rcx-accordion-item *,
body[data-skin] .rcx-field,
body[data-skin] .rcx-field * {
	color: var(--ps-ink);
}
body[data-skin] .rcx-field-description,
body[data-skin] .rcx-field-hint {
	color: var(--ps-ink-quiet) !important;
}
`;

// ============================================================================
// STAGE 4 — OVERLAYS, EMPTY STATES, MOBILE
//
// Modals, menus and toasts must render OVER the rounded window, never clipped
// into it. That works only because body carries no transform (see SHELL_CSS) —
// do not add one here either.
// ============================================================================

export const OVERLAYS_CSS = `
/* Modals are reading surfaces — paper. The scrim is the sky darkened, not black. */
body[data-skin] .rcx-modal__inner,
body[data-skin] .rcx-modal-content,
body[data-skin] .rcx-modal {
	background: var(--ps-paper) !important;
	color: var(--ps-ink) !important;
	border-radius: 18px;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3), 0 24px 60px -12px rgba(0, 0, 0, 0.55);
}
/* Same reason as the tiles: the container rule alone loses to Fuselage's per-element
   dark-palette colours, leaving white-on-cream inside modals. */
body[data-skin] .rcx-modal *,
body[data-skin] .rcx-modal-title {
	color: var(--ps-ink) !important;
}
body[data-skin] .rcx-modal a {
	color: #116240 !important;
}
body[data-skin] .rcx-modal-backdrop {
	background: rgba(6, 20, 12, 0.55) !important;
	-webkit-backdrop-filter: blur(6px);
	backdrop-filter: blur(6px);
}

/* Menus and popovers are chrome — they frame choices, they are not read at length. */
body[data-skin] .rcx-options,
body[data-skin] .rcx-option-column,
body[data-skin] .rcx-menu__list {
	${SMOKED}
	border-style: solid;
	border-width: 1px;
	border-radius: 13px;
}
body[data-skin] .rcx-options *,
body[data-skin] .rcx-option,
body[data-skin] .rcx-option * {
	color: var(--ps-on-sky) !important;
}
body[data-skin] .rcx-option:hover,
body[data-skin] .rcx-option--focus {
	background: rgba(255, 255, 255, 0.16) !important;
}

/* Banners (update-available, announcements) span the very top of the window and
   were the last stock-dark strip: they render OUTSIDE #rocket-chat and no earlier
   rule reached them. They are read → paper. */
body[data-skin] .rcx-banner,
body[data-skin] .rcx-banner * {
	background: var(--ps-paper) !important;
	background-color: var(--ps-paper) !important;
	color: var(--ps-ink) !important;
}
body[data-skin] .rcx-banner {
	border-bottom: 1px solid var(--ps-hairline) !important;
}
body[data-skin] .rcx-banner a,
body[data-skin] .rcx-banner .rcx-banner__link {
	color: #116240 !important;
}

/* Toasts land on the sky, so glass keeps them legible over any state. */
body[data-skin] .rcx-toastbar {
	${SMOKED}
	border-style: solid;
	border-width: 1px;
	border-radius: 13px;
	color: var(--ps-on-sky) !important;
}

/* Skeletons are white at 22–30% on clear glass — never grey boxes on paper. */
body[data-skin] .rcx-skeleton {
	background: rgba(255, 255, 255, 0.26) !important;
	border-radius: 8px;
}

/* Empty states sit on the sky; their ink flips with the sky state like headers. */
body[data-skin] .rcx-states,
body[data-skin] .rcx-states * {
	color: var(--ps-header-ink) !important;
	text-shadow: var(--ps-header-lift);
	background: transparent !important;
}

/* Buttons. Primary is a solid white slab with a deep-tone label — the one thing on
   screen that is not glass, paper or sky, which is what makes it read as the action.

   EVERY OTHER VARIANT — including the DEFAULT <Button> with no prop, which is what
   "New lead" is — gets clear glass. The default variant was the gap that left black
   dark-palette slabs sitting beside the white primary. The background here carries
   !important because the dark palette's own button fill is what it must beat; the
   bare \${CLEAR} background silently lost that fight. */
body[data-skin] .rcx-button--primary {
	background: #ffffff !important;
	color: #0A2216 !important;
	border-color: #ffffff !important;
}
body[data-skin] .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger) {
	${SMOKED}
	background: rgba(6, 40, 23, 0.60) !important;
	background-color: rgba(6, 40, 23, 0.60) !important;
	border: 1px solid rgba(255, 255, 255, 0.28) !important;
	color: var(--ps-on-sky) !important;
}
body[data-skin] .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger):hover {
	background: rgba(4, 30, 17, 0.72) !important;
}
/* ON PAPER the same variants must switch to ink-on-cream or they vanish into the
   sheet (glass) or blind it (white slab). Primary on paper becomes the accent —
   a white slab on cream is no longer "the action", it is a hole. */
body[data-skin] .rcx-tile .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger),
body[data-skin] .rcx-modal .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger),
body[data-skin] .mc-card .rcx-button:not(.rcx-button--primary):not(.rcx-button--danger) {
	background: transparent !important;
	-webkit-backdrop-filter: none;
	backdrop-filter: none;
	color: var(--ps-ink-quiet) !important;
	border-color: var(--ps-hairline) !important;
}
body[data-skin] .rcx-tile .rcx-button--primary,
body[data-skin] .rcx-modal .rcx-button--primary,
body[data-skin] .mc-card .rcx-button--primary {
	background: #17804D !important;
	color: #ffffff !important;
	border-color: #17804D !important;
}
body[data-skin] .rcx-button--danger {
	background: #CF4438 !important;
	color: #ffffff !important;
}

/* Focus ring: white on sky so it is visible against every tint. */
body[data-skin] *:focus-visible {
	outline: 2px solid #ffffff !important;
	outline-offset: 2px;
}

/* Mobile tab bar — smoked, active full white, inactive 55%. */
body[data-skin] .mc-mobile-tabbar {
	${SMOKED}
	border-style: solid;
	border-width: 1px;
}
body[data-skin] .mc-mobile-tabbar * {
	color: rgba(255, 255, 255, 0.55) !important;
}
body[data-skin] .mc-mobile-tabbar [aria-current='page'] * {
	color: #ffffff !important;
}
`;
