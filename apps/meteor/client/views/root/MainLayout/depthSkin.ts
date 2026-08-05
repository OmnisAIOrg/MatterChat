/**
 * ============================================================================
 * "FRAME & DEPTH" — the MatterChat shell elevation pass
 * ============================================================================
 *
 * Implements `handoff/MATTERCHAT-FRAME-SPEC.md`. This is a RESKIN: shadows, insets, borders,
 * radii, gradients on chrome surfaces, a few paddings, and scroll ownership. It changes NO
 * brand color, NO logo, NO copy, NO information architecture, and NO component boundary.
 *
 * THE CORE PRINCIPLE (spec §1) — depth happens once per plane, and each plane does one job.
 * Four nested planes, each unambiguously raised or recessed relative to its parent:
 *
 *   1 accent bezel   raised off the desktop   <body>          gradient + edge lip + ambient
 *   2 chrome frame   inside the bezel         #react-root     gradient + inset ring
 *   3 content well   RECESSED into chrome     #main-content   seam + 4-layer inset
 *   4 content cards  RAISED out of the well   .mc-card        contact + ambient pair
 *
 * Inside the chrome one recess repeats — the GROOVE (workspace strip, menu channel, room list,
 * title-bar icon buttons, search field). Inside a groove only the active item and the avatar
 * raise back out.
 *
 * WHY IT'S ALL IN THIS FILE (fork-safety): per `CLAUDE.md`, UI work must be additive and in our
 * own files — a line changed inside a Rocket.Chat core file conflicts on every upstream merge.
 * So the entire pass is CSS-variable + scoped-CSS only, injected from `MainLayoutStyleTags`
 * alongside the existing ledger/premium skins. The only edits to owned components are two marker
 * classes on the two rails we already own (`mc-rail-menu`, `mc-rail-workspace`).
 *
 * FEATURE FLAG (spec §8): every rule is scoped under `body.mc-depth`. Dropping that one class
 * reverts the entire pass with zero component changes — see `useDepthSkinFlag` below.
 *
 * `.rcx-*` CLASSES WE LEAN ON (may rename on a Rocket.Chat/Fuselage upgrade — re-verify then):
 *   - `.rcx-navbar`                    the title bar (plane 2, hosts the window controls)
 *   - `.rcx-sidebar--main`, `.rcx-sidepanel`  the room-list rail
 *   - `#main-content`                  the content well (id set in MainContent.tsx)
 *   - `#react-root`, `body`            the frame + bezel mount points (framed, not the app layout —
 *                                      see MATTERCHAT_FRAME_CSS for why that distinction matters)
 */

/** The one class every rule below is scoped under. Remove it and the reskin is gone. */
export const DEPTH_FLAG_CLASS = 'mc-depth';

/** localStorage override so the two treatments can be A/B'd live without a rebuild. */
export const DEPTH_FLAG_STORAGE_KEY = 'matterchat:depth';

type DepthTokens = {
	/** Well + card surfaces follow the light/dark theme. */
	wellFill: string;
	wellSeam: string;
	/**
	 * Well inset opacities. The spec's §3 percentages (45/32/24/18%) are written for a DARK well;
	 * applied literally to light paper they read as a dirty vignette rather than a recess. We keep
	 * the spec's *relationships* — top heaviest, then left, then right, bottom lightest, so light
	 * reads as coming from above — and scale the magnitudes to the surface. §9: "If your palette
	 * produces something that reads flat, check the shadow-opacity relationships first, not the hues."
	 */
	wellInsetTop: string;
	wellInsetLeft: string;
	wellInsetRight: string;
	wellInsetBottom: string;
	/** The light line that sits just below the seam, selling the lip. */
	wellSeamHighlight: string;
	cardFill: string;
	cardBorder: string;
	cardShadowContact: string;
	cardShadowAmbient: string;
	/** Top-edge scroll shade — proves content passes UNDER the frame instead of ending at it. */
	scrollShade: string;
};

/**
 * Chrome tokens are THEME-INDEPENDENT on purpose: MatterChat's rails and title bar are always
 * dark (the signature "global nav is dark" treatment — see AppLeftRail), so the bezel, frame,
 * groove and raised recipes are identical in light and dark. Only the well and cards re-theme.
 */
/**
 * VALUES ARE COPIED FROM THE SUITE REFERENCE IMPLEMENTATION — do not "improve" them in isolation.
 *
 * Omnis Command Center implements this same spec (OMNIS-SUITE-FRAME-SPEC.md) and is the app the
 * founder points at when he says "exactly like this". Its tokens live in
 * `~/Downloads/omnis-command-center/src/renderer/src/styles.css` under the
 * "Omnis Suite frame & depth reskin" banner. Every value below is that file's value, so the two
 * apps read as one product. If CC retunes, re-copy rather than diverge.
 */
const CHROME = {
	/** Bezel — the product's own accent. Green for both Command Center and MatterChat. */
	bezelTop: '#5FCB7A',
	bezelMid: '#2BA14C',
	bezelBottom: '#1B7A2E',
	/** Edge lip: a light top edge and a dark bottom edge make it a lip, not an outline. */
	bezelEdgeHighlight: 'rgba(255, 255, 255, 0.45)',
	bezelEdgeShade: 'rgba(9, 44, 21, 0.30)',
	/**
	 * Ambient shadow in the bezel's OWN dark hue, never neutral black — a neutral shadow under a
	 * saturated green reads as grime; a green-black reads as the object's own shadow.
	 *
	 * DELIBERATELY SMALL (CC's note, and it matters the moment the desktop window goes transparent):
	 * the blur must die out INSIDE the window's transparent gutter. A blur larger than the gutter
	 * gets clipped by the window bounds and you see a hard straight line where the transparency
	 * ends. An earlier value here was `0 28px 64px`, which would have done exactly that.
	 */
	bezelShadowAmbient: '0 8px 20px rgba(9, 44, 21, 0.45)',
	bezelShadowContact: '0 2px 6px rgba(9, 44, 21, 0.35)',

	/**
	 * Chrome frame — vertical gradient, light to dark. Kept clearly LIGHTER than the groove below
	 * it: if the chrome and the groove converge, the channel stops reading as carved.
	 */
	chromeTop: '#212A38',
	chromeBottom: '#161D27',
	chromeEdgeHighlight: 'rgba(255, 255, 255, 0.07)',
	chromeRing: 'rgba(255, 255, 255, 0.045)',
	chromeEdgeShade: 'rgba(0, 0, 0, 0.55)',
	chromeContact: '0 2px 6px rgba(6, 20, 11, 0.45)',

	/**
	 * Groove hosted BY THE CHROME — rail channels, title-bar search, icon buttons.
	 *
	 * SOLID, not a translucent wash. This is load-bearing: a translucent groove composites with
	 * whatever happens to sit behind it, so one stray light ancestor turns the whole channel into a
	 * pale grey block (which is exactly the bug that shipped mid-build). A solid fill is immune to
	 * its backdrop.
	 */
	grooveFill: '#0A0E14',
	grooveShadow: 'inset 0 2px 5px rgba(0, 0, 0, 0.55)',
	grooveHighlight: 'inset 0 -1px 0 rgba(255, 255, 255, 0.055)',

	/**
	 * The ONE raised recipe — active nav, primary buttons, the avatar, the active workspace tile,
	 * the room-list status bar. A GRADIENT, not a flat fill; that reuse is what tells the user
	 * "these are the lifted, interactive things".
	 */
	raiseFill: 'linear-gradient(180deg, #22B43F 0%, #1B7A2E 100%)',
	raiseFillHover: 'linear-gradient(180deg, #1FA439 0%, #176B28 100%)',
	raiseShadow: '0 2px 7px rgba(6, 20, 11, 0.45)',
	raiseHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.22)',

	/** Ink hosted directly by the chrome — the content accent fails contrast there. */
	chromeInk: '#C9D2E0',
	chromeInkMuted: '#8892A2',

	/** Hairline rule + section label color inside the chrome. */
	rule: 'rgba(255, 255, 255, 0.08)',
	sectionLabel: 'rgba(255, 255, 255, 0.38)',
} as const;

const LIGHT_DEPTH: DepthTokens = {
	wellFill: '#F6F6F3',
	/** CC's --well-seam, a near-black hairline that reads as the frame's own edge. */
	wellSeam: '#070A0F',
	/** CC's --well-recess, verbatim. Asymmetric so light reads as coming from above. */
	wellInsetTop: 'inset 0 3px 8px rgba(12, 20, 34, 0.17)',
	wellInsetLeft: 'inset 3px 0 7px rgba(12, 20, 34, 0.11)',
	wellInsetRight: 'inset -3px 0 7px rgba(12, 20, 34, 0.08)',
	wellInsetBottom: 'inset 0 -1px 4px rgba(12, 20, 34, 0.06)',
	wellSeamHighlight: '0 1px 0 rgba(255, 255, 255, 0.55)',
	cardFill: '#FFFFFF',
	cardBorder: 'rgba(16, 24, 20, 0.08)',
	/** CC's --card-shadow, verbatim. */
	cardShadowContact: '0 1px 2px rgba(20, 30, 60, 0.06)',
	cardShadowAmbient: '0 6px 14px -6px rgba(20, 30, 60, 0.16)',
	scrollShade: 'rgba(12, 20, 34, 0.14)',
};

const DARK_DEPTH: DepthTokens = {
	wellFill: '#0F1512',
	wellSeam: 'rgba(4, 7, 11, 0.85)',
	/** The dark well takes the spec's literal percentages — it has the headroom for them. */
	wellInsetTop: 'inset 0 3px 9px rgba(0, 0, 0, 0.45)',
	wellInsetLeft: 'inset 3px 0 8px rgba(0, 0, 0, 0.32)',
	wellInsetRight: 'inset -3px 0 8px rgba(0, 0, 0, 0.24)',
	wellInsetBottom: 'inset 0 -1px 4px rgba(0, 0, 0, 0.18)',
	wellSeamHighlight: '0 1px 0 rgba(255, 255, 255, 0.045)',
	cardFill: '#151C17',
	cardBorder: 'rgba(255, 255, 255, 0.07)',
	cardShadowContact: '0 1px 2px rgba(0, 0, 0, 0.40)',
	cardShadowAmbient: '0 6px 14px -6px rgba(0, 0, 0, 0.55)',
	scrollShade: 'rgba(0, 0, 0, 0.45)',
};

/** Geometry (spec §9). Nothing in the chrome is fluid; only the well flexes. */
const GEO = {
	radiusBezel: 20,
	radiusFrame: 13,
	radiusChannel: 11,
	radiusWell: 10,
	radiusCard: 9,
	radiusItem: 7,
	/**
	 * Bezel padding — the thickness of the green band around the chrome. The spec drew this at 9;
	 * founder called it at 12 (2026-08-04), which is what ships.
	 *
	 * KNOCK-ON: the desktop wrapper positions the macOS traffic lights in WINDOW coordinates, so they
	 * must move with this number. The NavBar's top-left sits at (body margin 8 + bezel) — 20px at
	 * bezel 12. See MatterChat-Desktop src/main/main.js `trafficLightPosition`; change both together
	 * or the lights drift off the NavBar.
	 */
	bezel: 12,
	/**
	 * The frame's right/bottom gutters — the chrome that continues around the well so it reads as a
	 * frame, not an L (spec §2). Deliberately a SEPARATE value from the bezel: this one is the dark
	 * chrome margin INSIDE the frame, and the spec's 9 still reads correctly at a 16px bezel.
	 */
	frameGutter: 9,
	titleBarHeight: 48,
	/**
	 * Desktop-only protruding tab. The spec drew it at 78px; founder called it narrower
	 * (2026-08-04), so it ships at 64 — still comfortably clearing the 36px workspace tiles once the
	 * tucked-edge padding is accounted for (64 − 10 − 14 = 40px of usable width).
	 */
	tabWidth: 64,
	/** <body>'s margin from the window edge, set in MATTERCHAT_FRAME_CSS. */
	bodyMargin: 8,
	railWorkspace: 62,
	railMenu: 88,
	railRooms: 236,
} as const;

/**
 * DERIVED geometry — computed from GEO so the pieces can never drift apart.
 *
 * `tabGutter` is the transparent strip the protruding tab lives in: the tab's own width plus the
 * body margin it sits inside. `framelessLightsLeft` is where the title bar begins once that gutter
 * pushes the whole frame right.
 *
 * These were hardcoded on the first frameless build, and narrowing the tab silently left the window
 * lights sitting on the tab instead of the title bar — outside the green frame. Deriving them makes
 * that class of mistake impossible.
 */
const DERIVED = {
	tabGutter: GEO.tabWidth + GEO.bodyMargin,
	get framelessFrameLeft(): number {
		return this.tabGutter + GEO.bezel;
	},
} as const;

/**
 * Where the client-drawn window lights belong on a frameless shell, in WINDOW coordinates.
 * Consumed by WindowLights — see the note there on why this is exported rather than hardcoded.
 * 10px in from the frame's left edge, vertically centred in the title bar.
 */
export const FRAMELESS_LIGHTS_POSITION = {
	left: DERIVED.framelessFrameLeft + 10,
	top: GEO.bodyMargin + GEO.bezel + (GEO.titleBarHeight - 12) / 2,
} as const;

/**
 * The four planes + the two repeating recipes.
 *
 * ORDER MATTERS in the shadow lists: a browser paints box-shadows first-to-last, so the contact
 * shadow must precede the ambient one, and inset highlights come after the fills they sit on.
 */
export const buildDepthCss = (theme: string): string => {
	const t = theme === 'dark' ? DARK_DEPTH : LIGHT_DEPTH;
	const f = `body.${DEPTH_FLAG_CLASS}`;

	return `
/* ---------------------------------------------------------------------------
   TOKENS — every rule below reads from these, so a retune is a one-line swap.
   No EXISTING color token's value changes; these are new, additive roles.
   --------------------------------------------------------------------------- */
${f} {
	--mc-bezel-top: ${CHROME.bezelTop};
	--mc-bezel-mid: ${CHROME.bezelMid};
	--mc-bezel-bottom: ${CHROME.bezelBottom};
	--mc-chrome-top: ${CHROME.chromeTop};
	--mc-chrome-bottom: ${CHROME.chromeBottom};
	--mc-groove-fill: ${CHROME.grooveFill};
	--mc-groove-shadow: ${CHROME.grooveShadow};
	--mc-groove-highlight: ${CHROME.grooveHighlight};
	--mc-raise-fill: ${CHROME.raiseFill};
	--mc-raise-fill-hover: ${CHROME.raiseFillHover};
	--mc-raise-shadow: ${CHROME.raiseShadow};
	--mc-raise-highlight: ${CHROME.raiseHighlight};
	--mc-chrome-ink: ${CHROME.chromeInk};
	--mc-chrome-ink-muted: ${CHROME.chromeInkMuted};
	--mc-rule: ${CHROME.rule};
	--mc-section-label: ${CHROME.sectionLabel};
	--mc-well-fill: ${t.wellFill};
	--mc-well-seam: ${t.wellSeam};
	--mc-card-fill: ${t.cardFill};
	--mc-card-border: ${t.cardBorder};
	--mc-card-shadow: ${t.cardShadowContact}, ${t.cardShadowAmbient};
	--mc-scroll-shade: ${t.scrollShade};
	--mc-radius-channel: ${GEO.radiusChannel}px;
	--mc-radius-item: ${GEO.radiusItem}px;
	--mc-radius-card: ${GEO.radiusCard}px;
}

/* ---------------------------------------------------------------------------
   PLANE 1 — ACCENT BEZEL. Raised off the desktop.
   Overrides the flat-shadow version in MATTERCHAT_FRAME_CSS: spec geometry (padding 9, radius 20)
   plus the edge lip and a green-black ambient pair instead of one neutral-black blur.
   --------------------------------------------------------------------------- */
${f} {
	border-radius: ${GEO.radiusBezel}px !important;
	background: linear-gradient(
		180deg,
		var(--mc-bezel-top) 0%,
		var(--mc-bezel-mid) 52%,
		var(--mc-bezel-bottom) 100%
	) !important;
	box-shadow:
		inset 0 1px 0 ${CHROME.bezelEdgeHighlight},
		inset 0 -1px 0 ${CHROME.bezelEdgeShade},
		${CHROME.bezelShadowContact},
		${CHROME.bezelShadowAmbient} !important;
}

/* ---------------------------------------------------------------------------
   PLANE 2 — CHROME FRAME. Sits inside the bezel; hosts the title bar and all rails.
   The gutter is what makes this a FRAME rather than an L: 9px of chrome continues down the
   right side and across the bottom, enclosing the well on all four sides (spec §2 — "the single
   most important detail in the spec"). An L-shaped chrome reads as two panels butted together.
   --------------------------------------------------------------------------- */
${f} #react-root {
	inset: ${GEO.bezel}px !important;
	border-radius: ${GEO.radiusFrame}px !important;
	background: linear-gradient(180deg, var(--mc-chrome-top) 0%, var(--mc-chrome-bottom) 100%) !important;
	box-shadow:
		inset 0 1px 0 ${CHROME.chromeEdgeHighlight},
		inset 0 0 0 1px ${CHROME.chromeRing},
		inset 0 -1px 0 ${CHROME.chromeEdgeShade},
		${CHROME.chromeContact} !important;
}

/* The rails + well row. padding-right/bottom ARE the frame's gutters; the left gutter comes from
   the workspace strip's own padding so its groove can still bleed to the frame edge. */
${f} #rocket-chat {
	padding: 0 ${GEO.frameGutter}px ${GEO.frameGutter}px 0;
	background: transparent !important;
	box-sizing: border-box;
}

/* Title bar and both rails go TRANSPARENT so the single chrome gradient reads through all of them.
   Their previously-separate flat fills (#1A212C nav rail vs #0C0F14 workspace rail) are exactly the
   "two panels butted together" defect this pass exists to fix. */
${f} .rcx-navbar,
${f} .mc-rail-menu,
${f} .mc-rail-workspace,
${f} .rcx-sidebar--main,
${f} .rcx-sidebar:has(.rcx-sidebar--main),
${f} .rcx-sidepanel {
	background: transparent !important;
	background-color: transparent !important;
}

/*
 * READ BEFORE WIDENING THIS SELECTOR — it caused the two worst bugs of this pass.
 *
 * The room-list rail is TWO nested elements. The inner one carries '.rcx-sidebar--main'; the outer
 * wrapper carries only the bare '.rcx-sidebar' class. The dark PaletteStyleTag's selector is
 * '.rcx-sidebar--main, .rcx-sidepanel, .rcx-navbar', so that outer wrapper is NOT covered by it and
 * paints from the LIGHT palette — rgb(228, 231, 234). It never showed, because the inner element
 * painted an opaque dark fill over it. The moment this pass made the inner element transparent so
 * the chrome gradient could read through, the light wrapper became the backdrop and the room-list
 * groove (a 22% BLACK wash) composited over near-white as a pale grey block. Hence the wrapper must
 * go transparent too.
 *
 * BUT the obvious fix — a blanket '.rcx-sidebar' — is WRONG and broke every non-chat route.
 * '.rcx-sidebar' is also worn by fork-owned LIGHT panels ('.mc-boards-sidebar', '.flex-nav', and
 * the Activity/Admin panels), whose contents are dark-text-on-light (color rgb(47, 52, 61)).
 * Stripping their background left dark text sitting on the dark chrome — invisible. Chat looked
 * fine only because its rail is genuinely light-on-dark.
 *
 * So the rule is scoped by CONTENT, not by class: ':has(.rcx-sidebar--main)' matches only the
 * wrapper that actually contains the room list. Every other '.rcx-sidebar' keeps its own fill.
 * ':has()' is supported everywhere this ships (Chromium 105+; the desktop app is Electron 36).
 *
 * The general principle, since this will come up again: only make a container transparent when its
 * CONTENT is already styled for the dark chrome. Otherwise you are not revealing the chrome, you
 * are deleting a panel's background.
 */

/* The rails carried their own dividers; the chrome gradient is continuous now, so the seams go. */
${f} .mc-rail-menu {
	border-right: 0 !important;
	box-shadow: none !important;
}

/* Title bar — height and the drag region are already set upstream; here it only loses its border
   and gains the spec's gap so the icon clusters sit on a consistent rhythm. */
${f} .rcx-navbar {
	height: ${GEO.titleBarHeight}px;
	border-block-end: 0 !important;
	box-shadow: none !important;
}

/* ---------------------------------------------------------------------------
   THE GROOVE — the one recess that repeats inside the chrome.
   Applied to: the menu channel, the workspace channel, the room-list channel, title-bar icon
   buttons and the search field. Everything else in the chrome is flat.
   --------------------------------------------------------------------------- */
${f} .mc-groove {
	background: var(--mc-groove-fill);
	border-radius: var(--mc-radius-channel);
	box-shadow: var(--mc-groove-shadow), var(--mc-groove-highlight);
}

/* Title-bar icon buttons + search field are grooves too (spec §3). 27x27 / radius 7 for buttons,
   radius 8 for the search field. Scoped to the navbar so no other icon button is caught. */
${f} .rcx-navbar button.rcx-button--icon,
${f} .rcx-navbar .rcx-box--with-inline-elements > button {
	border-radius: ${GEO.radiusItem}px;
	background: var(--mc-groove-fill);
	box-shadow: var(--mc-groove-shadow), var(--mc-groove-highlight);
}

${f} .rcx-navbar [role='search'],
${f} .rcx-navbar .rcx-input-box__wrapper {
	border-radius: 8px;
	border-color: transparent;
	background: var(--mc-groove-fill);
	box-shadow: var(--mc-groove-shadow), var(--mc-groove-highlight);
}

/* ---------------------------------------------------------------------------
   THE RAISED RECIPE — active nav, primary buttons, avatars, active workspace tile, status bar.
   One recipe, reused, so "lifted" always means the same thing.
   --------------------------------------------------------------------------- */
${f} .mc-raised {
	background: var(--mc-raise-fill);
	box-shadow: var(--mc-raise-shadow), var(--mc-raise-highlight);
	color: #fff;
}

${f} .mc-raised:hover {
	background: var(--mc-raise-fill-hover);
}

/* The active nav item in both owned rails uses the SAME raised recipe. Overriding the flat green
   the rails set inline keeps one definition of "lifted" across the whole shell. */
${f} .mc-rail-menu button[aria-current='page'] {
	background: var(--mc-raise-fill) !important;
	box-shadow: var(--mc-raise-shadow), var(--mc-raise-highlight) !important;
}

${f} .mc-rail-menu button[aria-current='page']:hover {
	background: var(--mc-raise-fill-hover) !important;
}

/* Resting nav items carry NO shadow, NO border, NO fill — ten identical raised chips read as a
   stack, not a rail. That was the original defect this pass fixes (spec §7). */
${f} .mc-rail-menu nav li > *,
${f} .mc-rail-menu button {
	transition: background-color 0.12s ease-out, box-shadow 0.12s ease-out;
}

/* Hover is a background wash ONLY — never a shadow, scale, or movement anywhere in the chrome. */
${f} .mc-rail-menu button:hover:not([aria-current='page']),
${f} .mc-rail-workspace button:hover:not([aria-pressed='true']) {
	box-shadow: none;
}

/* ---------------------------------------------------------------------------
   ROOM LIST RAIL — the widest rail, and the one that most sells the carved look.
   Structure (read off the live DOM; the inner divs carry unstable emotion hashes, so these are
   STRUCTURAL selectors on purpose):
     nav.rcx-sidebar--main
       > div:first-child      the scroll region  -> THE CHANNEL (groove)
       > .rcx-sidebar-footer  wordmark + status  -> raised strip
   --------------------------------------------------------------------------- */
${f} .rcx-sidebar--main {
	padding: 0 6px 0 0;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

/* The channel. Same groove recipe as the two nav rails — one recess language everywhere. */
${f} .rcx-sidebar--main > div:first-child {
	border-radius: var(--mc-radius-channel);
	padding: 4px;
	box-sizing: border-box;
	background: var(--mc-groove-fill);
	box-shadow: var(--mc-groove-shadow), var(--mc-groove-highlight);
}

/* Group header bar. It shipped with an opaque fill (rgb(47,52,61)), which is exactly the "resting
   item with a fill" defect — ten filled bars read as stacked chips instead of one carved run.
   Rest is now bare groove; the label alone carries the hierarchy. */
${f} .rcx-sidebar-v2-collapse-group__bar,
${f} .rcx-sidebar-v2-accordion-item__bar {
	/* Upstream paints both from one rule:
	     .rcx-sidebar-v2-accordion-item__bar, .rcx-sidebar-v2-collapse-group__bar
	       { background-color: var(--rcx-sidebar-color-surface-default, …) }
	   !important is needed to beat it without editing core. */
	background: transparent !important;
	border-radius: var(--mc-radius-item);
}

${f} .rcx-sidebar-v2-collapse-group__bar:hover,
${f} .rcx-sidebar-v2-accordion-item__bar:hover {
	background: rgba(255, 255, 255, 0.06) !important;
}

/* Room rows: radius 7 to match every other item in a groove, and a wash-only hover. */
${f} .rcx-sidebar-v2-item {
	border-radius: var(--mc-radius-item);
	transition: background-color 0.12s ease-out, box-shadow 0.12s ease-out;
}

${f} .rcx-sidebar-v2-item:hover {
	box-shadow: none;
}

/* Selected room is the shared RAISED recipe — the same lift as the active nav item and the active
   workspace tile, so "lifted" means one thing across the whole shell. */
${f} .rcx-sidebar-v2-item--selected,
${f} .rcx-sidebar-v2-item[aria-selected='true'] {
	box-shadow: var(--mc-raise-shadow), var(--mc-raise-highlight);
}

/* Unread rows get a wash, never a shadow (spec §3). */
${f} .rcx-sidebar-v2-item--unread:not(.rcx-sidebar-v2-item--selected) {
	background-color: rgba(255, 255, 255, 0.045);
	box-shadow: none;
}

/* The footer is the rail's one RAISED strip — a live status surface, not a nav target. */
${f} .rcx-sidebar-footer {
	border-radius: 9px;
	padding: 9px 10px;
	box-sizing: border-box;
	background: linear-gradient(180deg, rgba(255, 255, 255, 0.035) 0%, rgba(255, 255, 255, 0.012) 100%);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 2px 6px rgba(0, 0, 0, 0.32);
}

/* ---------------------------------------------------------------------------
   PLANE 3 — CONTENT WELL. Recessed into the chrome.
   The 1px seam plus a four-layer asymmetric inset: heaviest at the top, lighter down the left,
   lighter still on the right, lightest at the bottom — so light reads as coming from above.
   NOTE: the spec's blanket 22px padding is deliberately NOT applied here. #main-content also hosts
   the chat room, whose header / message list / composer are full-bleed by design (spec §5.5 — the
   well owns the border, seam, radius and scroll; content may bleed to its edge). Card-based pages
   bring their own padding.
   --------------------------------------------------------------------------- */
${f} #main-content {
	border-radius: ${GEO.radiusWell}px;
	border: 1px solid var(--mc-well-seam);
	background-color: var(--mc-well-fill);
	overflow: hidden;
	box-shadow:
		${t.wellInsetTop},
		${t.wellInsetLeft},
		${t.wellInsetRight},
		${t.wellInsetBottom},
		${t.wellSeamHighlight};
}

/* Scroll shade — a 16px gradient pinned inside the well's top edge, INSIDE the seam so it never
   covers the border. Opacity is driven from JS (useWellScrollShade) over the first 40px of scroll.
   Without it, content appears to END at the frame; with it, content passes UNDER the frame. */
${f} .mc-scroll-shade {
	position: absolute;
	top: 1px;
	left: 1px;
	right: 1px;
	height: 16px;
	border-radius: ${GEO.radiusCard}px ${GEO.radiusCard}px 0 0;
	pointer-events: none;
	z-index: 3;
	opacity: 0;
	transition: opacity 0.12s ease-out;
	background: linear-gradient(180deg, var(--mc-scroll-shade) 0%, transparent 100%);
}

/* ---------------------------------------------------------------------------
   PLANE 4 — CONTENT CARDS. Raised out of the well.
   EVERY card sits at the same elevation, always. A "more important" card does not get a bigger
   shadow — it gets more space or a heavier heading (spec §3).
   --------------------------------------------------------------------------- */
${f} .mc-card {
	/* !important only on the radius: the cards keep Fuselage's borderRadius='x8' prop so they still
	   look right with the flag OFF, and that utility class would otherwise win the 8-vs-9 contest. */
	border-radius: var(--mc-radius-card) !important;
	border: 1px solid var(--mc-card-border);
	background-color: var(--mc-card-fill);
	box-shadow: var(--mc-card-shadow);
}

/* A segmented stat strip is ONE card with internal dividers — four cards would read as four
   planes. This is the KPI row on My Day. */
${f} .mc-card--segmented > * + * {
	border-left: 1px solid var(--mc-card-border);
}

/* ---------------------------------------------------------------------------
   OVERLAYS — modals, dropdowns, toasts, command palettes, context menus.
   These MUST sit above the bezel and get ONE ambient shadow — not the card recipe, not the frame
   recipe. Rocket.Chat already portals them to <body>, which is outside #main-content's overflow,
   so they are structurally safe from the well's clip; this only normalizes their elevation.
   --------------------------------------------------------------------------- */
${f} .rcx-tile,
${f} .rcx-options {
	box-shadow: 0 16px 40px rgba(0, 0, 0, 0.34);
}

/* ---------------------------------------------------------------------------
   DESKTOP ONLY — THE PROTRUDING WORKSPACE TAB (frame spec §3, "the only platform difference").
   Gated on body.mc-desktop-frameless, which MainLayoutStyleTags sets only when the wrapper reports
   the frameless capability. Inert in the browser, the PWA, and on older desktop builds — and the
   spec is explicit that the tab must NEVER ship on web, because a browser tab has no window to
   protrude from and it just reads as a stray panel.

   HOW IT ESCAPES THE FRAME: the strip cannot simply be pulled left, because #react-root is the
   chrome frame and clips its children (overflow: hidden). So the strip is lifted OUT of the flex
   row with position: fixed and parked in a transparent gutter that we open up on the left by
   widening the body's margin. The window itself is frameless + transparent, so that gutter is
   genuinely see-through desktop rather than dark chrome.
   --------------------------------------------------------------------------- */
/* MAKE THE WINDOW ACTUALLY TRANSPARENT.
   MATTERCHAT_FRAME_CSS paints html a solid #0C0F14 so the browser/PWA has a backdrop behind the
   floating bezel. On a frameless Electron window that fills the ENTIRE window rect with opaque
   dark, which cancels transparent: true outright — the tab then reads as a panel welded to a
   black slab instead of a tab floating beside the app. Dropping it is what lets the desktop show
   through the gutter, the 8px margins, and around the bezel's rounded corners.

   Scoped with :has() because the class lives on <body> and the fill is on <html>. */
html:has(body.${DEPTH_FLAG_CLASS}.mc-desktop-frameless) {
	background: transparent !important;
}

/*
 * CANVAS BACKGROUND PROPAGATION — the reason the first attempt made things WORSE.
 *
 * Clearing the background on <html> alone is not enough, and is actively counterproductive. Per
 * CSS backgrounds §2.11.2, when the ROOT element's background is transparent the BODY's background
 * is propagated to the canvas and painted across the ENTIRE viewport — ignoring body's own margins
 * and border-radius. And <body> IS the green bezel here. So transparent-html didn't reveal the
 * desktop; it let the bezel's green flood the whole window, corners and gutter included.
 *
 * You cannot fix that by re-adding a background to <html> either — a non-transparent root is
 * exactly what we're trying to avoid on a transparent window.
 *
 * So: <body> gets NO background (nothing left to propagate), and the bezel moves to a fixed
 * pseudo-element occupying precisely body's border box. The green is then confined to that rect,
 * and everything outside it — the tab gutter, the margins, outside the rounded corners — is
 * genuinely see-through to the desktop.
 */
${f}.mc-desktop-frameless {
	background: none !important;
	box-shadow: none !important;
}

${f}.mc-desktop-frameless::before {
	content: '';
	position: fixed;
	/* Matches body's own box: bodyMargin on three sides, the tab gutter on the leading edge. */
	top: ${GEO.bodyMargin}px;
	inset-inline-end: ${GEO.bodyMargin}px;
	bottom: ${GEO.bodyMargin}px;
	inset-inline-start: ${DERIVED.tabGutter}px;
	z-index: -1;
	pointer-events: none;
	border-radius: ${GEO.radiusBezel}px;
	background: linear-gradient(
		180deg,
		var(--mc-bezel-top) 0%,
		var(--mc-bezel-mid) 52%,
		var(--mc-bezel-bottom) 100%
	);
	/*
	 * INSET EDGES ONLY — no outward shadow on the frameless shell.
	 *
	 * A drop shadow is a real painted pixel, and on a transparent window it paints INTO the
	 * see-through region: over the user's desktop, as a grey-green smudge around the frame. That is
	 * the opposite of transparent. The spec's ambient/contact pair assumes an opaque backdrop to
	 * fall onto; here there isn't one. macOS also gives the window no native shadow
	 * (hasShadow:false), so nothing replaces it — which is the intent: outside the frame, nothing
	 * is drawn at all.
	 */
	box-shadow:
		inset 0 1px 0 ${CHROME.bezelEdgeHighlight},
		inset 0 -1px 0 ${CHROME.bezelEdgeShade};
}

${f}.mc-desktop-frameless {
	/* Open a ${DERIVED.tabGutter}px transparent gutter on the left for the tab to live in. The bezel
	   starts after it, so the tab reads as tucked BEHIND the bezel's rounded edge. */
	margin-inline-start: ${DERIVED.tabGutter}px !important;
	width: calc(100vw - ${DERIVED.tabGutter + GEO.bodyMargin}px) !important;
}

/* ESCAPE THE CONTAINING-BLOCK TRAP (cost a debugging round — don't remove).
   A position: fixed element is positioned against the VIEWPORT only if no ancestor establishes a
   containing block. The workspace rail sits inside a Rocket.Chat wrapper carrying
   will-change: transform (for the mobile drawer slide), and will-change alone is enough to make
   that wrapper the containing block. The tab was landing at x=103 instead of x=8 and collapsing to
   22px tall because it was being positioned against — and clipped by — that wrapper.

   Scoped with :has() to ONLY the wrapper that actually contains the workspace rail, so the room
   list's own slide animation is untouched, and only on the frameless desktop shell. */
${f}.mc-desktop-frameless .rcx-sidebar:has(.mc-rail-workspace) {
	transform: none !important;
	will-change: auto !important;
}

${f}.mc-desktop-frameless .mc-rail-workspace {
	position: fixed;
	/* 8px from the window edge, and dropped below the title bar's rounded corner. */
	inset-inline-start: 8px;
	top: 34px;
	bottom: 22px;
	width: ${GEO.tabWidth}px;
	min-width: ${GEO.tabWidth}px;
	height: auto;
	box-sizing: border-box;
	/* Extra inline-end padding covers the strip of tab that is tucked behind the bezel. */
	/* Tightened with the narrower tab. The larger inline-end value still covers the strip that is
	   tucked behind the bezel; 64 − 10 − 14 leaves 40px of usable width for the 36px tiles. */
	padding: 10px 14px 10px 10px;
	/* Rounded on the OUTER edge only; square where it meets the bezel, so the two read as one
	   object rather than a floating pill parked next to the window. */
	border-radius: ${GEO.radiusBezel}px 0 0 ${GEO.radiusBezel}px;
	/* !important because the rail is in the go-transparent list above (so the chrome gradient can
	   read through it when it is INSIDE the frame). As a protruding tab it is no longer sitting on
	   the chrome — it IS chrome — so it has to paint the gradient itself and out-rank that rule. */
	background: linear-gradient(180deg, var(--mc-chrome-top) 0%, var(--mc-chrome-bottom) 100%) !important;
	/* INSET EDGES ONLY. The spec gives the tab a directional shadow falling left and down, to sell
	   "this sits behind the window". That works against an opaque backdrop; on a TRANSPARENT window
	   it paints a large green-black smudge straight onto the user's desktop — the biggest single
	   source of visible bleed outside the frame. The tab's own edge highlights carry the depth. */
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.14),
		inset 1px 0 0 rgba(255, 255, 255, 0.08),
		inset 0 -1px 0 rgba(0, 0, 0, 0.60);
	/* Under the bezel (which the frame gives z-index 1), so the bezel overlaps the tab's inner edge. */
	z-index: 0;
}

/* The tab is chrome, so it is part of the window's drag surface — but its tiles must not be. */
${f}.mc-desktop-frameless .mc-rail-workspace {
	-webkit-app-region: drag;
	app-region: drag;
}

${f}.mc-desktop-frameless .mc-rail-workspace button,
${f}.mc-desktop-frameless .mc-rail-workspace a,
${f}.mc-desktop-frameless .mc-rail-workspace [role='button'] {
	-webkit-app-region: no-drag;
	app-region: no-drag;
}

/* With the strip lifted out of the flex row, the menu rail becomes the first column, so the frame's
   left gutter now has to come from the row itself. */
${f}.mc-desktop-frameless #rocket-chat {
	padding-inline-start: ${GEO.frameGutter}px;
}

/* The client-drawn window lights must be excluded from the window's drag region, or clicking Close
   drags the window instead — on a window that has no other way to close. WindowLights also sets this
   inline; this rule is the belt-and-braces copy that survives a style-prop refactor. */
${f} .mc-window-lights,
${f} .mc-window-lights button {
	-webkit-app-region: no-drag;
	app-region: no-drag;
}

/* The frameless shell has no native title bar, so the client's own lights need the room the native
   traffic lights used to be given. Same 78px, different owner. */
${f}.mc-desktop-frameless .rcx-navbar {
	padding-inline-start: 78px !important;
}

/* ---------------------------------------------------------------------------
   MOBILE — below the md breakpoint the frame goes full-bleed (MATTERCHAT_FRAME_CSS already drops
   the body margin and radius). The gutters and the well's radius/seam would waste ~20px of a phone
   screen and clip the edge-to-edge room view, so the depth pass stands down to a flat surface.
   --------------------------------------------------------------------------- */
@media (max-width: 767.98px) {
	${f} #react-root {
		inset: 0 !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}
	${f} #rocket-chat {
		padding: 0;
	}
	${f} #main-content {
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}
}

/* ---------------------------------------------------------------------------
   PRINT + REDUCED MOTION.
   --------------------------------------------------------------------------- */
@media print {
	${f},
	${f} #react-root,
	${f} #main-content {
		background: #fff !important;
		box-shadow: none !important;
		border: 0 !important;
		border-radius: 0 !important;
		inset: 0 !important;
	}
}

@media (prefers-reduced-motion: reduce) {
	${f} .mc-scroll-shade,
	${f} .mc-rail-menu button,
	${f} .mc-rail-workspace button {
		transition: none;
	}
}
`;
};
