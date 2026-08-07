import type { IChecklist, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, CheckBox, IconButton, TextInput, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LedgerProgress, ledgerHead, ledgerRule, tabularFigures, useLedgerTone } from './ledgerStyles';

/**
 * ChecklistPanel — the interactive checklist section on the card detail view.
 *
 * Renders each of the card's checklists as a Fuselage CheckBox + text list with a
 * per-checklist progress indicator ("{done}/{total}" + a ProgressBar). Each item can be
 * toggled (`POST /v1/boards.card.checklist.toggle` — `done` omitted to flip) or removed
 * (`POST /v1/boards.card.checklist.remove`). A single add-item input (Enter or the Add
 * button → `POST /v1/boards.card.checklist.add`) appends to the card's default checklist;
 * when the card has no checklist yet the server auto-creates one on the first add.
 *
 * Mirrors the `useEndpoint` + `useMutation` + query-invalidation idiom used by
 * BulkActionBar / ListColorMenu. On every successful mutation it invalidates the same
 * card/cards/activities query keys CardDetail's own saveMutation uses, so the panel (and
 * the board tile's checklist badge) re-render with fresh state.
 */

type ChecklistPanelProps = {
	boardId: string;
	cardId: string;
	checklists: Serialized<IChecklist>[];
};

const ChecklistPanel = ({ boardId, cardId, checklists }: ChecklistPanelProps): ReactElement => {
	const { t } = useTranslation();
	const tone = useLedgerTone();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const [newItemText, setNewItemText] = useState('');

	const addItem = useEndpoint('POST', '/v1/boards.card.checklist.add');
	const toggleItem = useEndpoint('POST', '/v1/boards.card.checklist.toggle');
	const removeItem = useEndpoint('POST', '/v1/boards.card.checklist.remove');

	// All three mutations return the updated `{ card }`; we refetch rather than read it so the
	// panel stays a thin view over the same query CardDetail owns.
	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
	};

	const onError = (error: unknown): void => dispatchToastMessage({ type: 'error', message: error });

	const addMutation = useMutation({
		mutationFn: (text: string) => addItem({ cardId, text }),
		onSuccess: () => {
			setNewItemText('');
			invalidate();
		},
		onError,
	});

	const toggleMutation = useMutation({
		// `done` omitted → server flips the item's current state.
		mutationFn: (itemId: string) => toggleItem({ cardId, itemId }),
		onSuccess: invalidate,
		onError,
	});

	const removeMutation = useMutation({
		mutationFn: (itemId: string) => removeItem({ cardId, itemId }),
		onSuccess: invalidate,
		onError,
	});

	const busy = addMutation.isPending || toggleMutation.isPending || removeMutation.isPending;

	const handleAdd = (): void => {
		const text = newItemText.trim();
		if (!text || addMutation.isPending) {
			return;
		}
		addMutation.mutate(text);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleAdd();
		}
	};

	return (
		<Box marginBlockStart={12}>
			{/* Compact small-caps section head over a khaki rule (ledger-dense chrome). */}
			<Box marginBlockEnd={6} paddingBlockEnd={2} style={{ ...ledgerHead(tone), ...ledgerRule(tone) }}>
				{t('Boards_Checklist', { defaultValue: 'Checklist' })}
			</Box>

			{checklists.map((checklist) => {
				const total = checklist.items.length;
				const done = checklist.items.filter((item) => item.done).length;
				const percent = total > 0 ? Math.round((done / total) * 100) : 0;

				return (
					<Box key={checklist.id} marginBlockEnd={10}>
						<Box display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={4}>
							<Box fontScale='c1' color='hint'>
								{checklist.title}
							</Box>
							<Box fontScale='c1' color='hint' marginInlineStart={8} style={tabularFigures}>
								{done}/{total}
							</Box>
						</Box>

						{total > 0 && (
							<Box marginBlockEnd={6}>
								<LedgerProgress percent={percent} tone={tone} />
							</Box>
						)}

						{checklist.items.map((item) => (
							<Box key={item.id} display='flex' alignItems='center' marginBlockEnd={2} paddingBlockEnd={2} style={ledgerRule(tone)}>
								<CheckBox
									checked={item.done}
									disabled={busy}
									marginInlineEnd={8}
									aria-label={item.text}
									onChange={() => toggleMutation.mutate(item.id)}
								/>
								<Box
									fontScale='p2'
									color={item.done ? 'hint' : 'default'}
									flexGrow={1}
									withTruncatedText
									style={item.done ? { textDecoration: 'line-through' } : undefined}
								>
									{item.text}
								</Box>
								<IconButton tiny icon='trash' disabled={busy} aria-label={t('Remove')} onClick={() => removeMutation.mutate(item.id)} />
							</Box>
						))}
					</Box>
				);
			})}

			<Box display='flex' alignItems='center' marginBlockStart={8}>
				<TextInput
					value={newItemText}
					placeholder={t('Boards_Checklist_Add_Item', { defaultValue: 'Add an item' })}
					disabled={addMutation.isPending}
					onChange={(e) => setNewItemText((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
				/>
				<Button small primary marginInlineStart={8} disabled={!newItemText.trim() || addMutation.isPending} onClick={handleAdd}>
					{addMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Add')}
				</Button>
			</Box>
		</Box>
	);
};

export default ChecklistPanel;
