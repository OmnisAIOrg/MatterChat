import { textResponse } from './textResponse';

/**
 * MATTERCHAT: guards the production incident described in textResponse.ts.
 *
 * The bug shipped because `content.length` looks right, IS right for ASCII, and only fails over
 * HTTP/2 — so it survived local development, curl, and code review. These cases pin the one
 * property that matters: the declared length is the BYTE length, and it diverges from the
 * string length precisely when the content is not pure ASCII.
 */
describe('textResponse', () => {
	it('declares the byte length, not the string length', () => {
		// The exact production payload shape: ASCII CSS with one em dash in a comment.
		const css = '/* MatterChat — OmnisAI house brand (GREEN) */\n:root { --x: #1B7A2E; }\n';
		const { body, contentLength } = textResponse(css);

		expect(contentLength).toBe(Buffer.byteLength(css, 'utf-8'));
		expect(contentLength).toBe(body.byteLength);
		// The whole incident in one assertion: these two numbers are NOT the same.
		expect(contentLength).not.toBe(css.length);
		expect(contentLength).toBe(css.length + 2); // em dash: 1 char, 3 bytes
	});

	it('agrees with the string length for pure ASCII, which is why this hid for so long', () => {
		const css = ':root { --rcx-color-button-primary-background: #1B7A2E; }';
		expect(textResponse(css).contentLength).toBe(css.length);
	});

	it.each([
		['é', 1],
		['—', 2], // the production culprit
		['→', 2],
		['”', 2],
		[' ', 1], // a non-breaking space pasted from a doc — invisible in review
	])('counts %j correctly', (text, extraBytes) => {
		expect(textResponse(text).contentLength).toBe(text.length + extraBytes);
	});

	it('handles astral characters, where the string length is already 2', () => {
		const emoji = '🎉';
		expect(emoji.length).toBe(2); // surrogate pair
		expect(textResponse(emoji).contentLength).toBe(4);
	});

	it('round-trips: the bytes decode back to exactly what was passed in', () => {
		const css = '/* — “quoted” → 🎉 */\n.a { content: " "; }';
		const { body, contentLength } = textResponse(css);
		expect(body.toString('utf-8')).toBe(css);
		expect(body.byteLength).toBe(contentLength);
	});

	it('is correct for the empty body', () => {
		const { body, contentLength } = textResponse('');
		expect(contentLength).toBe(0);
		expect(body.byteLength).toBe(0);
	});
});
