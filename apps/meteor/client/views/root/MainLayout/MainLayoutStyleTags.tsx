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

export const MainLayoutStyleTags = () => {
	const [, , theme] = useThemeMode();

	return (
		<>
			<PaletteStyleTag theme={theme} selector='.rcx-content--main, .rcx-tile' tagId={`main-palette-${theme}`} />
			<PaletteStyleTag theme='dark' selector='.rcx-sidebar--main, .rcx-sidepanel, .rcx-navbar' tagId='sidebar-palette' />
			{theme === 'dark' && <PaletteStyleTag selector='.rcx-content--main' palette={codeBlock} tagId='codeBlock-palette' />}
			{/* Static, no user input — the drag-region rule is a constant string (mirrors RawText's pattern). */}
			<style dangerouslySetInnerHTML={{ __html: NAVBAR_DRAG_REGION_CSS }} />
		</>
	);
};
