import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THIS FILE DELIBERATELY DOES NOT IMPORT depthSkin — that is the entire point.
 *
 * depthSkin.ts builds its CSS inside one large template literal, so a backtick anywhere in that
 * string terminates it. The natural way to quote a CSS property or class name in a comment is with
 * code backticks, which is why this has now broken the file FOUR times during this pass. It fails
 * two ways:
 *
 *   - an EVEN number of stray backticks still parses, and Babel silently truncates the CSS at that
 *     point — a green build that is missing half the skin at runtime;
 *   - an ODD number is a hard parse error that takes the module down.
 *
 * The guard originally lived in depthSkin.spec.ts, which imports depthSkin — so in the odd-number
 * case the guard itself could not run, and reported "0 tests" instead of the real cause. A check
 * that only works when the thing it checks is already healthy is not a guard. Reading the file as
 * raw text keeps it working in both cases.
 *
 * If this fails: use plain quotes or no quotes when naming CSS in those comments. Never backticks.
 */
describe('depthSkin.ts source integrity', () => {
	const source = readFileSync(join(__dirname, 'depthSkin.ts'), 'utf8');
	const OPEN = 'return `';

	it('builds its CSS from exactly one template literal', () => {
		expect(source.split(OPEN)).toHaveLength(2);
	});

	it('has no backticks inside that template literal', () => {
		const start = source.indexOf(OPEN) + OPEN.length;
		const end = source.lastIndexOf('`;');
		const cssBody = source.slice(start, end);

		const strays = (cssBody.match(/`/g) ?? []).length;
		expect({ strayBackticks: strays }).toStrictEqual({ strayBackticks: 0 });
	});

	it('closes the template literal at the end of the builder', () => {
		// A missing terminator is the other way this file has broken; catching it here gives a clear
		// message instead of a parse error pointing at an unrelated line.
		expect(source.trimEnd().endsWith('};')).toBe(true);
	});
});
