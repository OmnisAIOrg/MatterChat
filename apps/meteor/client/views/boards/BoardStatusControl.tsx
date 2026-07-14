import type { BoardsStatus, IBoard, Serialized } from '@rocket.chat/core-typings';
import { Box, Tag } from '@rocket.chat/fuselage';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BoardStatusControl — the board header control for a board's lifecycle status.
 *
 * Shows the current status as a colored Tag next to a GenericMenu (mirroring
 * ViewSwitcher/BoardButtonsMenu's GenericMenu use — its default IconButton launcher)
 * listing the four lifecycle states. Picking one calls
 * `POST /v1/boards.setStatus { boardId, status }` and, on success, invalidates the
 * board-info query (`['boards', 'info', boardId]`, the key BoardRouter uses) so the
 * header re-reads and the Tag reflects the new status. The server enforces the write
 * permission, so this control renders unconditionally (matching boards.update/archive,
 * which have no client-side permission gate) and toasts on error.
 */

type BoardStatusControlProps = {
	board: Serialized<IBoard>;
};

// Display metadata for each lifecycle status: a translation key + fallback label and
// the Tag variant that conveys it (active=primary, on_hold/completed neutral, archived danger).
const STATUS_META: Record<BoardsStatus, { i18n: string; fallback: string; variant?: 'primary' | 'danger' }> = {
	active: { i18n: 'Boards_Status_Active', fallback: 'Active', variant: 'primary' },
	on_hold: { i18n: 'Boards_Status_OnHold', fallback: 'On hold' },
	completed: { i18n: 'Boards_Status_Completed', fallback: 'Completed' },
	archived: { i18n: 'Boards_Status_Archived', fallback: 'Archived', variant: 'danger' },
};

// Render order of the options in the menu.
const STATUS_ORDER: BoardsStatus[] = ['active', 'on_hold', 'completed', 'archived'];

const BoardStatusControl = ({ board }: BoardStatusControlProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const setStatus = useEndpoint('POST', '/v1/boards.setStatus');

	// Absent status ⇒ treat as 'active' (or 'archived' when the legacy flag is set),
	// matching the IBoard back-compat contract.
	const current: BoardsStatus = board.status ?? (board.archived ? 'archived' : 'active');

	const mutation = useMutation({
		mutationFn: (status: BoardsStatus) => setStatus({ boardId: board._id, status }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['boards', 'info', board._id] });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const label = (status: BoardsStatus): string => {
		const meta = STATUS_META[status];
		return t(meta.i18n, { defaultValue: meta.fallback });
	};

	const items: GenericMenuItemProps[] = STATUS_ORDER.map((status) => ({
		id: status,
		content: label(status),
		// checkmark on the current status
		addon: status === current ? '✓' : undefined,
		disabled: mutation.isPending,
		onClick: () => {
			if (status !== current) {
				mutation.mutate(status);
			}
		},
	}));

	const currentMeta = STATUS_META[current];

	return (
		<Box display='flex' alignItems='center' style={{ gap: '4px' }}>
			<Tag variant={currentMeta.variant}>{label(current)}</Tag>
			<GenericMenu
				title={t('Boards_Status_Change', { defaultValue: 'Change status' })}
				icon='flag'
				items={items}
				placement='bottom-end'
				disabled={mutation.isPending}
			/>
		</Box>
	);
};

export default BoardStatusControl;
