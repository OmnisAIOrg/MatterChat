import { IS_EE } from '../config/constants';
import { createAuxContext } from '../fixtures/createAuxContext';
import { Users } from '../fixtures/userStates';
import { HomeChannel } from '../page-objects';
import { createTargetChannel, setSettingValueById } from '../utils';
import { expect, test } from '../utils/test';

/**
 * @matterchat Read receipts (2-user A→B→receipt).
 *
 * IMPORTANT: message read-receipts are an ENTERPRISE feature in Rocket.Chat. The receipt
 * indicator ("Message viewed" status + the "Read receipts" viewer modal) only renders when
 * `IS_EE` is true, which our MIT/CE fork never sets. The upstream `read-receipts.spec.ts`
 * already covers the full A-sends → B-reads → receipt flow and self-skips on CE — duplicating
 * that assertion here would just skip identically.
 *
 * So this fork spec asserts the ONE part that IS meaningful on our CE gate — that the two
 * read-receipt settings can be flipped on via the admin API (globalSetup path) and that with
 * them OFF the receipts menu item is correctly absent — and marks the EE-only receipt-indicator
 * assertion `test.skip` with the reason, rather than shipping a test that flakes red.
 */

test.use({ storageState: Users.admin.state });

test.describe.serial('@matterchat read receipts', () => {
	let poHomeChannel: HomeChannel;
	let targetChannel: string;

	test.beforeAll(async ({ api }) => {
		targetChannel = await createTargetChannel(api);
	});

	test.beforeEach(async ({ page }) => {
		poHomeChannel = new HomeChannel(page);
		await poHomeChannel.gotoChannel(targetChannel);
	});

	test('with read receipts OFF, the message menu has no "Read receipts" item', async ({ page }) => {
		await poHomeChannel.content.sendMessage('hello world');
		await poHomeChannel.content.openLastMessageMenu();
		await expect(page.locator('role=menuitem[name="Read receipts"]')).not.toBeVisible();
	});

	test('admin can enable both read-receipt settings via the API', async ({ api }) => {
		const a = await setSettingValueById(api, 'Message_Read_Receipt_Enabled', true);
		const b = await setSettingValueById(api, 'Message_Read_Receipt_Store_Users', true);
		expect(a.ok()).toBeTruthy();
		expect(b.ok()).toBeTruthy();
		// revert so we don't leak state into other specs sharing this server
		await setSettingValueById(api, 'Message_Read_Receipt_Enabled', false);
		await setSettingValueById(api, 'Message_Read_Receipt_Store_Users', false);
	});

	test('A sends, B reads, A sees the "viewed" receipt indicator', async ({ browser, api }) => {
		test.skip(
			!IS_EE,
			'Read-receipt indicators are an Enterprise feature (IS_EE); our MIT/CE gate never sets it. Upstream read-receipts.spec.ts owns this flow.',
		);

		await setSettingValueById(api, 'Message_Read_Receipt_Enabled', true);
		await setSettingValueById(api, 'Message_Read_Receipt_Store_Users', true);

		// A (admin) sends
		await poHomeChannel.content.sendMessage('receipt please');
		await expect(poHomeChannel.content.lastUserMessage.getByRole('status', { name: 'Message sent' })).toBeVisible();

		// B (user1) opens the channel → marks it read
		const { page: bPage } = await createAuxContext(browser, Users.user1);
		const bChannel = new HomeChannel(bPage);
		await bChannel.gotoChannel(targetChannel);

		// A now sees the "viewed" indicator
		await expect(poHomeChannel.content.lastUserMessage.getByRole('status', { name: 'Message viewed' })).toBeVisible();
		await bPage.close();

		await setSettingValueById(api, 'Message_Read_Receipt_Enabled', false);
		await setSettingValueById(api, 'Message_Read_Receipt_Store_Users', false);
	});
});
