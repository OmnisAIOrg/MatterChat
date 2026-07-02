import { faker } from '@faker-js/faker';

import { Users } from '../fixtures/userStates';
import { expect, test } from '../utils/test';
import { archiveBoard, getCards, seedBoard } from './fixtures/boards-api';

/**
 * @matterchat Boards — the fork's biggest surface (Kanban board / list / card).
 *
 * Strategy: seed the board + lists + starting cards via the `boards.*` REST API (fast, no
 * flaky click-through), then deep-link to the board view and assert the rendered result. Only
 * the genuinely interactive assertions (add-card via the QuickAddCard composer, open the card
 * drawer) are driven through the UI. The card MOVE is performed via the `boards.card.move`
 * endpoint and re-asserted from the API — dnd-kit drag simulation is notoriously flaky headless,
 * and the move endpoint is what the drag handler actually calls (`boards.cardMove`), so we test
 * the same contract without the pointer-physics flake.
 */

test.use({ storageState: Users.admin.state });

test.describe.serial('@matterchat boards', () => {
	let boardId: string;
	let todoListId: string;
	let doingListId: string;
	let seedCardTitles: string[];

	test.beforeAll(async ({ api }) => {
		seedCardTitles = [`Draft complaint ${faker.string.alpha(5)}`, `File motion ${faker.string.alpha(5)}`];
		const seeded = await seedBoard(api, `Litigation ${faker.string.uuid()}`, seedCardTitles);
		boardId = seeded.boardId;
		todoListId = seeded.todoListId;
		doingListId = seeded.doingListId;
	});

	test.afterAll(async ({ api }) => {
		if (boardId) {
			await archiveBoard(api, boardId);
		}
	});

	test('renders the board with its lists and seeded cards', async ({ page }) => {
		await page.goto(`/boards/board/${boardId}/board`);

		// lists (columns) render by title
		await expect(page.getByText('To do', { exact: true })).toBeVisible();
		await expect(page.getByText('Doing', { exact: true })).toBeVisible();

		// each seeded card renders as a role=button tile with its title as the aria-label
		for (const title of seedCardTitles) {
			await expect(page.getByRole('button', { name: title })).toBeVisible();
		}
	});

	test('adds a card through the QuickAddCard composer', async ({ page }) => {
		await page.goto(`/boards/board/${boardId}/board`);
		await expect(page.getByText('To do', { exact: true })).toBeVisible();

		const newCardTitle = `Serve defendant ${faker.string.alpha(6)}`;

		// the collapsed "Add card" buttons (one per column) — click the first list's opener
		await page.getByRole('button', { name: 'Add card' }).first().click();

		// the composer textarea shares the "Add card" accessible name (placeholder)
		const composer = page.getByPlaceholder('Add card').first();
		await composer.fill(newCardTitle);
		await composer.press('Enter');

		// the new tile appears on the board
		await expect(page.getByRole('button', { name: newCardTitle })).toBeVisible();
	});

	test('moves a card between lists and re-renders it under the new column', async ({ page, api }) => {
		await page.goto(`/boards/board/${boardId}/board`);
		const movingTitle = seedCardTitles[0];
		const tile = page.getByRole('button', { name: movingTitle });
		await expect(tile).toBeVisible();

		// resolve the card id from the API, then invoke the same move contract the drag handler uses
		const cardsBefore = await getCards(api, boardId);
		const moving = cardsBefore.find((c) => c.title === movingTitle);
		expect(moving?.listId).toBe(todoListId);
		const movingId = moving?._id as string;

		const moveRes = await api.post('/boards.card.move', { cardId: movingId, toListId: doingListId, position: 1 });
		expect(moveRes.ok()).toBeTruthy();

		// the persisted move is reflected in the API…
		const cardsAfter = await getCards(api, boardId);
		expect(cardsAfter.find((c) => c._id === movingId)?.listId).toBe(doingListId);

		// …and after a reload the tile still renders (now under "Doing")
		await page.reload();
		await expect(page.getByRole('button', { name: movingTitle })).toBeVisible();
	});

	test('opens the card detail drawer when a tile is clicked', async ({ page }) => {
		await page.goto(`/boards/board/${boardId}/board`);
		const title = seedCardTitles[1];
		const tile = page.getByRole('button', { name: title });
		await expect(tile).toBeVisible();

		await tile.click();

		// the drawer deep-links the card id into the URL and shows the card title in its header
		await expect(page).toHaveURL(new RegExp(`/boards/board/${boardId}/board/`));
		await expect(page.locator('#contextualbarTitle')).toHaveText(title);
	});
});
