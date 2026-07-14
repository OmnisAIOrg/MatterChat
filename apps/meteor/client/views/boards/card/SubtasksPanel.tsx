import type { IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, CheckBox, IconButton, ProgressBar, TextInput, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * SubtasksPanel — nested subtasks (Asana/Trello-style) on the card detail view.
 *
 * Subtasks are ordinary child cards in the SAME board + list, linked to the parent
 * by a `child` relation (the parent stores `{type:'child', cardId}`; the service
 * mirrors `{type:'parent'}` onto the child). "Add subtask" creates a plain `task`
 * card (`boards.cardCreate`) then links it (`boards.card.relations.add`). Children
 * are resolved by fetching each child card by id (boards.cards is count-capped, so a
 * large board would drop children), keeping completion progress correct at any size.
 *
 * Generic / standalone-safe: operates only on `task` cards via the generic
 * create + relation + complete primitives — no CasePro dependency. Mirrors
 * ChecklistPanel's useEndpoint + useMutation + query-invalidation idiom.
 */

type SubtasksPanelProps = {
	boardId: string;
	cardId: string;
	card: Serialized<IBoardCard>;
};

const SubtasksPanel = ({ boardId, cardId, card }: SubtasksPanelProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const router = useRouter();

	const [newTitle, setNewTitle] = useState('');

	const getCard = useEndpoint('GET', '/v1/boards.card');
	const cardCreate = useMethod('boards.cardCreate');
	const cardArchive = useEndpoint('POST', '/v1/boards.card.archive');
	const relationsAdd = useEndpoint('POST', '/v1/boards.card.relations.add');
	const relationsRemove = useEndpoint('POST', '/v1/boards.card.relations.remove');
	const cardComplete = useEndpoint('POST', '/v1/boards.card.complete');

	// Resolve each child by id. boards.cards is capped at API_Upper_Count_Limit, so deriving
	// children from that list would silently drop them on large boards. These share the
	// ['boards','card',id] cache with CardDetail; getCardForUser returns archived cards too,
	// so this count matches the relation-edge count shown on the board tile's subtask badge.
	const childIds = (card.relations ?? []).filter((r) => r.type === 'child').map((r) => r.cardId);
	const childQueries = useQueries({
		queries: childIds.map((id) => ({ queryKey: ['boards', 'card', id], queryFn: () => getCard({ cardId: id }) })),
	});
	const children = childQueries.map((q) => q.data?.card).filter((c): c is Serialized<IBoardCard> => Boolean(c));
	const isLoading = childQueries.some((q) => q.isLoading);

	const total = children.length;
	const done = children.filter((c) => c.completed).length;
	const percent = total > 0 ? Math.round((done / total) * 100) : 0;

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
	};
	const onError = (error: unknown): void => dispatchToastMessage({ type: 'error', message: error });

	const addMutation = useMutation({
		mutationFn: async (title: string) => {
			const created = await cardCreate({ boardId: card.boardId, listId: card.listId, title });
			try {
				await relationsAdd({ cardId, type: 'child', targetCardId: created._id });
			} catch (error) {
				// Roll back the just-created card so a failed link doesn't leave an orphan on the board.
				await cardArchive({ cardId: created._id }).catch(() => undefined);
				throw error;
			}
		},
		onSuccess: () => {
			setNewTitle('');
			invalidate();
		},
		onError,
	});

	const toggleMutation = useMutation({
		mutationFn: (child: Serialized<IBoardCard>) => cardComplete({ cardId: child._id, completed: !child.completed }),
		onSuccess: (_data, child) => {
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', child._id] });
			invalidate();
		},
		onError,
	});

	const unlinkMutation = useMutation({
		mutationFn: (childId: string) => relationsRemove({ cardId, type: 'child', targetCardId: childId }),
		onSuccess: invalidate,
		onError,
	});

	const busy = addMutation.isPending || toggleMutation.isPending || unlinkMutation.isPending;

	const handleAdd = (): void => {
		const title = newTitle.trim();
		if (!title || addMutation.isPending) {
			return;
		}
		addMutation.mutate(title);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleAdd();
		}
	};

	const openChild = (childId: string): void => {
		router.navigate({ name: 'boards-board', params: { ...router.getRouteParameters(), cardId: childId } });
	};

	return (
		<Box mbs={16}>
			<Box display='flex' alignItems='center' justifyContent='space-between' mbe={8}>
				<Box fontScale='p2b' color='default'>
					{t('Boards_Subtasks', { defaultValue: 'Subtasks' })}
				</Box>
				{total > 0 && (
					<Box fontScale='c1' color='hint'>
						{done}/{total}
					</Box>
				)}
			</Box>

			{total > 0 && (
				<Box mbe={8}>
					<ProgressBar percentage={percent} />
				</Box>
			)}

			{isLoading && children.length === 0 && childIds.length > 0 && (
				<Box display='flex' justifyContent='center' pb={8}>
					<Throbber size='x12' />
				</Box>
			)}

			{children.map((child) => (
				<Box key={child._id} display='flex' alignItems='center' mbe={2}>
					<CheckBox
						checked={Boolean(child.completed)}
						disabled={busy}
						mie={8}
						aria-label={child.title}
						onChange={() => toggleMutation.mutate(child)}
					/>
					<Box
						role='button'
						tabIndex={0}
						fontScale='p2'
						color={child.completed ? 'hint' : 'default'}
						flexGrow={1}
						withTruncatedText
						style={{ cursor: 'pointer', ...(child.completed ? { textDecoration: 'line-through' } : {}) }}
						onClick={() => openChild(child._id)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								openChild(child._id);
							}
						}}
					>
						{child.title}
					</Box>
					<IconButton tiny icon='trash' disabled={busy} aria-label={t('Remove')} onClick={() => unlinkMutation.mutate(child._id)} />
				</Box>
			))}

			<Box display='flex' alignItems='center' mbs={8}>
				<TextInput
					value={newTitle}
					placeholder={t('Boards_Add_Subtask', { defaultValue: 'Add a subtask' })}
					disabled={addMutation.isPending}
					onChange={(e) => setNewTitle((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
				/>
				<Button small primary mis={8} disabled={!newTitle.trim() || addMutation.isPending} onClick={handleAdd}>
					{addMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Add')}
				</Button>
			</Box>
		</Box>
	);
};

export default SubtasksPanel;
