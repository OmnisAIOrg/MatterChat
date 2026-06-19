import type { Serialized, IBoard, IBoardList } from '@rocket.chat/core-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { BoardContextOptions } from './types';

/**
 * Resolve the builder's picker options (lists / labels / members / custom fields)
 * from a board. Reads `GET /v1/boards.info` (board + lists). Member labels show the
 * userId as-is (the board doc carries only `{ userId, role }`); that is sufficient
 * for an admin-facing builder and avoids an extra users lookup. When `boardId` is
 * undefined (a GLOBAL automation), there is no single board to bind to — pickers
 * fall back to free-text entry and we return empty option arrays.
 */
export const useBoardOptions = (boardId?: string): { options: BoardContextOptions; isLoading: boolean } => {
	const getBoardInfo = useEndpoint('GET', '/v1/boards.info');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'info', boardId],
		queryFn: () => getBoardInfo({ boardId: boardId as string }),
		enabled: Boolean(boardId),
	});

	const options = useMemo<BoardContextOptions>(() => {
		const board = data?.board as Serialized<IBoard> | undefined;
		const lists = (data?.lists as Serialized<IBoardList>[] | undefined) ?? [];
		return {
			lists: [...lists]
				.filter((l) => !l.archived)
				.sort((a, b) => a.position - b.position)
				.map((l) => ({ value: l._id, label: l.title })),
			labels: (board?.labelDefs ?? []).map((l) => ({ value: l.id, label: l.name })),
			members: (board?.members ?? []).map((m) => ({ value: m.userId, label: m.userId })),
			fields: (board?.fieldDefs ?? []).map((f) => ({ value: f.id, label: f.name })),
		};
	}, [data]);

	return { options, isLoading };
};
