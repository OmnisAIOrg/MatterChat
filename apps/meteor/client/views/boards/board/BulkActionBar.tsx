import type { IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, ButtonGroup, Icon, Throbber } from '@rocket.chat/fuselage';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BulkActionBar — the contextual action bar for the board's multi-select.
 *
 * Appears (rendered by BoardView) only when ≥1 card is selected. Each action calls the
 * existing `POST /v1/boards.cards.bulk` server endpoint with the current `cardIds`, then
 * clears the selection and refetches the board's cards (same query key BoardView reads:
 * `['boards', 'cards', boardId]`). A brief "{n} updated" toast surfaces the result; any
 * per-card failures are appended ("{m} failed"). "Move to list" and "Set priority" use a
 * Fuselage GenericMenu — the same overflow-menu pattern as BoardButtonsMenu/ViewSwitcher.
 */

type Priority = 'low' | 'medium' | 'high' | 'urgent';

type BulkActionBarProps = {
	boardId: string;
	selectedIds: string[];
	lists: Serialized<IBoardList>[];
	onClearSelection: () => void;
};

const PRIORITIES: { id: Priority; labelKey: string; fallback: string; icon: 'arrow-down' | 'arrow-jump' | 'arrow-up' | 'warning' }[] = [
	{ id: 'low', labelKey: 'Boards_Priority_Low', fallback: 'Low', icon: 'arrow-down' },
	{ id: 'medium', labelKey: 'Boards_Priority_Medium', fallback: 'Medium', icon: 'arrow-jump' },
	{ id: 'high', labelKey: 'Boards_Priority_High', fallback: 'High', icon: 'arrow-up' },
	{ id: 'urgent', labelKey: 'Boards_Priority_Urgent', fallback: 'Urgent', icon: 'warning' },
];

type BulkParams =
	| { action: 'complete'; completed: boolean }
	| { action: 'archive' }
	| { action: 'delete' }
	| { action: 'setPriority'; priority: Priority }
	| { action: 'move'; toListId: string };

const BulkActionBar = ({ boardId, selectedIds, lists, onClearSelection }: BulkActionBarProps): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const bulkEndpoint = useEndpoint('POST', '/v1/boards.cards.bulk');
	const cardsQueryKey = ['boards', 'cards', boardId];

	const bulkMutation = useMutation({
		mutationFn: (params: BulkParams) => bulkEndpoint({ cardIds: selectedIds, ...params }),
		onSuccess: (result) => {
			const failedSuffix =
				result.failed > 0 ? `, ${t('Boards_Bulk_Failed', { defaultValue: '{{count}} failed', count: result.failed })}` : '';
			dispatchToastMessage({
				type: result.failed > 0 ? 'warning' : 'success',
				message: `${t('Boards_Bulk_Updated', { defaultValue: '{{count}} updated', count: result.updated })}${failedSuffix}`,
			});
			onClearSelection();
			void queryClient.invalidateQueries({ queryKey: cardsQueryKey });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const run = useCallback((params: BulkParams) => bulkMutation.mutate(params), [bulkMutation]);

	const busy = bulkMutation.isPending;

	const movableLists = lists.filter((l) => !l.archived).sort((a, b) => a.position - b.position);

	const moveItems: GenericMenuItemProps[] = movableLists.map((list) => ({
		id: list._id,
		icon: 'arrow-forward',
		content: list.title,
		disabled: busy,
		onClick: () => run({ action: 'move', toListId: list._id }),
	}));

	const priorityItems: GenericMenuItemProps[] = PRIORITIES.map((p) => ({
		id: p.id,
		icon: p.icon,
		content: t(p.labelKey, { defaultValue: p.fallback }),
		disabled: busy,
		onClick: () => run({ action: 'setPriority', priority: p.id }),
	}));

	return (
		<Box
			display='flex'
			alignItems='center'
			flexWrap='wrap'
			p={8}
			mbe={8}
			bg='tint'
			borderRadius='x4'
			borderWidth='default'
			borderColor='extra-light'
			role='toolbar'
			aria-label={t('Boards_Bulk_Toolbar', { defaultValue: 'Bulk actions' })}
			className='rcx-boards-bulk-bar'
		>
			<Box display='flex' alignItems='center' mie={12} fontScale='p2b' color='default'>
				{busy && <Throbber inheritColor size='x12' mie={8} />}
				{t('Boards_Bulk_Selected', { defaultValue: '{{count}} selected', count: selectedIds.length })}
			</Box>

			<ButtonGroup mie={8}>
				<Button small disabled={busy} onClick={() => run({ action: 'complete', completed: true })}>
					<Icon name='circle-check' size='x16' mie={4} />
					{t('Complete', { defaultValue: 'Complete' })}
				</Button>
				<Button small disabled={busy} onClick={() => run({ action: 'archive' })}>
					<Icon name='arrow-down-box' size='x16' mie={4} />
					{t('Archive', { defaultValue: 'Archive' })}
				</Button>
				<Button small danger disabled={busy} onClick={() => run({ action: 'delete' })}>
					<Icon name='trash' size='x16' mie={4} />
					{t('Delete', { defaultValue: 'Delete' })}
				</Button>
			</ButtonGroup>

			<Box mie={8}>
				<GenericMenu
					title={t('Boards_Bulk_SetPriority', { defaultValue: 'Set priority' })}
					icon='flag'
					items={priorityItems}
					disabled={busy}
					placement='bottom-start'
				/>
			</Box>

			<Box mie={8}>
				<GenericMenu
					title={t('Boards_Bulk_MoveToList', { defaultValue: 'Move to list' })}
					icon='arrow-forward'
					items={moveItems}
					disabled={busy || moveItems.length === 0}
					placement='bottom-start'
				/>
			</Box>

			<Button small nude disabled={busy} onClick={onClearSelection} title={t('Clear_selection', { defaultValue: 'Clear selection' })}>
				<Icon name='cross' size='x16' />
			</Button>
		</Box>
	);
};

export default BulkActionBar;
