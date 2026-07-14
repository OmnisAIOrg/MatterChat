import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	MAX_TIMESTAMP_SKEW_SECONDS,
	computeSlackSignature,
	parseEventEnvelope,
	verifySlackSignature,
} from '../../../../app/connectors/server/providers/slack/eventsSecurity';

const SECRET = 'test-signing-secret';
const NOW_MS = 1_700_000_000_000;
const FRESH_TS = String(Math.floor(NOW_MS / 1000));
const BODY = JSON.stringify({ type: 'event_callback', team_id: 'T123', event_id: 'Ev123', event: { type: 'message' } });

const signed = (body: string, ts: string = FRESH_TS, secret: string = SECRET): string => computeSlackSignature(secret, ts, body);

describe('Slack events security', () => {
	describe('computeSlackSignature', () => {
		it('produces the v0=<hex hmac> shape, deterministic and secret-dependent', () => {
			const a = computeSlackSignature(SECRET, FRESH_TS, BODY);
			const b = computeSlackSignature(SECRET, FRESH_TS, BODY);
			expect(a).to.equal(b);
			expect(a).to.match(/^v0=[a-f0-9]{64}$/);
			expect(computeSlackSignature('other-secret', FRESH_TS, BODY)).to.not.equal(a);
			expect(computeSlackSignature(SECRET, String(Number(FRESH_TS) - 1), BODY)).to.not.equal(a);
			expect(computeSlackSignature(SECRET, FRESH_TS, `${BODY} `)).to.not.equal(a);
		});

		it('throws rather than signs without a secret', () => {
			expect(() => computeSlackSignature('', FRESH_TS, BODY)).to.throw('slack_signing_secret_missing');
		});
	});

	describe('verifySlackSignature', () => {
		it('verifies a correctly signed request', () => {
			expect(verifySlackSignature(SECRET, FRESH_TS, signed(BODY), BODY, NOW_MS)).to.equal(true);
		});

		it('FAILS CLOSED with no secret configured', () => {
			expect(verifySlackSignature('', FRESH_TS, signed(BODY), BODY, NOW_MS)).to.equal(false);
		});

		it('rejects a signature minted with the wrong secret', () => {
			expect(verifySlackSignature(SECRET, FRESH_TS, signed(BODY, FRESH_TS, 'other-secret'), BODY, NOW_MS)).to.equal(false);
		});

		it('rejects a tampered body', () => {
			expect(verifySlackSignature(SECRET, FRESH_TS, signed(BODY), `${BODY} `, NOW_MS)).to.equal(false);
		});

		it('rejects a signature bound to a different timestamp', () => {
			const otherTs = String(Number(FRESH_TS) - 10);
			expect(verifySlackSignature(SECRET, FRESH_TS, signed(BODY, otherTs), BODY, NOW_MS)).to.equal(false);
		});

		it('rejects a STALE timestamp (replay guard, >5 min past)', () => {
			const staleTs = String(Math.floor(NOW_MS / 1000) - MAX_TIMESTAMP_SKEW_SECONDS - 1);
			// The signature itself is VALID for that timestamp — staleness alone must reject it.
			expect(verifySlackSignature(SECRET, staleTs, signed(BODY, staleTs), BODY, NOW_MS)).to.equal(false);
		});

		it('rejects a FUTURE timestamp beyond the skew window', () => {
			const futureTs = String(Math.floor(NOW_MS / 1000) + MAX_TIMESTAMP_SKEW_SECONDS + 1);
			expect(verifySlackSignature(SECRET, futureTs, signed(BODY, futureTs), BODY, NOW_MS)).to.equal(false);
		});

		it('accepts a timestamp just inside the skew window', () => {
			const edgeTs = String(Math.floor(NOW_MS / 1000) - MAX_TIMESTAMP_SKEW_SECONDS + 5);
			expect(verifySlackSignature(SECRET, edgeTs, signed(BODY, edgeTs), BODY, NOW_MS)).to.equal(true);
		});

		it('rejects missing, non-string, malformed, or oversized headers', () => {
			const sig = signed(BODY);
			expect(verifySlackSignature(SECRET, undefined, sig, BODY, NOW_MS)).to.equal(false);
			expect(verifySlackSignature(SECRET, FRESH_TS, undefined, BODY, NOW_MS)).to.equal(false);
			expect(verifySlackSignature(SECRET, 42 as unknown as string, sig, BODY, NOW_MS)).to.equal(false);
			expect(verifySlackSignature(SECRET, 'not-a-number', sig, BODY, NOW_MS)).to.equal(false);
			expect(verifySlackSignature(SECRET, FRESH_TS, 'v0=nope', BODY, NOW_MS)).to.equal(false);
			expect(verifySlackSignature(SECRET, FRESH_TS, 'x'.repeat(5000), BODY, NOW_MS)).to.equal(false);
			expect(verifySlackSignature(SECRET, 'x'.repeat(5000), sig, BODY, NOW_MS)).to.equal(false);
		});
	});

	describe('parseEventEnvelope', () => {
		it('parses the url_verification handshake', () => {
			expect(parseEventEnvelope({ type: 'url_verification', challenge: 'abc123' })).to.deep.equal({
				kind: 'url_verification',
				challenge: 'abc123',
			});
		});

		it('rejects url_verification without a usable challenge', () => {
			expect(parseEventEnvelope({ type: 'url_verification' })).to.equal(null);
			expect(parseEventEnvelope({ type: 'url_verification', challenge: '' })).to.equal(null);
			expect(parseEventEnvelope({ type: 'url_verification', challenge: 42 })).to.equal(null);
			expect(parseEventEnvelope({ type: 'url_verification', challenge: 'x'.repeat(5000) })).to.equal(null);
		});

		it('parses an event_callback envelope', () => {
			const event = { type: 'message', channel: 'C123', ts: '1.000001', user: 'U1', text: 'hi' };
			expect(parseEventEnvelope({ type: 'event_callback', team_id: 'T123', event_id: 'Ev123', event })).to.deep.equal({
				kind: 'event_callback',
				teamId: 'T123',
				eventId: 'Ev123',
				event,
			});
		});

		it('rejects an event_callback missing team_id / event_id / event', () => {
			const event = { type: 'message' };
			expect(parseEventEnvelope({ type: 'event_callback', event_id: 'Ev1', event })).to.equal(null);
			expect(parseEventEnvelope({ type: 'event_callback', team_id: 'T1', event })).to.equal(null);
			expect(parseEventEnvelope({ type: 'event_callback', team_id: 'T1', event_id: 'Ev1' })).to.equal(null);
			expect(parseEventEnvelope({ type: 'event_callback', team_id: 'T1', event_id: 'Ev1', event: [] })).to.equal(null);
			expect(parseEventEnvelope({ type: 'event_callback', team_id: 'T1', event_id: 'Ev1', event: 'nope' })).to.equal(null);
		});

		it('rejects unknown envelope types and junk bodies (fail-closed)', () => {
			expect(parseEventEnvelope({ type: 'app_rate_limited' })).to.equal(null);
			expect(parseEventEnvelope(null)).to.equal(null);
			expect(parseEventEnvelope('string')).to.equal(null);
			expect(parseEventEnvelope(42)).to.equal(null);
			expect(parseEventEnvelope({})).to.equal(null);
		});
	});
});
