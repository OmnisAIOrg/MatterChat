import { faker } from '@faker-js/faker';

import { Users } from '../fixtures/userStates';
import { HomeChannel } from '../page-objects';
import { setUserPreferences } from '../utils';
import { expect, test } from '../utils/test';

/**
 * @matterchat Channel↔matter link + Matters sidebar section (GRACEFUL, standalone-first).
 *
 * A matter-linked channel groups under a dedicated "Matters" section in the sidebar (only when
 * the user's `sidebarGroupByType` preference is on and the room carries `matterCardId`). We seed
 * the whole chain via the fork API — `boards.matters.ensureBoard` → `boards.matters.bind`
 * (binds a card to a STUB matter id that CasePro cannot resolve) → `boards.matters.linkChannel`
 * (creates/stamps the room with `matterCardId`) — then turn on the grouping preference and assert
 * the "Matters" collapser is visible with the matter channel under it.
 *
 * STANDALONE-FIRST (the fix under test): bind used to hard-fail with `400 error-matter-not-found`
 * when CasePro couldn't resolve the matter (disabled / stub / unknown id), which forced this spec
 * to self-skip. It now degrades gracefully: the bind SUCCEEDS locally, stores the matterId link,
 * and returns `resolved:false` + a `warning` (the snapshot is left PENDING for a later refresh).
 * So we assert the graceful contract directly instead of skipping — a bind failure is now a REAL
 * failure, not an expected environment gap.
 */

test.use({ storageState: Users.admin.state });

test.describe.serial('@matterchat matter link', () => {
	let matterChannelName: string | undefined;

	test.beforeAll(async ({ api }) => {
		const stubMatterId = `E2E-${faker.string.alphanumeric(8)}`;

		// ensure the matters board + its stage lists exist (standalone: stages fall back to the
		// canonical seed names when CasePro is unreachable, so this succeeds with no CRM).
		const ensure = await api.post('/boards.matters.ensureBoard', {});
		expect(ensure.status(), 'boards.matters.ensureBoard should succeed standalone').toBe(200);
		const ensureJson = await ensure.json();
		const boardId = ensureJson?.board?._id;
		const listId = ensureJson?.lists?.[0]?._id;
		expect(boardId, 'ensureBoard returns a board id').toBeTruthy();
		expect(listId, 'ensureBoard returns at least one stage list').toBeTruthy();

		// bind a card to a matter id CasePro cannot resolve — this MUST NOT 400 anymore. The bind
		// succeeds locally and reports the snapshot as unresolved/pending (the graceful contract).
		const bind = await api.post('/boards.matters.bind', { boardId, listId, matterId: stubMatterId });
		expect(bind.status(), 'boards.matters.bind must degrade gracefully (no 400 when CasePro cannot resolve)').toBe(200);
		const bindJson = await bind.json();
		const cardId = bindJson?.card?._id;
		expect(cardId, 'bind returns the soft-linked card').toBeTruthy();
		// the card carries the matter link even though CasePro could not load details…
		expect(bindJson?.card?.link?.matterId).toBe(stubMatterId);
		// …and the response flags it unresolved with a surfaced warning so the UI can say
		// "linked, but couldn't load matter details".
		expect(bindJson?.resolved, 'a stub/unknown matter is reported unresolved').toBe(false);
		expect(bindJson?.warning, 'an unresolved bind surfaces a warning').toBeTruthy();
		expect(
			bindJson?.card?.link?.snapshot?.resolved,
			'the cached snapshot is PENDING (resolved:false), left for a later refresh',
		).toBe(false);

		// link a channel to the card — creates/stamps the room with matterCardId (also standalone).
		const link = await api.post('/boards.matters.linkChannel', { cardId });
		expect(link.status(), 'boards.matters.linkChannel should succeed standalone').toBe(200);
		const card = (await link.json())?.card;
		const roomId = card?.link?.roomId;
		expect(roomId, 'linkChannel stamps a roomId on the card').toBeTruthy();

		const info = await api.get('/channels.info', { roomId });
		expect(info.status(), 'the linked room is readable').toBe(200);
		matterChannelName = (await info.json())?.channel?.name;
		expect(matterChannelName, 'the linked room has a name').toBeTruthy();

		// group the sidebar by type so the "Matters" section is emitted
		await setUserPreferences(api, { sidebarGroupByType: true });
	});

	test.afterAll(async ({ api }) => {
		await setUserPreferences(api, { sidebarGroupByType: false });
	});

	test('a gracefully-bound matter channel appears under the "Matters" sidebar section', async ({ page }) => {
		const poHomeChannel = new HomeChannel(page);
		await page.goto('/home');
		await page.locator('#main-content').waitFor();

		// the "Matters" group collapser is present (it only renders when a room has matterCardId)
		await expect(poHomeChannel.sidebar.getCollapseGroupByName('Matters')).toBeVisible({ timeout: 15_000 });

		// and the linked channel is listed in the sidebar
		await expect(poHomeChannel.sidebar.getSidebarItemByName(matterChannelName as string)).toBeVisible();
	});
});
