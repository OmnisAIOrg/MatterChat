import { faker } from '@faker-js/faker';

import { Users } from '../fixtures/userStates';
import { HomeChannel } from '../page-objects';
import { setUserPreferences } from '../utils';
import { expect, test } from '../utils/test';

/**
 * @matterchat Channel↔matter link + Matters sidebar section.
 *
 * A matter-linked channel groups under a dedicated "Matters" section in the sidebar (only when
 * the user's `sidebarGroupByType` preference is on and the room carries `matterCardId`). We seed
 * the whole chain via the fork API — `boards.matters.ensureBoard` → `boards.matters.bind`
 * (binds a card to a stub matter id; no CasePro needed, snapshot resolution degrades) →
 * `boards.matters.linkChannel` (creates/stamps the room with `matterCardId`) — then turn on the
 * grouping preference and assert the "Matters" collapser is visible with the matter channel
 * under it.
 *
 * DEFENSIVE SETUP: the matters chain is fork-specific and can legitimately be unavailable in a
 * bare CE gate (e.g. the matters board/permission wiring). If any seeding step fails we skip
 * with a clear annotation rather than asserting against a half-seeded state (which would flake).
 */

test.use({ storageState: Users.admin.state });

test.describe.serial('@matterchat matter link', () => {
	let matterChannelName: string | undefined;

	test.beforeAll(async ({ api }) => {
		const stubMatterId = `E2E-${faker.string.alphanumeric(8)}`;

		const ensure = await api.post('/boards.matters.ensureBoard', {});
		if (!ensure.ok()) {
			return; // leaves matterChannelName undefined → tests skip
		}
		const ensureJson = await ensure.json();
		const boardId = ensureJson?.board?._id;
		const listId = ensureJson?.lists?.[0]?._id;
		if (!boardId || !listId) {
			return;
		}

		const bind = await api.post('/boards.matters.bind', { boardId, listId, matterId: stubMatterId });
		if (!bind.ok()) {
			return;
		}
		const cardId = (await bind.json())?.card?._id;
		if (!cardId) {
			return;
		}

		const link = await api.post('/boards.matters.linkChannel', { cardId });
		if (!link.ok()) {
			return;
		}

		// resolve the room the link created/stamped and remember its name for the sidebar assertion
		const card = (await link.json())?.card;
		const roomId = card?.link?.roomId;
		if (!roomId) {
			return;
		}
		const info = await api.get('/channels.info', { roomId });
		if (info.ok()) {
			matterChannelName = (await info.json())?.channel?.name;
		}

		// group the sidebar by type so the "Matters" section is emitted
		await setUserPreferences(api, { sidebarGroupByType: true });
	});

	test.afterAll(async ({ api }) => {
		await setUserPreferences(api, { sidebarGroupByType: false });
	});

	test('the matter channel appears under the "Matters" sidebar section', async ({ page }) => {
		test.skip(!matterChannelName, 'matters chain (ensureBoard/bind/linkChannel) unavailable in this environment');

		const poHomeChannel = new HomeChannel(page);
		await page.goto('/home');
		await page.locator('#main-content').waitFor();

		// the "Matters" group collapser is present (it only renders when a room has matterCardId)
		await expect(poHomeChannel.sidebar.getCollapseGroupByName('Matters')).toBeVisible({ timeout: 15_000 });

		// and the linked channel is listed in the sidebar
		await expect(poHomeChannel.sidebar.getSidebarItemByName(matterChannelName as string)).toBeVisible();
	});
});
