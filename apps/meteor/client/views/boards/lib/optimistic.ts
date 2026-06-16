/**
 * Minimal structural shape these helpers need from a card. Works for both the
 * raw `IBoardCard` and its wire-serialized form (`Serialized<IBoardCard>`),
 * since only id/listId/position/archived are touched and those are primitives
 * in both representations.
 */
export type PositionedCard = {
	_id: string;
	listId: string;
	position: number;
	archived: boolean;
};

/**
 * Fractional positioning helpers (LexoRank-style). The server appends new
 * cards/lists at `maxPosition + POSITION_STEP`; for an optimistic drag we
 * compute the fractional midpoint between the two drop neighbours so siblings
 * never renumber and the move is a single-doc write. Matches the server's
 * `POSITION_STEP = 1024`.
 */
export const POSITION_STEP = 1024;

/**
 * Midpoint position for a card dropped between `before` and `after` in the
 * target list (both already ordered by `position`). `before`/`after` are the
 * neighbours' positions, or `undefined` at an edge.
 *
 * - drop at the very top   -> before=undefined           -> after.position / 2 (or STEP if empty edge)
 * - drop at the very bottom-> after=undefined             -> before.position + STEP
 * - drop into an empty list-> both undefined              -> POSITION_STEP
 */
export const midpointPosition = (before: number | undefined, after: number | undefined): number => {
	if (before === undefined && after === undefined) {
		return POSITION_STEP;
	}
	if (before === undefined && after !== undefined) {
		return after / 2;
	}
	if (before !== undefined && after === undefined) {
		return before + POSITION_STEP;
	}
	// both defined
	return ((before as number) + (after as number)) / 2;
};

/** Cards in a list ordered the way the board view renders them. */
export const sortCards = <T extends PositionedCard>(cards: T[]): T[] => [...cards].sort((a, b) => a.position - b.position);

/** Group a flat card array by `listId` (archived cards excluded), each group sorted by position. */
export const groupCardsByList = <T extends PositionedCard>(cards: T[]): Record<string, T[]> => {
	const out: Record<string, T[]> = {};
	for (const card of cards) {
		if (card.archived) {
			continue;
		}
		(out[card.listId] ??= []).push(card);
	}
	for (const listId of Object.keys(out)) {
		out[listId] = sortCards(out[listId]);
	}
	return out;
};

export type MovePlan = { toListId: string; position: number };

/**
 * Given the current per-list ordering, the dragged card, the target list, and
 * the index the card is being dropped at (within the target list's array as it
 * looks AFTER the card is removed from its source), produce the move plan: the
 * target list id + the fractional position to persist.
 */
export const computeMovePlan = <T extends PositionedCard>(
	cardsByList: Record<string, T[]>,
	activeCardId: string,
	toListId: string,
	dropIndex: number,
): MovePlan => {
	const target = (cardsByList[toListId] ?? []).filter((c) => c._id !== activeCardId);
	const before = dropIndex > 0 ? target[dropIndex - 1]?.position : undefined;
	const after = target[dropIndex]?.position;
	return { toListId, position: midpointPosition(before, after) };
};

/**
 * Produce a new card array reflecting an optimistic move (used to patch the
 * react-query cache before the server acks). Returns a new array; never mutates.
 */
export const applyOptimisticMove = <T extends PositionedCard>(cards: T[], cardId: string, toListId: string, position: number): T[] =>
	cards.map((c) => (c._id === cardId ? { ...c, listId: toListId, position } : c));
