import type { IBoardCard, IChecklist, IChecklistItem, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, CheckBox, IconButton, TextInput, Throbber, Popover, Backdrop } from '@rocket.chat/fuselage';
import { useEndpoint, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent, ReactElement } from 'react';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { LedgerProgress, ledgerHead, ledgerRule, tabularFigures, useLedgerTone } from './ledgerStyles';

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
	const tone = useLedgerTone();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const router = useRouter();

	const [newTitle, setNewTitle] = useState('');
	const [showChecklistConversion, setShowChecklistConversion] = useState(false);
	const conversionButtonRef = useRef<HTMLButtonElement>(null);

	const getCard = useEndpoint('GET', '/v1/boards.card');
	const cardCreate = useMethod('boards.cardCreate');
	const cardArchive = useEndpoint('POST', '/v1/boards.card.archive');
	const relationsAdd = useEndpoint('POST', '/v1/boards.card.relations.add');
	const relationsRemove = useEndpoint('POST', '/v1/boards.card.relations.remove');
	const cardComplete = useEndpoint('POST', '/v1/boards.card.complete');
	const convertChecklistItemToSubtask = useEndpoint('POST', '/v1/boards.subtasks.convertFromChecklist');

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

	// Check nesting depth: count ancestors to enforce max 3-level nesting (wave3 Subtasks v2 limit)
	const getNestingDepth = async (currentCardId: string): Promise<number> => {
		let depth = 0;
		let cursor = currentCardId;
		const visited = new Set([currentCardId]); // Prevent infinite loops

		while (true) {
			const current = await getCard({ cardId: cursor });
			if (!current?.card) break;

			const parent = current.card.relations?.find((r) => r.type === 'parent');
			if (!parent) break;

			depth++;
			cursor = parent.cardId;

			// Safety: break if we've gone too deep or seen this card before
			if (depth >= 3 || visited.has(cursor)) break;
			visited.add(cursor);
		}

		return depth;
	};

	const addMutation = useMutation({
		mutationFn: async (title: string) => {
			// Validate we're not exceeding 3-level nesting
			const depth = await getNestingDepth(cardId);
			if (depth >= 2) {
				// depth 0 = root, depth 1 = immediate child, depth 2 = grandchild
				// So if depth >= 2, we're already at grandchild level and can't add more
				throw new Error(t('Boards_Subtask_Nesting_Level_3', { defaultValue: 'Maximum nesting level (3) reached' }));
			}

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

	const convertChecklistMutation = useMutation({
		mutationFn: (params: { checklistId: string; itemId: string }) =>
			convertChecklistItemToSubtask({
				boardId,
				cardId,
				checklistId: params.checklistId,
				itemId: params.itemId,
			}),
		onSuccess: () => {
			setShowChecklistConversion(false);
			invalidate();
		},
		onError,
	});

	const busy = addMutation.isPending || toggleMutation.isPending || unlinkMutation.isPending || convertChecklistMutation.isPending;

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
		<Box marginBlockStart={12}>
			{/* Compact small-caps section head + tabular counter over a khaki rule. */}
			<Box
				display='flex'
				alignItems='center'
				justifyContent='space-between'
				marginBlockEnd={6}
				paddingBlockEnd={2}
				style={ledgerRule(tone)}
			>
				<Box style={ledgerHead(tone)}>{t('Boards_Subtasks', { defaultValue: 'Subtasks' })}</Box>
				{total > 0 && (
					<Box fontScale='c1' color='hint' style={tabularFigures}>
						{done}/{total}
					</Box>
				)}
			</Box>

			{total > 0 && (
				<Box marginBlockEnd={6}>
					<LedgerProgress percent={percent} tone={tone} />
				</Box>
			)}

			{isLoading && children.length === 0 && childIds.length > 0 && (
				<Box display='flex' justifyContent='center' paddingBlock={8}>
					<Throbber size='x12' />
				</Box>
			)}

			{children.map((child) => (
				<Box key={child._id} display='flex' alignItems='center' marginBlockEnd={2} paddingBlockEnd={2} style={ledgerRule(tone)}>
					<CheckBox
						checked={Boolean(child.completed)}
						disabled={busy}
						marginInlineEnd={8}
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

			<Box display='flex' alignItems='center' marginBlockStart={8}>
				<TextInput
					value={newTitle}
					placeholder={t('Boards_Add_Subtask', { defaultValue: 'Add a subtask' })}
					disabled={addMutation.isPending}
					onChange={(e) => setNewTitle((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
				/>
				<Button small primary marginInlineStart={8} disabled={!newTitle.trim() || addMutation.isPending} onClick={handleAdd}>
					{addMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Add')}
				</Button>
			</Box>

			{/* Convert checklist items to subtasks (Subtasks v2 feature) */}
			{(card.checklists?.length ?? 0) > 0 && (
				<Box mts={12}>
					<Button
						ref={conversionButtonRef}
						small
						ghost
						onClick={() => setShowChecklistConversion(!showChecklistConversion)}
						disabled={busy}
					>
						{t('Boards_Subtask_Convert_From_Checklist', { defaultValue: 'Convert checklist items' })}
					</Button>
					{showChecklistConversion && (
						<Box mts={8} padding={8} borderRadius='x4' style={{ backgroundColor: tone.card, boxShadow: `inset 0 0 0 1px ${tone.rule}` }}>
							{card.checklists?.map((checklist: IChecklist) => (
								<Box key={checklist.id} marginBlockEnd={8}>
									<Box fontScale='c1' color='hint' marginBlockEnd={4} style={tabularFigures}>
										{checklist.title}
									</Box>
									{checklist.items.length === 0 ? (
										<Box fontScale='p2' color='hint' paddingInlineStart={8}>
											{t('No_results_found')}
										</Box>
									) : (
										checklist.items.map((item: IChecklistItem) => (
											<Box key={item.id} display='flex' alignItems='center' marginBlockEnd={4} paddingInlineStart={8}>
												<Box flexGrow={1} fontScale='p2'>
													{item.text}
												</Box>
												<Button
													small
													ghost
													icon='arrow-up'
													disabled={busy}
													onClick={() =>
														convertChecklistMutation.mutate({
															checklistId: checklist.id,
															itemId: item.id,
														})
													}
													title={t('Boards_Subtask_Convert_From_Checklist', { defaultValue: 'Convert to subtask' })}
												/>
											</Box>
										))
									)}
								</Box>
							))}
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
};

export default SubtasksPanel;
