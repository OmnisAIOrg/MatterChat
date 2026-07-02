import type { BaseTest } from '../../utils/test';

/**
 * Fork API-seeding helpers for the MatterChat Boards specs.
 *
 * WHY API-SEED: per the e2e conventions, we set up state via the `boards.*` REST surface
 * (the same surface `scripts/boards-api-test.mjs` exercises) rather than clicking through the
 * UI. Tests then drive only the ONE interaction they're actually asserting (e.g. a drag, a
 * drawer open) and read back from the rendered board. This keeps them fast and non-flaky.
 *
 * Every helper uses the admin api context from `utils/test.ts` (`api.post`/`api.get`), so the
 * seeded board is owned by the admin user the specs log in as.
 */

export type SeededBoard = { boardId: string; listIds: string[]; cardIds: string[] };

/** Create a `general` board and return its id. */
export async function createBoard(api: BaseTest['api'], title: string): Promise<string> {
	const res = await api.post('/boards.create', { title, pipelineType: 'general' });
	const json = await res.json();
	const boardId = json?.board?._id;
	if (!boardId) {
		throw new Error(`boards.create failed: ${JSON.stringify(json)}`);
	}
	return boardId;
}

/** Create a list (column) on a board and return its id. */
export async function createList(api: BaseTest['api'], boardId: string, title: string): Promise<string> {
	const res = await api.post('/boards.list.create', { boardId, title });
	const json = await res.json();
	const listId = json?.list?._id;
	if (!listId) {
		throw new Error(`boards.list.create failed: ${JSON.stringify(json)}`);
	}
	return listId;
}

/** Create a card on a list and return its id. */
export async function createCard(api: BaseTest['api'], boardId: string, listId: string, title: string): Promise<string> {
	const res = await api.post('/boards.card.create', { boardId, listId, title });
	const json = await res.json();
	const cardId = json?.card?._id;
	if (!cardId) {
		throw new Error(`boards.card.create failed: ${JSON.stringify(json)}`);
	}
	return cardId;
}

/**
 * Seed a board with two lists ("To do", "Doing") and a handful of cards on the first list.
 * Returns everything the spec needs to deep-link and assert.
 */
export async function seedBoard(
	api: BaseTest['api'],
	title: string,
	cardTitles: string[] = [],
): Promise<SeededBoard & { todoListId: string; doingListId: string }> {
	const boardId = await createBoard(api, title);
	const todoListId = await createList(api, boardId, 'To do');
	const doingListId = await createList(api, boardId, 'Doing');
	const cardIds: string[] = [];
	for (const cardTitle of cardTitles) {
		// serial on purpose — positions are derived from max(position) so parallel inserts race

		cardIds.push(await createCard(api, boardId, todoListId, cardTitle));
	}
	return { boardId, listIds: [todoListId, doingListId], todoListId, doingListId, cardIds };
}

/** Bulk-seed N cards on one list as fast as the position math allows (serial, but no UI). */
export async function seedManyCards(api: BaseTest['api'], boardId: string, listId: string, count: number): Promise<number> {
	let created = 0;
	for (let i = 0; i < count; i++) {
		const res = await api.post('/boards.card.create', { boardId, listId, title: `Card ${i + 1}` });
		if (res.ok()) {
			created += 1;
		}
	}
	return created;
}

/** Read a board's cards back (single page, up to `count`). */
export async function getCards(
	api: BaseTest['api'],
	boardId: string,
	count = 200,
): Promise<{ _id: string; title: string; listId: string }[]> {
	const res = await api.get('/boards.cards', { boardId, count });
	const json = await res.json();
	return json?.cards ?? [];
}

/** Archive a board so a spec cleans up after itself. */
export async function archiveBoard(api: BaseTest['api'], boardId: string): Promise<void> {
	await api.post('/boards.setStatus', { boardId, status: 'archived' });
}
