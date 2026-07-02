import crypto from 'crypto';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { isTimestampFresh, parseCaseProEvent, verifySignature, MAX_TIMESTAMP_SKEW_MS } from '../../../../app/casepro-events/server/security';

const SECRET = 'test-casepro-secret';

const sign = (secret: string, raw: Buffer | string): string =>
	`sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

const validPayload = () => ({
	event_id: '5b3f0d0a-1111-2222-3333-444455556666',
	entity_type: 'insurances',
	entity_id: 'ins-1',
	matter_id: 'matter-42',
	change_type: 'updated',
	changed_fields: ['status', 'phase'],
	organization_id: 'org-1',
	timestamp: '2026-07-01T12:00:00.000Z',
});

describe('CasePro webhook security', () => {
	describe('verifySignature', () => {
		const raw = Buffer.from(JSON.stringify(validPayload()), 'utf8');

		it('accepts a valid HMAC-SHA256 hex signature of the raw body', () => {
			expect(verifySignature(SECRET, sign(SECRET, raw), raw)).to.equal(true);
		});

		it('accepts uppercase hex', () => {
			const header = `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex').toUpperCase()}`;
			expect(verifySignature(SECRET, header, raw)).to.equal(true);
		});

		it('FAILS CLOSED with no secret configured', () => {
			expect(verifySignature('', sign(SECRET, raw), raw)).to.equal(false);
		});

		it('rejects a missing or non-string header', () => {
			expect(verifySignature(SECRET, undefined, raw)).to.equal(false);
			expect(verifySignature(SECRET, null, raw)).to.equal(false);
			expect(verifySignature(SECRET, 42 as unknown as string, raw)).to.equal(false);
			expect(verifySignature(SECRET, '', raw)).to.equal(false);
		});

		it('rejects a wrong signature (wrong secret or tampered body)', () => {
			expect(verifySignature(SECRET, sign('other-secret', raw), raw)).to.equal(false);
			const tampered = Buffer.from(raw.toString('utf8').replace('matter-42', 'matter-43'), 'utf8');
			expect(verifySignature(SECRET, sign(SECRET, raw), tampered)).to.equal(false);
		});

		it('rejects malformed / length-mismatched headers before any comparison', () => {
			const hex = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
			expect(verifySignature(SECRET, hex, raw)).to.equal(false); // missing sha256= prefix
			expect(verifySignature(SECRET, `sha1=${hex}`, raw)).to.equal(false);
			expect(verifySignature(SECRET, `sha256=${hex.slice(0, 32)}`, raw)).to.equal(false); // too short
			expect(verifySignature(SECRET, `sha256=${hex}${hex}`, raw)).to.equal(false); // too long
			expect(verifySignature(SECRET, `sha256=${'z'.repeat(64)}`, raw)).to.equal(false); // not hex
			expect(verifySignature(SECRET, `sha256=${'a'.repeat(600)}`, raw)).to.equal(false); // oversized
		});
	});

	describe('isTimestampFresh', () => {
		const now = Date.parse('2026-07-01T12:00:00.000Z');

		it('accepts timestamps within ±5 minutes', () => {
			expect(isTimestampFresh('2026-07-01T12:00:00.000Z', now)).to.equal(true);
			expect(isTimestampFresh('2026-07-01T11:55:30.000Z', now)).to.equal(true);
			expect(isTimestampFresh('2026-07-01T12:04:59.000Z', now)).to.equal(true);
		});

		it('rejects timestamps beyond the skew window (past and future)', () => {
			expect(isTimestampFresh('2026-07-01T11:54:59.000Z', now)).to.equal(false);
			expect(isTimestampFresh('2026-07-01T12:05:01.000Z', now)).to.equal(false);
			expect(isTimestampFresh('2026-07-01T12:00:00.000Z', now + MAX_TIMESTAMP_SKEW_MS + 1)).to.equal(false);
		});

		it('rejects unparseable timestamps', () => {
			expect(isTimestampFresh('not-a-date', now)).to.equal(false);
			expect(isTimestampFresh('', now)).to.equal(false);
		});
	});

	describe('parseCaseProEvent', () => {
		it('parses and maps a valid payload (snake_case → camelCase)', () => {
			const event = parseCaseProEvent(JSON.stringify(validPayload()));
			expect(event).to.deep.equal({
				eventId: '5b3f0d0a-1111-2222-3333-444455556666',
				entityType: 'insurances',
				entityId: 'ins-1',
				matterId: 'matter-42',
				changeType: 'updated',
				changedFields: ['status', 'phase'],
				organizationId: 'org-1',
				timestamp: '2026-07-01T12:00:00.000Z',
			});
		});

		it('accepts a Buffer body', () => {
			const event = parseCaseProEvent(Buffer.from(JSON.stringify(validPayload()), 'utf8'));
			expect(event?.matterId).to.equal('matter-42');
		});

		it('returns null for malformed JSON and non-object bodies', () => {
			expect(parseCaseProEvent('{not json')).to.equal(null);
			expect(parseCaseProEvent('"a string"')).to.equal(null);
			expect(parseCaseProEvent('[1,2,3]')).to.equal(null);
			expect(parseCaseProEvent('null')).to.equal(null);
		});

		it('returns null when required fields are missing or invalid', () => {
			const without = (key: string) => {
				const p: Record<string, unknown> = { ...validPayload() };
				delete p[key];
				return JSON.stringify(p);
			};
			expect(parseCaseProEvent(without('entity_type'))).to.equal(null);
			expect(parseCaseProEvent(without('change_type'))).to.equal(null);
			expect(parseCaseProEvent(without('timestamp'))).to.equal(null);
			expect(parseCaseProEvent(JSON.stringify({ ...validPayload(), change_type: 'exploded' }))).to.equal(null);
		});

		it('preserves a null matter_id and rejects a non-string one', () => {
			expect(parseCaseProEvent(JSON.stringify({ ...validPayload(), matter_id: null }))?.matterId).to.equal(null);
			const withoutMatter: Record<string, unknown> = { ...validPayload() };
			delete withoutMatter.matter_id;
			expect(parseCaseProEvent(JSON.stringify(withoutMatter))?.matterId).to.equal(null);
			expect(parseCaseProEvent(JSON.stringify({ ...validPayload(), matter_id: 42 }))).to.equal(null);
		});

		it('filters non-string changed_fields entries and tolerates a missing array', () => {
			expect(parseCaseProEvent(JSON.stringify({ ...validPayload(), changed_fields: ['a', 1, null, 'b'] }))?.changedFields).to.deep.equal([
				'a',
				'b',
			]);
			expect(parseCaseProEvent(JSON.stringify({ ...validPayload(), changed_fields: 'nope' }))?.changedFields).to.deep.equal([]);
		});

		it('degrades a missing event_id to an empty string (caller falls back to a body hash)', () => {
			const p: Record<string, unknown> = { ...validPayload() };
			delete p.event_id;
			expect(parseCaseProEvent(JSON.stringify(p))?.eventId).to.equal('');
		});
	});
});
