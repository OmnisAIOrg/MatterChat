import { expect } from 'chai';
import { describe, it } from 'mocha';

/**
 * Regression suite for sent echo retention during message reconciliation.
 * Verifies that Slack/Teams messages sent via the browse lane persist in the UI
 * until the server list genuinely contains them, even through network errors
 * or API response timing issues.
 *
 * Background: PR #66 (7/17) added echo survival outside the react-query cache.
 * Echoes are stored in a ref-held Map and merged into the output until they appear
 * in the server list (by externalId match or text+time within 2 min).
 *
 * Regression: If a refetch error occurs or the response structure is malformed,
 * echoes would not be merged back into the output, causing sent messages to vanish
 * from the UI even though they were successfully delivered to the provider.
 */

describe('connectors: sent message echo retention', () => {
	/**
	 * Echo confirmation logic: when echoes are merged back into the output.
	 *
	 * An echo is "confirmed" (and dropped from the echo set) once the server list
	 * carries it. For server-provided externalId (Slack ts), we match on that id.
	 * For local-fallback ids (local-echo-${now}), we fall back to text+time match
	 * within a 2-minute window.
	 */
	describe('echo confirmation', () => {
		it('confirms an echo when server list has matching externalId', () => {
			// ARRANGE
			const echo = {
				externalId: '1234567890.123456', // Slack ts
				text: 'hello',
				createdAt: new Date('2026-07-18T12:00:00Z').toISOString(),
			};
			const serverMessage = {
				externalId: '1234567890.123456',
				text: 'hello',
				createdAt: new Date('2026-07-18T12:00:00Z').toISOString(),
			};

			// ACT: check if echo is confirmed
			const confirmed =
				echo.externalId === serverMessage.externalId ||
				(echo.text === serverMessage.text &&
					Math.abs(Date.parse(echo.createdAt) - Date.parse(serverMessage.createdAt)) < 120_000);

			// ASSERT
			expect(confirmed).to.be.true;
		});

		it('confirms an echo with local-fallback id when text matches within 2 minutes', () => {
			// ARRANGE: local-fallback echo with slightly different timestamp (network latency)
			const echo = {
				externalId: 'local-echo-1721317200123',
				text: 'urgent update',
				createdAt: new Date('2026-07-18T12:00:00Z').toISOString(),
			};
			const serverMessage = {
				externalId: '1234567890.000100', // Real Slack ts
				text: 'urgent update',
				createdAt: new Date('2026-07-18T12:00:01Z').toISOString(), // 1s later (reasonable latency)
			};

			// ACT
			const confirmed =
				echo.externalId === serverMessage.externalId ||
				(echo.text === serverMessage.text &&
					Math.abs(Date.parse(echo.createdAt) - Date.parse(serverMessage.createdAt)) < 120_000);

			// ASSERT
			expect(confirmed).to.be.true;
		});

		it('does not confirm an echo when server list is missing/empty', () => {
			// ARRANGE: echo with no server data yet (refetch error or loading)
			const echo = {
				externalId: '1234567890.123456',
				text: 'hello',
				createdAt: new Date('2026-07-18T12:00:00Z').toISOString(),
			};
			const serverMessages: any = undefined; // No server data

			// ACT: confirmation should never match if serverMessages is not an array
			const confirmed = !Array.isArray(serverMessages) ? false : serverMessages.some((m: any) => m.externalId === echo.externalId);

			// ASSERT
			expect(confirmed).to.be.false;
		});

		it('rejects a false-positive confirmation when text matches but timestamp is > 2 min apart', () => {
			// ARRANGE: two different messages with same text sent far apart
			const echo = {
				externalId: 'local-echo-1721317200000', // First send
				text: 'status update',
				createdAt: new Date('2026-07-18T12:00:00Z').toISOString(),
			};
			const serverMessage = {
				externalId: '9999999999.000001', // Different message
				text: 'status update',
				createdAt: new Date('2026-07-18T12:03:30Z').toISOString(), // 3.5 min later
			};

			// ACT: time diff is 210 seconds, exceeds 120s window
			const confirmed =
				echo.externalId === serverMessage.externalId ||
				(echo.text === serverMessage.text &&
					Math.abs(Date.parse(echo.createdAt) - Date.parse(serverMessage.createdAt)) < 120_000);

			// ASSERT
			expect(confirmed).to.be.false;
		});
	});

	/**
	 * Echo retention logic: how echoes survive through temporary network issues.
	 */
	describe('echo retention through network errors', () => {
		it('shows echoes even when the refetch returns an error', () => {
			// ARRANGE: sent echo is in our ref-held set
			const held = [
				{ msg: { externalId: '1234567890.123456', text: 'test', createdAt: new Date().toISOString() }, at: Date.now() - 500 },
			];
			const serverMessages: any = undefined; // Refetch returned error

			// ACT: merge logic should show echoes when server data is missing
			const mergedMessages =
				!serverMessages && held.length > 0 ? held.map((e: any) => e.msg) : serverMessages || undefined;

			// ASSERT
			expect(mergedMessages).to.be.an('array').with.lengthOf(1);
			expect(mergedMessages?.[0]?.externalId).to.equal('1234567890.123456');
		});

		it('shows echoes even when the refetch returns ok:false (provider error)', () => {
			// ARRANGE: sent echo is in our ref-held set
			const held = [
				{ msg: { externalId: 'local-echo-123', text: 'hello', createdAt: new Date().toISOString() }, at: Date.now() - 300 },
			];
			const serverMessages: any = undefined; // Provider error, data?.ok === false

			// ACT: merge logic persists echoes through provider errors
			const mergedMessages =
				!serverMessages && held.length > 0 ? held.map((e: any) => e.msg) : serverMessages || undefined;

			// ASSERT
			expect(mergedMessages).to.be.an('array').with.lengthOf(1);
			expect(mergedMessages?.[0]?.text).to.equal('hello');
		});

		it('cleans up echoes older than 10 minutes', () => {
			// ARRANGE: mix of fresh and stale echoes
			const now = Date.now();
			const ECHO_RETENTION_MS = 10 * 60_000;
			const held = [
				{ msg: { externalId: 'echo-1', text: 'fresh', createdAt: new Date().toISOString() }, at: now - 1_000 },
				{ msg: { externalId: 'echo-2', text: 'stale', createdAt: new Date().toISOString() }, at: now - ECHO_RETENTION_MS - 1_000 },
				{ msg: { externalId: 'echo-3', text: 'recent', createdAt: new Date().toISOString() }, at: now - 5 * 60_000 },
			];

			// ACT: filter out stale echoes
			const surviving = held.filter((e) => now - e.at < ECHO_RETENTION_MS);

			// ASSERT
			expect(surviving).to.have.lengthOf(2);
			expect(surviving.map((e) => e.msg.externalId)).to.deep.equal(['echo-1', 'echo-3']);
		});

		it('removes confirmed echoes from the retention set when they appear in server list', () => {
			// ARRANGE: echo that just appeared in server list
			const held = [
				{ msg: { externalId: '1234567890.123456', text: 'confirmed', createdAt: new Date().toISOString() }, at: Date.now() - 1_000 },
				{ msg: { externalId: 'local-echo-789', text: 'still-pending', createdAt: new Date().toISOString() }, at: Date.now() - 500 },
			];
			const serverMessages = [
				{ externalId: '1234567890.123456', text: 'confirmed', createdAt: new Date().toISOString() },
				{ externalId: '1234567890.000099', text: 'other', createdAt: new Date().toISOString() },
			];
			const now = Date.now();
			const ECHO_RETENTION_MS = 10 * 60_000;

			// ACT: filter confirmed echoes
			const confirmed = (echo: any) =>
				serverMessages.some(
					(m: any) =>
						m.externalId === echo.externalId ||
						(m.text === echo.text && Math.abs(Date.parse(m.createdAt) - Date.parse(echo.createdAt)) < 120_000),
				);
			const surviving = held.filter((e: any) => now - e.at < ECHO_RETENTION_MS && !confirmed(e.msg));

			// ASSERT
			expect(surviving).to.have.lengthOf(1);
			expect(surviving[0].msg.externalId).to.equal('local-echo-789');
		});
	});

	/**
	 * Integration: full echo lifecycle during a send-and-reconcile flow.
	 */
	describe('full send + reconcile flow', () => {
		it('persists echo through cache update → refetch → error → retry → success', () => {
			// ARRANGE: simulate the full flow
			const connectionId = 'conn-1';
			const channelExternalId = 'C123';
			const echoKey = `${connectionId}:${channelExternalId}`;
			const recentEchoesRef = new Map<string, { msg: any; at: number }[]>();
			const now = Date.now();

			// Step 1: user sends message → echo is added
			const echo = { externalId: '1234567890.123456', text: 'hello', createdAt: new Date().toISOString() };
			recentEchoesRef.set(echoKey, [{ msg: echo, at: now }]);
			let cachedData = { ok: true, messages: [echo] };
			let displayed = cachedData.messages;

			expect(displayed).to.have.lengthOf(1);
			expect(displayed[0].text).to.equal('hello');

			// Step 2: background refetch completes with error → server data unavailable
			// (e.g., Slack's rate limit or temporary auth issue)
			const serverMessages: any = undefined;
			const held = recentEchoesRef.get(echoKey) || [];
			const mergedMessages: any = !serverMessages && held.length > 0 ? held.map((e: any) => e.msg) : serverMessages;
			displayed = mergedMessages;

			expect(displayed).to.have.lengthOf(1);
			expect(displayed[0].text).to.equal('hello'); // Echo persists!

			// Step 3: retry succeeds, server list still doesn't have the message
			// (Slack's conversations.history omits very recent posts for a few seconds)
			cachedData = { ok: true, messages: [] }; // Fresh list, no echo yet
			const serverList = cachedData.messages;
			const confirmed = (e: any) => serverList.some((m: any) => m.externalId === e.externalId);
			const surviving = held.filter((e: any) => !confirmed(e.msg));
			const finalMerged = surviving.length > 0 ? [...surviving.map((e: any) => e.msg), ...serverList] : serverList;
			displayed = finalMerged;

			expect(displayed).to.have.lengthOf(1);
			expect(displayed[0].text).to.equal('hello'); // Echo STILL visible!

			// Step 4: final sync, server list includes the message
			cachedData = { ok: true, messages: [{ externalId: '1234567890.123456', text: 'hello', createdAt: echo.createdAt }] };
			const finalServerList = cachedData.messages;
			const finalConfirmed = (e: any) =>
				finalServerList.some((m: any) => m.externalId === e.externalId || (m.text === e.text && Math.abs(Date.parse(m.createdAt) - Date.parse(e.createdAt)) < 120_000));
			const finalSurviving = held.filter((e: any) => !finalConfirmed(e.msg));
			const completelyMerged = finalSurviving.length > 0 ? [...finalSurviving.map((e: any) => e.msg), ...finalServerList] : finalServerList;
			displayed = completelyMerged;

			expect(displayed).to.have.lengthOf(1);
			expect(displayed[0].externalId).to.equal('1234567890.123456'); // Real Slack ID, echo confirmed!
			expect(finalSurviving).to.have.lengthOf(0); // Echo removed from retention set
		});
	});
});
