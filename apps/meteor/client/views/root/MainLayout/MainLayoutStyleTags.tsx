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

export const MainLayoutStyleTags = () => {
	const [, , theme] = useThemeMode();

	return (
		<>
			<PaletteStyleTag theme={theme} selector='.rcx-content--main, .rcx-tile' tagId={`main-palette-${theme}`} />
			<PaletteStyleTag theme='dark' selector='.rcx-sidebar--main, .rcx-sidepanel, .rcx-navbar' tagId='sidebar-palette' />
			{theme === 'dark' && <PaletteStyleTag selector='.rcx-content--main' palette={codeBlock} tagId='codeBlock-palette' />}
			{/* Static, no user input — the drag-region rule is a constant string (mirrors RawText's pattern). */}
			<style dangerouslySetInnerHTML={{ __html: NAVBAR_DRAG_REGION_CSS }} />
			{/* Static, no user input — the frame rule is a constant string. */}
			<style dangerouslySetInnerHTML={{ __html: MATTERCHAT_FRAME_CSS }} />
		</>
	);
};
