import type { IBoard, IBoardLabelDef, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, CheckBox, IconButton, TextInput, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_ACCENT_SWATCHES } from '../lib/boardSwatches';

/**
 * CardLabelsControl — the card-detail surface for viewing and managing a card's labels.
 *
 * Rendered inside card/CardDetail (detail tab). It shows the card's current labels as
 * colored chips, plus an expandable manager that:
 *   - lists the board's `labelDefs` with a per-label checkbox toggling membership on this
 *     card via `POST /v1/boards.card.labels.set { cardId, labelIds }` (wholesale replace),
 *   - lets the user edit a label's name (`boards.label.update`) or delete it
 *     (`boards.label.delete`),
 *   - lets the user create a new board label (name + a swatch color) via
 *     `boards.label.create`.
 *
 * The board's labelDefs live on the board-info query (`['boards','info',boardId]`, owned by
 * BoardRouter), so we read them from that same cache via useQuery (a cache hit — no extra
 * fetch). Label colors are raw CSS color strings, exactly like list.color / card.cover /
 * board.background elsewhere in the boards UI, rendered via style={{ backgroundColor }}.
 *
 * On every successful write we invalidate the card query (so chips here + the card detail
 * refresh), the board cards query (so the kanban CardTile chips refresh), and the board-info
 * query (so labelDefs reflect a create/edit/delete). Mirrors BoardStatusControl /
 * CardButtonsRow (useEndpoint + useMutation + query invalidation).
 */

// Curated swatch palette for new labels — the shared brand-derived accent set
// (lib/boardSwatches.ts), so labels and list accents share one visual vocabulary.
export const LABEL_COLOR_SWATCHES: { id: string; value: string }[] = BOARD_ACCENT_SWATCHES;

type CardLabelsControlProps = {
	boardId: string;
	cardId: string;
	// the card's current label ids (into board.labelDefs)
	cardLabelIds: string[];
};

// A single label chip — colored pill with the label name, or a bare dot when unnamed.
const LabelChip = ({ label }: { label: IBoardLabelDef }): ReactElement =>
	label.name ? (
		<Box fontScale='micro' style={{ backgroundColor: label.color, color: '#ffffff', borderRadius: '4px', padding: '1px 7px' }}>
			{label.name}
		</Box>
	) : (
		<Box width='x16' height='x16' borderRadius='x4' style={{ backgroundColor: label.color }} />
	);

const CardLabelsControl = ({ boardId, cardId, cardLabelIds }: CardLabelsControlProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getBoardInfo = useEndpoint('GET', '/v1/boards.info');
	const setCardLabels = useEndpoint('POST', '/v1/boards.card.labels.set');
	const labelCreate = useEndpoint('POST', '/v1/boards.label.create');
	const labelUpdate = useEndpoint('POST', '/v1/boards.label.update');
	const labelDelete = useEndpoint('POST', '/v1/boards.label.delete');

	const [expanded, setExpanded] = useState(false);
	const [newName, setNewName] = useState('');
	const [newColor, setNewColor] = useState(LABEL_COLOR_SWATCHES[0].value);
	// id of the label currently being renamed inline (null = none)
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState('');

	// labelDefs come from the board-info cache (BoardRouter's query key) — a cache hit.
	const { data: boardInfo, isLoading } = useQuery({
		queryKey: ['boards', 'info', boardId],
		queryFn: () => getBoardInfo({ boardId }),
		enabled: Boolean(boardId),
	});

	const labelDefs = useMemo<Serialized<IBoard>['labelDefs']>(() => boardInfo?.board.labelDefs ?? [], [boardInfo]);
	const labelMap = useMemo(() => new Map(labelDefs.map((l) => [l.id, l] as const)), [labelDefs]);

	// the card's current labels, resolved to defs (skips dangling ids)
	const cardLabels = useMemo(
		() => cardLabelIds.map((id) => labelMap.get(id)).filter((l): l is IBoardLabelDef => Boolean(l)),
		[cardLabelIds, labelMap],
	);
	const selected = useMemo(() => new Set(cardLabelIds), [cardLabelIds]);

	// shared post-write refresh: card detail + kanban tiles + board-info (labelDefs)
	const invalidateAll = (): void => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'info', boardId] });
	};

	const setMutation = useMutation({
		mutationFn: (labelIds: string[]) => setCardLabels({ cardId, labelIds }),
		onSuccess: invalidateAll,
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const createMutation = useMutation({
		mutationFn: ({ name, color }: { name: string; color: string }) => labelCreate({ boardId, name, color }),
		onSuccess: () => {
			setNewName('');
			invalidateAll();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const updateMutation = useMutation({
		mutationFn: ({ labelId, patch }: { labelId: string; patch: { name?: string; color?: string } }) =>
			labelUpdate({ boardId, labelId, patch }),
		onSuccess: () => {
			setEditingId(null);
			invalidateAll();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const deleteMutation = useMutation({
		mutationFn: (labelId: string) => labelDelete({ boardId, labelId }),
		onSuccess: invalidateAll,
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const anyPending = setMutation.isPending || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

	// toggle a label on/off this card (wholesale replace of the id list)
	const toggleLabel = (labelId: string): void => {
		const next = new Set(cardLabelIds);
		if (next.has(labelId)) {
			next.delete(labelId);
		} else {
			next.add(labelId);
		}
		setMutation.mutate(Array.from(next));
	};

	const startEdit = (label: IBoardLabelDef): void => {
		setEditingId(label.id);
		setEditingName(label.name);
	};

	const handleCreate = (): void => {
		const name = newName.trim();
		if (!name) {
			return;
		}
		createMutation.mutate({ name, color: newColor });
	};

	return (
		<Box mbs={16}>
			<Box display='flex' alignItems='center' mbe={8}>
				<Box fontScale='p2b' color='default' flexGrow={1}>
					{t('Boards_Labels', { defaultValue: 'Labels' })}
				</Box>
				<Button small onClick={() => setExpanded((v) => !v)}>
					{expanded ? t('Done') : t('Edit')}
				</Button>
			</Box>

			{/* Current labels as chips (read-only summary). */}
			{cardLabels.length > 0 ? (
				<Box display='flex' flexWrap='wrap' style={{ gap: '4px' }}>
					{cardLabels.map((l) => (
						<LabelChip key={l.id} label={l} />
					))}
				</Box>
			) : (
				<Box fontScale='c1' color='hint'>
					{t('Boards_Labels_None', { defaultValue: 'No labels' })}
				</Box>
			)}

			{expanded && (
				<Box mbs={12} pb={12} pi={12} bg='tint' borderRadius='x4'>
					{isLoading ? (
						<Box display='flex' justifyContent='center' p={8}>
							<Throbber size='x12' />
						</Box>
					) : (
						<>
							{/* Toggle / edit / delete each board label. */}
							{labelDefs.length === 0 && (
								<Box fontScale='c1' color='hint' mbe={8}>
									{t('Boards_Labels_Empty', { defaultValue: 'No labels yet — create one below.' })}
								</Box>
							)}
							{labelDefs.map((label) => (
								<Box key={label.id} display='flex' alignItems='center' mbe={6} style={{ gap: '6px' }}>
									<CheckBox
										checked={selected.has(label.id)}
										disabled={anyPending}
										aria-label={label.name || label.id}
										onChange={() => toggleLabel(label.id)}
									/>
									<Box width='x16' height='x16' borderRadius='x4' flexShrink={0} style={{ backgroundColor: label.color }} />
									{editingId === label.id ? (
										<>
											<TextInput
												value={editingName}
												onChange={(e) => setEditingName((e.target as HTMLInputElement).value)}
												placeholder={t('Name')}
											/>
											<IconButton
												icon='check'
												small
												disabled={anyPending || !editingName.trim()}
												title={t('Save')}
												onClick={() => updateMutation.mutate({ labelId: label.id, patch: { name: editingName.trim() } })}
											/>
											<IconButton icon='cross' small title={t('Cancel')} onClick={() => setEditingId(null)} />
										</>
									) : (
										<>
											<Box fontScale='p2' color='default' flexGrow={1} withTruncatedText>
												{label.name || t('Boards_Label_Unnamed', { defaultValue: '(unnamed)' })}
											</Box>
											<IconButton icon='edit' small disabled={anyPending} title={t('Edit')} onClick={() => startEdit(label)} />
											<IconButton
												icon='trash'
												small
												disabled={anyPending}
												title={t('Delete')}
												onClick={() => deleteMutation.mutate(label.id)}
											/>
										</>
									)}
								</Box>
							))}

							{/* Create a new board label: name + swatch picker. */}
							<Box mbs={12} pbs={12} style={{ borderTop: '1px solid var(--rcx-color-stroke-extra-light, #eee)' }}>
								<Box fontScale='c1' color='hint' mbe={4}>
									{t('Boards_Label_New', { defaultValue: 'New label' })}
								</Box>
								<Box display='flex' alignItems='center' style={{ gap: '6px' }} mbe={6}>
									<TextInput value={newName} placeholder={t('Name')} onChange={(e) => setNewName((e.target as HTMLInputElement).value)} />
									<Button small primary disabled={anyPending || !newName.trim()} onClick={handleCreate}>
										{t('Create')}
									</Button>
								</Box>
								<Box display='flex' flexWrap='wrap' style={{ gap: '4px' }}>
									{LABEL_COLOR_SWATCHES.map((s) => (
										<Box
											key={s.id}
											role='button'
											tabIndex={0}
											aria-label={s.id}
											width='x20'
											height='x20'
											borderRadius='x4'
											onClick={() => setNewColor(s.value)}
											style={{
												backgroundColor: s.value,
												cursor: 'pointer',
												// selected ring in the ledger accent green (not the stock RC blue highlight)
												boxShadow: newColor === s.value ? '0 0 0 2px var(--mc-ledger-accent, #15692A)' : 'none',
											}}
										/>
									))}
								</Box>
							</Box>
						</>
					)}
				</Box>
			)}
		</Box>
	);
};

export default CardLabelsControl;
