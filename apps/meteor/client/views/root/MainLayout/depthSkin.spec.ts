import { readFileSync } from 'fs';
import { join } from 'path';

import { buildDepthCss, DEPTH_FLAG_CLASS, FRAMELESS_LIGHTS_POSITION } from './depthSkin';

/**
 * These guard a failure mode that a green build does NOT catch.
 *
 * `buildDepthCss` returns CSS assembled in a template literal. A stray backtick anywhere in that
 * string — easiest to introduce inside a CSS comment, e.g. writing `padding: 22` with code quotes —
 * silently TERMINATES the literal. Babel then emits a syntactically valid module whose CSS is
 * truncated at that point, the build passes, and every rule after the backtick is missing at
 * runtime. That exact bug shipped a half-applied skin during this pass (the content well, cards and
 * overlay rules all vanished) and was invisible until the built chunk was inspected by hand.
 *
 * The brace-balance and tail assertions below fail loudly on truncation.
 */
/**
 * Structural assertions must run on comment-free CSS: the comments legitimately quote upstream
 * selectors and rule bodies, so their braces would otherwise be counted as real blocks and their
 * text parsed as selectors.
 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * SOURCE-TEXT GUARD — reads the file as text rather than importing it.
 *
 * The CSS is assembled in one big template literal, so a backtick anywhere inside it terminates the
 * string. This has bitten three separate times while building this pass, because the natural way to
 * quote a CSS property or a class name in a comment is with code backticks. It fails one of two
 * ways, and BOTH are expensive:
 *   - a single stray backtick pair still parses, and Babel silently truncates the CSS at that point
 *     (green build, half the skin missing at runtime);
 *   - an odd number is a hard parse error that takes the whole module — and every test that imports
 *     it — down with it.
 *
 * The assertions below can't rely on importing the module, since a parse error would break the
 * import too. Reading the raw text works either way.
 */
describe('depthSkin source', () => {
	const source = readFileSync(join(__dirname, 'depthSkin.ts'), 'utf8');

	it('has no backticks inside the CSS template literal', () => {
		const open = source.indexOf('return `') + 'return `'.length;
		const close = source.lastIndexOf('`;');
		const cssBody = source.slice(open, close);

		// Use plain quotes or no quotes when naming CSS in these comments — never code backticks.
		expect(cssBody).not.toContain('`');
	});
});

describe('depthSkin', () => {
	const themes = ['light', 'dark'] as const;

	themes.forEach((theme) => {
		describe(`${theme} theme`, () => {
			const css = buildDepthCss(theme);
			const bare = stripComments(css);

			it('is not truncated — braces balance', () => {
				const open = (bare.match(/\{/g) ?? []).length;
				const close = (bare.match(/\}/g) ?? []).length;
				expect(open).toBe(close);
			});

			it('emits every plane, including the ones after the midpoint', () => {
				// Ordered outermost → innermost. A truncation shows up as the tail entries missing.
				expect(css).toContain('#react-root'); // plane 2, chrome frame
				expect(css).toContain('.mc-groove'); // the repeating recess
				expect(css).toContain('#main-content'); // plane 3, the content well
				expect(css).toContain('.mc-card'); // plane 4, cards
				expect(css).toContain('.mc-scroll-shade'); // §4.3
				expect(css).toContain('@media print'); // the very last block
			});

			it('scopes every rule under the feature-flag class so the pass is revertible', () => {
				// Spec §8: dropping `body.mc-depth` must revert the whole reskin. Any selector that
				// escapes the flag would leak the reskin into the un-flagged state.
				const selectors = bare
					.split('}')
					.map((block) => block.split('{')[0].trim())
					.filter((sel) => sel && !sel.startsWith('@') && !sel.startsWith('--'));

				const unscoped = selectors.filter((sel) => !sel.includes(`body.${DEPTH_FLAG_CLASS}`));
				expect(unscoped).toStrictEqual([]);
			});

			it('resolves every interpolation', () => {
				expect(css).not.toMatch(/undefined|NaN|\[object Object\]/);
			});

			it('never blanket-targets .rcx-sidebar — only the wrapper that holds the room list', () => {
				// REGRESSION GUARD. '.rcx-sidebar' is worn by both the chat room-list wrapper (content is
				// light-on-dark, safe to make transparent) AND fork-owned light panels — .mc-boards-sidebar,
				// .flex-nav, Activity/Admin — whose content is dark-text-on-light. A blanket
				// '.rcx-sidebar { background: transparent }' deletes those panels' backgrounds and leaves
				// dark text on the dark chrome, i.e. invisible nav on every non-chat route. Chat is the one
				// place it looks fine, which is exactly why this slips through a spot check.
				const selectors = bare
					.split('}')
					.flatMap((block) => block.split('{')[0].split(','))
					.map((sel) => sel.trim())
					.filter(Boolean);

				const bare_rcx_sidebar = selectors.filter((sel) => /\.rcx-sidebar$/.test(sel) || /\.rcx-sidebar[^-:\w]/.test(sel));
				expect(bare_rcx_sidebar).toStrictEqual([]);
			});
		});
	});

	describe('frameless desktop geometry', () => {
		// The protruding tab and the client-drawn window lights are positioned from the SAME numbers.
		// When the tab was narrowed from 78 to 64, hardcoded light coordinates left them sitting on
		// the tab instead of the title bar — outside the green frame. These invariants make the two
		// impossible to desync, whatever the tab width becomes next.
		const css = buildDepthCss('dark');
		const num = (re: RegExp): number => Number((css.match(re) ?? [])[1]);

		const tabWidth = num(/\.mc-rail-workspace \{[\s\S]*?width: (\d+)px/);
		const gutter = num(/margin-inline-start: (\d+)px !important/);
		const bezel = num(/#react-root \{[\s\S]*?inset: (\d+)px/);
		const frameLeftEdge = gutter + bezel;

		it('leaves room for the tab inside the transparent gutter', () => {
			expect(tabWidth).toBeLessThanOrEqual(gutter);
		});

		it('puts the window lights inside the frame, never on the tab', () => {
			expect(FRAMELESS_LIGHTS_POSITION.left).toBeGreaterThan(gutter);
			expect(FRAMELESS_LIGHTS_POSITION.left).toBeGreaterThan(frameLeftEdge);
		});

		it('puts the window lights vertically within the title bar', () => {
			expect(FRAMELESS_LIGHTS_POSITION.top).toBeGreaterThan(bezel);
			expect(FRAMELESS_LIGHTS_POSITION.top).toBeLessThan(bezel + 48);
		});

		it('leaves body with no background to propagate to the canvas', () => {
			// CSS backgrounds §2.11.2: when the ROOT element's background is transparent, the BODY's
			// background is propagated to the canvas and painted across the WHOLE viewport, ignoring
			// body's margins and radius. Since <body> is the bezel, clearing <html> alone flooded the
			// entire window green — worse than before. body must carry no background on the frameless
			// shell, with the bezel drawn by a pseudo-element confined to body's box.
			const framelessBody = /body\.mc-depth\.mc-desktop-frameless \{([^}]*)\}/.exec(css)?.[1] ?? '';
			expect(framelessBody).toMatch(/background:\s*none/);
			expect(css).toMatch(/body\.mc-depth\.mc-desktop-frameless::before[\s\S]*?linear-gradient/);
		});

		it('makes the window itself transparent, or none of the above is visible', () => {
			// MATTERCHAT_FRAME_CSS paints <html> opaque for the browser. Left in place on a frameless
			// Electron window it fills the whole window rect and cancels `transparent: true`, so the
			// tab reads as welded to a black slab instead of floating beside the app.
			expect(css).toMatch(/html:has\(body\.mc-depth\.mc-desktop-frameless\)[\s\S]*?background: transparent/);
		});
	});

	it('re-themes the well and cards but keeps the chrome identical across themes', () => {
		// The rails and title bar are always dark by design, so bezel/chrome/groove tokens must not
		// vary by theme — only the well and card surfaces do.
		const light = buildDepthCss('light');
		const dark = buildDepthCss('dark');

		const bezelOf = (css: string) => /--mc-bezel-top:\s*([^;]+);/.exec(css)?.[1];
		const wellOf = (css: string) => /--mc-well-fill:\s*([^;]+);/.exec(css)?.[1];

		expect(bezelOf(light)).toBe(bezelOf(dark));
		expect(wellOf(light)).not.toBe(wellOf(dark));
	});
});
