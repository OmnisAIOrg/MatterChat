import type { Serialized } from '@rocket.chat/core-typings';
import type { QueryBoardCardsResultDTO } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * useBoardViewCards — runs the server `boards.views.cards` engine for the active
 * (saved or ad-hoc) view and returns the rows/groups the Table/Timeline/Dashboard
 * views render.
 *
 * The server hydrates the view's `config` + `viewType` from `viewId` when given
 * (and the caller may override `viewType` to preview e.g. a saved table as a
 * timeline), else it runs an empty config — so a brand-new board with no saved
 * view still returns all its cards. Reads are gated server-side by `boards-view`.
 */
export const boardViewCardsKey = (boardId: string, viewType: string, viewId?: string): (string | undefined)[] => [
	'boards',
	'views',
	'cards',
	boardId,
	viewType,
	viewId,
];

export const useBoardViewCards = (
	boardId: string,
	viewType: 'table' | 'timeline' | 'dashboard' | 'calendar' | 'board',
	viewId?: string,
): UseQueryResult<Serialized<{ result: QueryBoardCardsResultDTO }>> => {
	const getViewCards = useEndpoint('GET', '/v1/boards.views.cards');

	return useQuery({
		queryKey: boardViewCardsKey(boardId, viewType, viewId),
		queryFn: () =>
			getViewCards({
				boardId,
				viewType,
				...(viewId ? { viewId } : {}),
			}),
		enabled: Boolean(boardId),
	});
};
