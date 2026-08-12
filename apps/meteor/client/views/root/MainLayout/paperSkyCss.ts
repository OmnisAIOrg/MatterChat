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

/** Smoked — the only material white body text clears AA on, in every sky state. */
const SMOKED = `
	-webkit-backdrop-filter: blur(50px) saturate(180%);
	backdrop-filter: blur(50px) saturate(180%);
	background: rgba(0, 0, 0, 0.52);
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

/* The sky sits at the bottom of the window's stacking order. */
body[data-skin] .ps-sky {
	position: absolute;
	inset: 0;
	z-index: 0;
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
   .rcx-page is here because MatterChat's own screens set an inline page
   background — without it the home dashboard paints an opaque sheet over the sky
   and the theme looks like it did nothing but tint the sidebar. */
body[data-skin] #rocket-chat,
body[data-skin] .rcx-content--main,
body[data-skin] .rcx-sidebar,
body[data-skin] .rcx-sidebar--main > *,
body[data-skin] .rcx-page,
body[data-skin] .rcx-page-content,
body[data-skin] main {
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
	background: rgba(0, 0, 0, 0.52) !important;
	background-color: rgba(0, 0, 0, 0.52) !important;
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
	background: rgba(0, 0, 0, 0.22) !important;
	border-color: rgba(255, 255, 255, 0.14) !important;
}

/* THE ROOM COLUMN. Template classes, not Fuselage ones, each with an opaque
   ground. Without these the sky stops at the channel list and the entire
   conversation sits on flat navy. */
body[data-skin] .messages-box,
body[data-skin] .messages-container-main,
body[data-skin] .messages-container-wrapper,
body[data-skin] .messages-list,
body[data-skin] .rcx-room,
body[data-skin] .rcx-vertical-bar,
body[data-skin] .rcx-contextual-bar {
	background: transparent !important;
	background-color: transparent !important;
}

body[data-skin] .rcx-room-header {
	${FROSTED}
	background: linear-gradient(135deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.09) 52%, rgba(255, 255, 255, 0.15)) !important;
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

/* ---- TYPE ON SKY: white only, hierarchy by weight and opacity ---- */
body[data-skin] .rcx-navbar,
body[data-skin] .rcx-navbar *,
body[data-skin] .rcx-sidebar--main,
body[data-skin] .rcx-sidebar--main *,
body[data-skin] .rcx-sidepanel,
body[data-skin] .rcx-sidepanel *,
body[data-skin] .rcx-room-header,
body[data-skin] .rcx-room-header * {
	color: var(--ps-on-sky) !important;
	border-color: rgba(255, 255, 255, 0.18);
}
body[data-skin] .rcx-sidebar-item--clickable:hover {
	background: rgba(255, 255, 255, 0.16) !important;
}
body[data-skin] .rcx-sidebar-item--selected {
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
	margin-top: -2px;
	border-top-left-radius: 6px;
	border-top-right-radius: 6px;
	box-shadow: none;
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

/* Date divider is a pill ON the sky between sheets, so it stays glass. */
body[data-skin] .rcx-message-divider {
	background: transparent !important;
}
body[data-skin] .rcx-message-divider .rcx-bubble,
body[data-skin] .rcx-message-divider .rcx-divider-bubble {
	${CLEAR}
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

/* Composer is chrome, not content — it frames what you are about to write.
   The !important here is load-bearing: the composer carries its own opaque ground, and
   without it the material silently loses and the composer stays flat navy on the
   sky. Same reason the rails needed it. */
body[data-skin] .rcx-message-composer,
body[data-skin] .rcx-message-box,
body[data-skin] .rc-message-box {
	${SMOKED}
	background: rgba(0, 0, 0, 0.52) !important;
	background-color: rgba(0, 0, 0, 0.52) !important;
	border-style: solid;
	border-width: 1px;
	border-radius: 15px;
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
/* The composer's inner toolbar/footer strips carry their own fills. */
body[data-skin] .rcx-message-composer__toolbar,
body[data-skin] .rcx-message-composer-toolbar,
body[data-skin] .rcx-message-box__toolbar {
	background: transparent !important;
}
body[data-skin] .rcx-message-composer *,
body[data-skin] .rcx-message-box *,
body[data-skin] .rcx-message-composer .rcx-box--with-inline-elements {
	color: var(--ps-on-sky) !important;
}
body[data-skin] .rcx-message-composer textarea::placeholder {
	color: var(--ps-on-sky-3) !important;
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
body[data-skin] .rcx-tile *,
body[data-skin] .mc-card * {
	border-color: var(--ps-hairline);
}

/* Page headers sit ON the sky, above the paper — so they stay white. */
body[data-skin] .rcx-page-header,
body[data-skin] .rcx-page-header *,
body[data-skin] .mc-board-header,
body[data-skin] .mc-board-header * {
	color: var(--ps-on-sky) !important;
	text-shadow: var(--ps-lift);
	background: transparent !important;
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
body[data-skin] .rcx-modal *,
body[data-skin] .rcx-modal-title {
	color: var(--ps-ink);
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

/* Empty states sit on the sky and stay white; the sky is doing the work. */
body[data-skin] .rcx-states,
body[data-skin] .rcx-states * {
	color: var(--ps-on-sky) !important;
	text-shadow: var(--ps-lift);
	background: transparent !important;
}

/* Buttons. Primary is a solid white slab with a deep-tone label — the one thing on
   screen that is not glass, paper or sky, which is what makes it read as the action. */
body[data-skin] .rcx-button--primary {
	background: #ffffff !important;
	color: #0A2216 !important;
	border-color: #ffffff !important;
}
body[data-skin] .rcx-button--secondary,
body[data-skin] .rcx-button--ghost {
	${CLEAR}
	border-style: solid;
	border-width: 1px;
	color: var(--ps-on-sky) !important;
}
/* On paper, a ghost button must switch to ink or it disappears into the sheet. */
body[data-skin] .rcx-tile .rcx-button--ghost,
body[data-skin] .rcx-modal .rcx-button--ghost,
body[data-skin] .mc-card .rcx-button--ghost {
	background: transparent !important;
	-webkit-backdrop-filter: none;
	backdrop-filter: none;
	color: var(--ps-ink-quiet) !important;
	border-color: var(--ps-hairline) !important;
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
