import { createHmac } from 'crypto';

import { verifyWebhookSignature } from './transport';

jest.mock('@rocket.chat/server-fetch', () => ({ serverFetch: jest.fn() }));

const SECRET = 'whsec_test';
const BODY = JSON.stringify({ envelopeId: 'env-1', event: 'signed' });

const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('verifyWebhookSignature', () => {
	it('accepts a valid bare hex digest', () => {
		expect(verifyWebhookSignature(SECRET, BODY, sign(BODY))).toBe(true);
	});

	it('accepts the sha256= prefixed form', () => {
		expect(verifyWebhookSignature(SECRET, BODY, `sha256=${sign(BODY)}`)).toBe(true);
	});

	it('rejects a signature computed over a DIFFERENT body', () => {
		// The whole point: a replayed signature must not authorise new content.
		expect(verifyWebhookSignature(SECRET, BODY, sign(JSON.stringify({ envelopeId: 'env-2', event: 'signed' })))).toBe(false);
	});

	it('rejects a signature computed with a different secret', () => {
		expect(verifyWebhookSignature(SECRET, BODY, sign(BODY, 'wrong-secret'))).toBe(false);
	});

	it('rejects a MISSING signature header', () => {
		expect(verifyWebhookSignature(SECRET, BODY, undefined)).toBe(false);
	});

	it('FAILS CLOSED when no secret is configured', () => {
		// This endpoint can move a matter's status, set its fee percentage and
		// start its limitations clock. An unconfigured secret must reject
		// everything, never accept everything.
		expect(verifyWebhookSignature('', BODY, sign(BODY))).toBe(false);
		expect(verifyWebhookSignature('', BODY, '')).toBe(false);
	});

	it('rejects a malformed (non-hex, wrong-length) signature without throwing', () => {
		expect(verifyWebhookSignature(SECRET, BODY, 'not-hex')).toBe(false);
		expect(verifyWebhookSignature(SECRET, BODY, 'zz'.repeat(32))).toBe(false);
	});
});
