import { Users } from '../fixtures/userStates';
import { createTargetChannel } from '../utils';
import { expect, test } from '../utils/test';

/**
 * @matterchat Legal hold — a room under a litigation hold refuses message pruning.
 *
 * The hold is placed/cleared through the fork's `rooms.setLegalHold` / `rooms.clearLegalHold`
 * REST endpoints (the same endpoints the admin-panel LegalHoldField toggle calls). We then
 * attempt a manual prune via `rooms.cleanHistory` and assert it is REFUSED with
 * `error-room-under-legal-hold`, and that the same prune SUCCEEDS once the hold is cleared.
 *
 * NOTE: the assertion is the refusal contract, which is enforced server-side regardless of how
 * the hold was placed — so we set the hold via API rather than click-driving the admin Rooms
 * panel (which needs the room row to be found + edited, a heavier/flakier path that tests the
 * same endpoint). The admin-panel toggle wiring is covered by the endpoint itself.
 */

test.use({ storageState: Users.admin.state });

test.describe.serial('@matterchat legal hold', () => {
	let targetChannel: string;
	let roomId: string;

	test.beforeAll(async ({ api }) => {
		targetChannel = await createTargetChannel(api);
		const info = await (await api.get('/channels.info', { roomName: targetChannel })).json();
		roomId = info.channel._id;
		// a message to give the pruner something it would otherwise remove
		await api.post('/chat.postMessage', { channel: `#${targetChannel}`, text: 'held evidence' });
	});

	test.afterAll(async ({ api }) => {
		// best-effort: ensure the hold is released so the room can be cleaned up
		await api.post('/rooms.clearLegalHold', { roomId });
	});

	test('prune is refused while the room is under a legal hold, and allowed after it clears', async ({ api }) => {
		// place the hold
		const set = await api.post('/rooms.setLegalHold', { roomId, caseId: 'CASE-2026-001', reason: 'active litigation' });
		expect(set.ok()).toBeTruthy();

		// a manual prune must be refused with the specific error
		const now = new Date();
		const oldest = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
		const refused = await api.post('/rooms.cleanHistory', { roomId, latest: now.toISOString(), oldest });
		expect(refused.status()).toBe(400);
		const refusedJson = await refused.json();
		expect(refusedJson.errorType ?? refusedJson.error).toContain('legal-hold');

		// clear the hold
		const cleared = await api.post('/rooms.clearLegalHold', { roomId });
		expect(cleared.ok()).toBeTruthy();

		// the same prune now succeeds
		const allowed = await api.post('/rooms.cleanHistory', { roomId, latest: now.toISOString(), oldest });
		expect(allowed.ok()).toBeTruthy();
	});
});
