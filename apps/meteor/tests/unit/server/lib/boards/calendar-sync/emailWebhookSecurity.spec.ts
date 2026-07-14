import crypto from 'crypto';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	extractIntakeToken,
	parseInboundEmailBody,
	verifyEmailSignature,
} from '../../../../../../server/lib/boards/calendar-sync/emailWebhookSecurity';

const SECRET = 'test-email-webhook-secret';
const sign = (body: Buffer | string): string =>
	`sha256=${crypto
		.createHmac('sha256', SECRET)
		.update(typeof body === 'string' ? Buffer.from(body) : body)
		.digest('hex')}`;

describe('email webhook security', () => {
	describe('verifyEmailSignature (fail-closed HMAC)', () => {
		const body = Buffer.from(JSON.stringify({ subject: 'Hi', to: 'boards+abc@x.io' }));

		it('accepts a correctly-signed body', () => {
			expect(verifyEmailSignature(SECRET, sign(body), body)).to.be.true;
		});
		it('rejects when the secret is empty (fail-closed)', () => {
			expect(verifyEmailSignature('', sign(body), body)).to.be.false;
		});
		it('rejects a missing/non-string header', () => {
			expect(verifyEmailSignature(SECRET, undefined, body)).to.be.false;
			expect(verifyEmailSignature(SECRET, 42 as unknown, body)).to.be.false;
		});
		it('rejects a malformed header', () => {
			expect(verifyEmailSignature(SECRET, 'sha256=nothex', body)).to.be.false;
			expect(verifyEmailSignature(SECRET, 'md5=deadbeef', body)).to.be.false;
		});
		it('rejects a tampered body', () => {
			const good = sign(body);
			const tampered = Buffer.from(JSON.stringify({ subject: 'Evil', to: 'boards+abc@x.io' }));
			expect(verifyEmailSignature(SECRET, good, tampered)).to.be.false;
		});
		it('rejects the wrong secret', () => {
			const otherSig = `sha256=${crypto.createHmac('sha256', 'other').update(body).digest('hex')}`;
			expect(verifyEmailSignature(SECRET, otherSig, body)).to.be.false;
		});
	});

	describe('parseInboundEmailBody', () => {
		it('parses a flat provider shape', () => {
			const parsed = parseInboundEmailBody(JSON.stringify({ subject: 'S', text: 'B', from: 'a@x.io', to: 'boards+t@x.io' }));
			expect(parsed).to.deep.equal({ subject: 'S', text: 'B', from: 'a@x.io', to: 'boards+t@x.io' });
		});
		it('parses a nested { mail } shape and body-plain', () => {
			const parsed = parseInboundEmailBody(
				JSON.stringify({ mail: { 'subject': 'S', 'body-plain': 'B', 'from': 'a@x.io', 'to': 'boards+t@x.io' } }),
			);
			expect(parsed?.text).to.equal('B');
			expect(parsed?.to).to.equal('boards+t@x.io');
		});
		it('returns null on malformed JSON', () => {
			expect(parseInboundEmailBody('{not json')).to.equal(null);
		});
		it('returns null when there is no recipient to route on', () => {
			expect(parseInboundEmailBody(JSON.stringify({ subject: 'S' }))).to.equal(null);
		});
	});

	describe('extractIntakeToken', () => {
		it('extracts the token from a plus-addressed recipient', () => {
			expect(extractIntakeToken('boards+aBcD1234efGh5678@intake.example.com')).to.equal('aBcD1234efGh5678'.toLowerCase());
		});
		it('handles a "Name" <addr> form', () => {
			expect(extractIntakeToken('"Intake" <boards+tok1234567890abcd@x.io>')).to.equal('tok1234567890abcd');
		});
		it('returns null for an address with no token', () => {
			expect(extractIntakeToken('boards@x.io')).to.equal(null);
			expect(extractIntakeToken(undefined)).to.equal(null);
		});
		it('rejects a too-short token', () => {
			expect(extractIntakeToken('boards+short@x.io')).to.equal(null);
		});
	});
});
