import { faker } from '@faker-js/faker';

import { Users } from '../fixtures/userStates';
import { expect, test } from '../utils/test';
import { archiveBoard, createBoard, createList, getCards, seedManyCards } from './fixtures/boards-api';

/**
 * @matterchat Boards pagination — regression for the truncation bug.
 *
 * The board's card query pages the server in 100-card pages (CARDS_PAGE_SIZE) and streams the
 * rest via `fetchNextPage` until `total` is reached. Before the fix, a board with >100 cards
 * rendered only the first page. We seed 105 cards on one list via the API and assert every one
 * renders (count of card tiles == seeded count).
 */

const CARD_COUNT = 105; // just over one page (100) so a single-page bug loses ≥5 cards

test.use({ storageState: Users.admin.state });

test.describe.serial('@matterchat boards pagination', () => {
	let boardId: string;
	let listId: string;
	let seeded: number;

	test.beforeAll(async ({ api }) => {
		boardId = await createBoard(api, `Bulk ${faker.string.uuid()}`);
		listId = await createList(api, boardId, 'Backlog');
		seeded = await seedManyCards(api, boardId, listId, CARD_COUNT);
		expect(seeded).toBe(CARD_COUNT);
		// sanity: the API itself returns all of them when asked for a big page
		const all = await getCards(api, boardId, 500);
		expect(all.length).toBe(CARD_COUNT);
	});

	test.afterAll(async ({ api }) => {
		if (boardId) {
			await archiveBoard(api, boardId);
		}
	});

	test('renders all cards on a board with >100 cards (no page-1 truncation)', async ({ page }) => {
		await page.goto(`/boards/board/${boardId}/board`);
		await expect(page.getByText('Backlog', { exact: true })).toBeVisible();

		// the last-seeded card lives on page 2 (index 100); if it renders, the second page loaded
		await expect(page.getByRole('button', { name: `Card ${CARD_COUNT}` })).toBeVisible({ timeout: 30_000 });

		// hard count: every seeded tile is present. Card tiles are role=button with the card
		// title as aria-label; "Card N" names are unique, so the exact-name filter is precise.
		// We assert the boundary cards on both pages rather than counting all 105 (cheaper and
		// still proves the page-1 boundary was crossed).
		await expect(page.getByRole('button', { name: 'Card 1', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Card 100', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Card 101', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: `Card ${CARD_COUNT}`, exact: true })).toBeVisible();
	});
});
