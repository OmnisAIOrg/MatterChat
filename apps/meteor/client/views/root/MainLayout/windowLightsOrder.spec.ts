import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * WINDOW LIGHTS MUST RENDER AFTER THE NAVBAR.
 *
 * Electron computes the window's draggable region by walking the tree IN ORDER, adding
 * `app-region: drag` rects and subtracting `no-drag` ones. NavBar is the drag surface. When
 * WindowLights rendered FIRST, its no-drag rect was subtracted before the NavBar's drag rect was
 * added — so the drag region was laid straight back over the three buttons, and macOS turned every
 * click on them into a window drag.
 *
 * The lights painted perfectly and did nothing, on a frameless window with no other way to close
 * (founder, 2026-08-06). The shell had to be reverted to native chrome to unstrand him.
 *
 * This is pure source ORDER, so it is invisible in review and a "tidy the JSX" pass would silently
 * reintroduce it. Hence a test on the source text.
 */
describe('LayoutWithSidebar — window lights ordering', () => {
	const source = readFileSync(join(__dirname, 'LayoutWithSidebar.tsx'), 'utf8');

	it('renders WindowLights AFTER NavBar so its no-drag subtraction lands last', () => {
		const navBar = source.indexOf('<NavBar />');
		const lights = source.indexOf('<WindowLights />');

		expect(navBar).toBeGreaterThan(-1);
		expect(lights).toBeGreaterThan(-1);
		expect(lights).toBeGreaterThan(navBar);
	});
});
