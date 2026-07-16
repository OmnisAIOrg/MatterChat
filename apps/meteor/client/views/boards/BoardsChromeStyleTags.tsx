import { useThemeMode } from '@rocket.chat/ui-client';

/**
 * ============================================================================
 * "LEDGER-DENSE" — Boards CHROME skin (board header strip, boards nav, page shells).
 * ============================================================================
 *
 * The Boards counterpart to the chat-surface Ledger skin in
 * client/views/root/MainLayout/MainLayoutStyleTags.tsx — SAME token values
 * (paper #FAF7EE light / #12161D dark, cards #fffdf6 + #f2efe2 light / #1A2029
 * dark, khaki strokes, brand green #1B7A2E with #15692A/#5BD07E link greens,
 * the Iowan/Palatino serif caption stack, tabular-nums for figures, SOL-heat
 * amber #e0a63c / red #e35d5d). Do not drift from that file.
 *
 * FORK-SAFE: presentation only. Every rule is scoped under an `mc-*` class
 * that only the boards chrome files add (BoardHeader, the CasePro strip, the
 * boards routes' Page shells, the boards secondary sidebar). No shared/core
 * component is edited; no behavior, endpoint, or data flow is touched.
 *
 * Mounted once from BoardsSidebar (which BoardsLayout portals on EVERY /boards
 * route), so the CSS is present wherever the classes appear. High-contrast
 * (accessibility) theme renders nothing — boards chrome stays stock there,
 * mirroring the `branded` gate in MainLayoutStyleTags. No animations or
 * transitions are introduced, so there is nothing to gate behind
 * prefers-reduced-motion.
 */

type BoardsChromeTokens = {
	/** Board-header strip surface (the "card" tone). */
	headerBg: string;
	/** Khaki (light) / slate (dark) hairline under the strip and beside the nav. */
	hairline: string;
	/** Connection dot when CasePro is live+reachable. */
	dotConnected: string;
	/** Active nav item / active status tag: background, text, left rail. */
	activeBg: string;
	activeText: string;
	activeRail: string;
	/** Boards secondary-sidebar surface. */
	sidebarBg: string;
};

// Serif "case caption" + mono-ish label stacks — same families as the chat skin.
const CAPTION_SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif`;
const LABEL_MONO = `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

// SOL-heat amber/red — connection-state dots for stub/unreachable (both themes).
const DOT_STUB = '#e0a63c';
const DOT_UNREACHABLE = '#e35d5d';

const LIGHT: BoardsChromeTokens = {
	headerBg: '#fffdf6', // card tone on the #FAF7EE paper page
	hairline: 'rgba(201, 190, 154, 0.6)', // #C9BE9A warm khaki, softened
	dotConnected: '#1B7A2E', // brand green
	activeBg: '#E4F3E8',
	activeText: '#15692A', // link green on paper
	activeRail: '#1B7A2E',
	sidebarBg: '#f2efe2', // warm card-alt, slightly deeper than the paper page
};

const DARK: BoardsChromeTokens = {
	headerBg: '#1A2029', // dark card on the #12161D page
	hairline: 'rgba(58, 65, 77, 0.9)', // #3A414D slate
	dotConnected: '#5BD07E', // link green on dark
	activeBg: '#24352A',
	activeText: '#5BD07E',
	activeRail: '#3FA85C',
	sidebarBg: '#12161D', // calm flat dark (same family as the page)
};

const buildBoardsChromeCss = (t: BoardsChromeTokens): string => `
/* ---------------------------------------------------------------------------
 * BOARD HEADER — one dense ledger strip. Card-tone surface, constant khaki
 * rule underneath (replaces the scroll-reactive border: a ledger line is
 * always drawn), single row that NEVER wraps.
 * ------------------------------------------------------------------------ */
.mc-board-header {
	background-color: ${t.headerBg};
	border-block-end: 1px solid ${t.hairline} !important;
}
.mc-board-header > div {
	flex-wrap: nowrap;
	column-gap: 8px;
	min-height: 52px;
	margin-inline: 16px;
}
/* Serif "case caption" board title; truncates instead of wrapping the strip. */
.mc-board-header h1 {
	font-family: ${CAPTION_SERIF};
	font-weight: 600;
	font-size: 1.125rem;
	letter-spacing: 0.005em;
	min-width: 0;
}
/* Generic-board variant: the ViewSwitcher tab area (not the title) is the
   flexible middle, so the caption keeps its natural width and yields space. */
.mc-board-header--tabs h1 {
	flex: 0 1 auto;
	min-width: 72px;
}

/* The remaining lifecycle Tag ("Active" etc.) — dense mono docket stamp, not a
   stock chip. Variant fills stay for meaning; primary re-tints to ledger green. */
.mc-board-header .rcx-tag {
	font-family: ${LABEL_MONO};
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
}
.mc-board-header .rcx-tag--primary {
	background-color: ${t.activeBg};
	color: ${t.activeText};
}

/* ---------------------------------------------------------------------------
 * CASEPRO STRIP — tiny dot + word, quiet last-sync figure, icon actions.
 * ------------------------------------------------------------------------ */
.mc-cp-strip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
	flex: 0 0 auto;
}
.mc-cp-status {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	font-weight: 500;
	white-space: nowrap;
	color: var(--rcx-color-font-default);
}
.mc-cp-dot {
	display: inline-block;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	flex: none;
}
.mc-cp-dot[data-state='connected'] {
	background-color: ${t.dotConnected};
}
.mc-cp-dot[data-state='stub'] {
	background-color: ${DOT_STUB};
}
.mc-cp-dot[data-state='unreachable'] {
	background-color: ${DOT_UNREACHABLE};
}
.mc-cp-lastsync {
	font-size: 11px;
	color: var(--rcx-color-font-hint);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
/* Degrade order: the last-sync figure is the first thing to go when narrow. */
@media (max-width: 1240px) {
	.mc-board-header .mc-cp-lastsync {
		display: none;
	}
}

/* ---------------------------------------------------------------------------
 * BOARDS NAV (secondary sidebar) — ledger density, mono group labels,
 * green-accented active row.
 * ------------------------------------------------------------------------ */
.rcx-sidebar.mc-boards-sidebar {
	background-color: ${t.sidebarBg};
	border-inline-end: 1px solid ${t.hairline};
}
.mc-boards-nav .rcx-sidebar-item {
	font-size: 13px;
	padding-block: 2px;
	min-height: 30px;
}
/* SidebarGenericItem's inner row carries pb=8 — tighten for density. */
.mc-boards-nav .rcx-sidebar-item > div {
	padding-block: 3px;
}
.mc-boards-nav-label {
	margin: 14px 16px 4px;
	font-family: ${LABEL_MONO};
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--rcx-color-font-annotation);
}
.mc-boards-nav-label:first-child {
	margin-top: 4px;
}
.mc-boards-nav .rcx-sidebar-item--selected,
.mc-boards-nav .rcx-sidebar-item[aria-current='page'] {
	background-color: ${t.activeBg};
	box-shadow: inset 2px 0 0 0 ${t.activeRail};
	color: ${t.activeText};
}
`;

/**
 * Injects the theme-matched boards-chrome CSS. Static, theme-derived constant
 * string (no user input) — same dangerouslySetInnerHTML precedent as
 * MainLayoutStyleTags' frame/ledger tags.
 */
const BoardsChromeStyleTags = () => {
	const [, , theme] = useThemeMode();

	// Brand light + dark; leave high-contrast (a11y) entirely stock.
	if (theme !== 'light' && theme !== 'dark') {
		return null;
	}

	const tokens = theme === 'dark' ? DARK : LIGHT;

	return <style dangerouslySetInnerHTML={{ __html: buildBoardsChromeCss(tokens) }} />;
};

export default BoardsChromeStyleTags;
