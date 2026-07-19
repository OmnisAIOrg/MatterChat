import { useThemeMode } from '@rocket.chat/ui-client';
import type { ReactElement } from 'react';
import React from 'react';

/**
 * PremiumThemeStyleTags — Wave 3 premium skin foundation for MatterChat.
 *
 * The foundation layer every screen builds on: Geist typography, global CSS
 * custom properties (light + dark themes), the green gradient frame, dark rails,
 * and utility classes (mono-label, tabular-nums). Applied globally, no editing
 * of core RC/Fuselage — token override + CSS vars only.
 *
 * Token values derived from docs/design/premium-refresh/Design System.dc.html
 * (light/dark theme toggles via data-theme attribute on body).
 */

// ============================================================================
// FONTS — Geist + Geist Mono from Google Fonts, vendored as woff2.
// ============================================================================

const FONTS_CSS = `
@font-face {
	font-family: 'Geist';
	font-style: normal;
	font-weight: 400;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/Geist-400.woff2') format('woff2');
}

@font-face {
	font-family: 'Geist';
	font-style: normal;
	font-weight: 500;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/Geist-500.woff2') format('woff2');
}

@font-face {
	font-family: 'Geist';
	font-style: normal;
	font-weight: 600;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/Geist-600.woff2') format('woff2');
}

@font-face {
	font-family: 'Geist';
	font-style: normal;
	font-weight: 700;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/Geist-700.woff2') format('woff2');
}

@font-face {
	font-family: 'Geist Mono';
	font-style: normal;
	font-weight: 400;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/GeistMono-400.woff2') format('woff2');
}

@font-face {
	font-family: 'Geist Mono';
	font-style: normal;
	font-weight: 500;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/GeistMono-500.woff2') format('woff2');
}

@font-face {
	font-family: 'Geist Mono';
	font-style: normal;
	font-weight: 600;
	font-stretch: 100%;
	font-display: swap;
	src: url('/fonts/GeistMono-600.woff2') format('woff2');
}
`;

// ============================================================================
// TOKENS — global CSS custom properties (light theme + dark theme on
// [data-theme="dark"]).
// ============================================================================

const buildTokensCss = (): string => `
:root {
	/* Light theme (default) */
	--premium-bg: #F6F6F3;
	--premium-surface: #FFFFFF;
	--premium-surface2: #FAFAF7;
	--premium-border: #E7E6E0;
	--premium-border2: #DBDAD3;
	--premium-ink: #171D19;
	--premium-ink2: #57615B;
	--premium-ink3: #8E968F;
	--premium-green: #17804D;
	--premium-green2: #0F6A3D;
	--premium-onGreen: #FFFFFF;
	--premium-greenSoft: #E8F3ED;
	--premium-greenLine: #CBE5D6;
	--premium-greenInk: #116240;
	--premium-red: #CF4438;
	--premium-redSoft: #FBECEA;
	--premium-redLine: #F2CFCB;
	--premium-amber: #A97A18;
	--premium-amberSoft: #F8F0DF;
	--premium-amberLine: #EBD9B4;
	--premium-blue: #3C6EB4;
	--premium-blueSoft: #EAF1F9;
	--premium-blueLine: #CDDDF0;
	--premium-railBg: #0D1310;
	--premium-railBg2: #111814;
	--premium-railInk: #AEB8B1;
	--premium-railInk2: #6E7A73;
	--premium-railLine: #1F2823;
	--premium-railHover: #1A231E;
	--premium-shadow1: 0 1px 2px rgba(23, 29, 25, 0.05), 0 1px 3px rgba(23, 29, 25, 0.04);
	--premium-shadow2: 0 1px 2px rgba(23, 29, 25, 0.05), 0 8px 24px -8px rgba(23, 29, 25, 0.14);
	--premium-shadow3: 0 2px 6px rgba(23, 29, 25, 0.06), 0 24px 60px -12px rgba(23, 29, 25, 0.25);
	--premium-focus: 0 0 0 3px rgba(23, 128, 77, 0.22);
}

[data-theme="dark"] {
	/* Dark theme */
	--premium-bg: #0F1512;
	--premium-surface: #151C17;
	--premium-surface2: #19211C;
	--premium-border: #242D27;
	--premium-border2: #2D372F;
	--premium-ink: #E9EDEA;
	--premium-ink2: #A2ACA5;
	--premium-ink3: #707B74;
	--premium-green: #3FBC7C;
	--premium-green2: #57CD90;
	--premium-onGreen: #08130D;
	--premium-greenSoft: #152A1E;
	--premium-greenLine: #265C3F;
	--premium-greenInk: #6FD6A3;
	--premium-red: #E0685D;
	--premium-redSoft: #32201D;
	--premium-redLine: #5C332D;
	--premium-amber: #D3A24A;
	--premium-amberSoft: #2E2717;
	--premium-amberLine: #5A4A24;
	--premium-blue: #7AA3D8;
	--premium-blueSoft: #1B2532;
	--premium-blueLine: #324B69;
	--premium-railBg: #0B100D;
	--premium-railBg2: #0F1511;
	--premium-railInk: #AEB8B1;
	--premium-railInk2: #69746D;
	--premium-railLine: #1D2620;
	--premium-railHover: #18201B;
	--premium-shadow1: 0 1px 2px rgba(0, 0, 0, 0.35);
	--premium-shadow2: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 28px -8px rgba(0, 0, 0, 0.5);
	--premium-shadow3: 0 2px 6px rgba(0, 0, 0, 0.4), 0 24px 60px -12px rgba(0, 0, 0, 0.6);
	--premium-focus: 0 0 0 3px rgba(63, 188, 124, 0.28);
}
`;

// ============================================================================
// UTILITIES — global utility classes for the premium skin.
// ============================================================================

const UTILITIES_CSS = `
/* Mono label utility — uppercase 10px, letter-spacing 0.12–0.18em */
.premium-mono-label {
	font-family: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

/* Tabular figures — numeric columns and metrics */
.premium-tabular-nums {
	font-variant-numeric: tabular-nums;
}
`;

// ============================================================================
// KEYFRAMES — animations used throughout the system.
// ============================================================================

const KEYFRAMES_CSS = `
@keyframes premiumShimmer {
	0% {
		background-position: 120% 0;
	}
	100% {
		background-position: -20% 0;
	}
}

@keyframes premiumSpin {
	to {
		transform: rotate(360deg);
	}
}

@keyframes premiumFadeUp {
	from {
		opacity: 0;
		transform: translateY(5px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@keyframes premiumPop {
	from {
		opacity: 0;
		transform: scale(0.98) translateY(-6px);
	}
	to {
		opacity: 1;
		transform: scale(1) translateY(0);
	}
}

@keyframes premiumSlide {
	from {
		transform: translateX(48px);
		opacity: 0;
	}
	to {
		transform: translateX(0);
		opacity: 1;
	}
}

@keyframes premiumPulse {
	0%, 100% {
		opacity: 1;
	}
	50% {
		opacity: 0.5;
	}
}
`;

// ============================================================================
// GREEN FRAME & RAILS — apply the app frame and dark rail styling.
// ============================================================================

const buildFrameCss = (): string => `
/* Dark rail surfaces (both light and dark themes) */
.rcx-sidebar--main,
.rcx-sidepanel {
	background: var(--premium-railBg) !important;
	color: var(--premium-railInk) !important;
}

.rcx-navbar {
	background: var(--premium-railBg) !important;
	color: var(--premium-railInk) !important;
}

/* Rail structural elements */
.rcx-sidebar--main .rcx-sidebar-header,
.rcx-sidepanel .rcx-sidepanel-header {
	background: var(--premium-railBg2) !important;
	border-color: var(--premium-railLine) !important;
}

/* Rail hover/interaction states */
.rcx-sidebar--main .rcx-box[role="button"]:hover,
.rcx-sidepanel .rcx-box[role="button"]:hover {
	background: var(--premium-railHover) !important;
}

/* Active nav states read from the pill indicator */
.rcx-sidebar--main .rcx-box.rcx-box--active,
.rcx-sidepanel .rcx-box.rcx-box--active {
	color: var(--premium-greenInk) !important;
}

/* Green gradient frame: 11px padding, 18px inner radius */
body {
	background: linear-gradient(155deg, #22A957 0%, #128044 100%) !important;
	padding: 11px !important;
	border-radius: 18px !important;
	box-sizing: border-box !important;
}

#rocket-chat {
	border-radius: 18px !important;
	overflow: hidden !important;
}
`;

/**
 * Combine all CSS blocks into one style tag.
 */
const buildPremiumThemeCss = (): string => [FONTS_CSS, buildTokensCss(), UTILITIES_CSS, KEYFRAMES_CSS, buildFrameCss()].join('\n');

/**
 * Apply data-theme attribute to body based on the current Rocket.Chat theme.
 */
const PremiumThemeDataAttribute = (): ReactElement => {
	const [, , theme] = useThemeMode();

	// Apply data-theme to body on mount and update
	React.useEffect(() => {
		const themeMode = theme === 'dark' ? 'dark' : 'light';
		document.body.setAttribute('data-theme', themeMode);

		return () => {
			// Cleanup: remove attribute on unmount
			document.body.removeAttribute('data-theme');
		};
	}, [theme]);

	return null;
};

/**
 * Main export: the complete premium theme foundation.
 */
export const PremiumThemeStyleTags = (): ReactElement => {
	const css = buildPremiumThemeCss();

	return (
		<>
			<style dangerouslySetInnerHTML={{ __html: css }} />
			<PremiumThemeDataAttribute />
		</>
	);
};

export default PremiumThemeStyleTags;
