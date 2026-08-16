import { expect } from 'chai';
import { describe, it } from 'mocha';

import { textResponse } from '../../../../../server/lib/ui-master/textResponse';

/**
 * MATTERCHAT: guards the production incident described in textResponse.ts.
 *
 * The bug shipped because `content.length` looks right, is right for ASCII, and only fails
 * over HTTP/2 — so it survived local development, `curl`, and code review. These cases pin the
 * one property that matters: the declared length is the BYTE length, and it is right precisely
 * when the string is not pure ASCII.
 */
describe('textResponse', () => {
	it('declares the byte length, not the string length', () => {
		// The exact production payload shape: ASCII CSS with one em dash in a comment.
		const css = '/* MatterChat — OmnisAI house brand (GREEN) */\n:root { --x: #1B7A2E; }\n';
		const { body, contentLength } = textResponse(css);

		expect(contentLength).to.equal(Buffer.byteLength(css, 'utf-8'));
		expect(contentLength).to.equal(body.byteLength);
		// The whole incident in one assertion: these two numbers are NOT the same.
		expect(contentLength).to.not.equal(css.length);
		expect(contentLength).to.equal(css.length + 2); // em dash: 1 char, 3 bytes
	});

	it('agrees with the string length for pure ASCII, which is why this hid for so long', () => {
		const css = ':root { --rcx-color-button-primary-background: #1B7A2E; }';
		const { contentLength } = textResponse(css);
		expect(contentLength).to.equal(css.length);
	});

	it('counts multi-byte characters correctly across the ranges CSS actually contains', () => {
		for (const [text, extraBytes] of [
			['é', 1], // 2-byte
			['—', 2], // 3-byte (the production culprit)
			['→', 2],
			['”', 2],
			[' ', 1], // a non-breaking space pasted from a doc — invisible in review
		] as [string, number][]) {
			const { contentLength } = textResponse(text);
			expect(contentLength, `for ${JSON.stringify(text)}`).to.equal(text.length + extraBytes);
		}
	});

	it('handles astral characters, where the string length is already 2', () => {
		const emoji = '🎉';
		expect(emoji.length).to.equal(2); // surrogate pair
		expect(textResponse(emoji).contentLength).to.equal(4);
	});

	it('round-trips: the bytes decode back to exactly what was passed in', () => {
		const css = '/* — “quoted” → 🎉 */\n.a { content: " "; }';
		const { body, contentLength } = textResponse(css);
		expect(body.toString('utf-8')).to.equal(css);
		expect(body.byteLength).to.equal(contentLength);
	});

	it('is correct for the empty body', () => {
		const { body, contentLength } = textResponse('');
		expect(contentLength).to.equal(0);
		expect(body.byteLength).to.equal(0);
	});
});
