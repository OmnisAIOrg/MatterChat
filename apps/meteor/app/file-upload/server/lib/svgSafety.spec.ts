import type http from 'node:http';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { applyActiveContentSafety, isActiveImageType } from './svgSafety';

/**
 * These are the guard on ALLOWING SVG uploads at all.
 *
 * Rocket.Chat blocks image/svg+xml by default because an SVG is a document that can carry <script>;
 * served inline from our own origin it is stored XSS. MatterChat un-blocks the type and neutralises
 * the file instead, so if these assertions ever stop holding, the block has to come back.
 */

const fakeRes = () => {
	const headers: Record<string, string> = {};
	return {
		headers,
		res: {
			setHeader: (name: string, value: string) => {
				headers[name] = value;
			},
		} as unknown as http.ServerResponse,
	};
};

describe('isActiveImageType', () => {
	it('flags SVG, including with charset parameters and odd casing', () => {
		expect(isActiveImageType('image/svg+xml')).to.equal(true);
		expect(isActiveImageType('image/svg+xml; charset=utf-8')).to.equal(true);
		expect(isActiveImageType('IMAGE/SVG+XML')).to.equal(true);
		expect(isActiveImageType(' image/svg+xml ')).to.equal(true);
	});

	it('leaves inert raster types alone', () => {
		['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'].forEach((type) => {
			expect(isActiveImageType(type), type).to.equal(false);
		});
	});

	it('treats a missing type as inert rather than throwing', () => {
		expect(isActiveImageType(undefined)).to.equal(false);
		expect(isActiveImageType('')).to.equal(false);
	});
});

describe('applyActiveContentSafety', () => {
	it('forces an SVG to download instead of rendering on our origin', () => {
		const { headers, res } = fakeRes();
		// The store has already set the permissive value this must override.
		res.setHeader('Content-Disposition', 'inline; filename="logo.svg"');

		applyActiveContentSafety({ type: 'image/svg+xml', name: 'logo.svg' }, res);

		expect(headers['Content-Disposition']).to.match(/^attachment;/);
		expect(headers['X-Content-Type-Options']).to.equal('nosniff');
		expect(headers['Content-Security-Policy']).to.contain('sandbox');
	});

	it('sandboxes with no allow-scripts token — a sandbox that permits scripts is not a sandbox', () => {
		const { headers, res } = fakeRes();
		applyActiveContentSafety({ type: 'image/svg+xml', name: 'x.svg' }, res);
		expect(headers['Content-Security-Policy']).to.not.contain('allow-scripts');
		expect(headers['Content-Security-Policy']).to.not.contain('allow-same-origin');
	});

	it('percent-encodes the filename so it cannot break out of the header', () => {
		const { headers, res } = fakeRes();
		applyActiveContentSafety({ type: 'image/svg+xml', name: 'a"; drop\r\nX-Evil: 1' }, res);
		expect(headers['Content-Disposition']).to.not.contain('\r');
		expect(headers['Content-Disposition']).to.not.contain('\n');
		expect(headers['Content-Disposition']).to.not.contain('"');
	});

	it('does not touch a normal image response', () => {
		const { headers, res } = fakeRes();
		res.setHeader('Content-Disposition', 'inline; filename="photo.png"');

		applyActiveContentSafety({ type: 'image/png', name: 'photo.png' }, res);

		expect(headers['Content-Disposition']).to.equal('inline; filename="photo.png"');
		expect(headers['X-Content-Type-Options']).to.equal(undefined);
		expect(headers['Content-Security-Policy']).to.equal(undefined);
	});
});
