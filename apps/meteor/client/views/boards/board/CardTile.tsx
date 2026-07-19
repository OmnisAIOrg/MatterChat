import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, IBoardLabelDef, ICardCover, Serialized } from '@rocket.chat/core-typings';
import { Box, CheckBox, Icon, Tag } from '@rocket.chat/fuselage';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useMemo } from 'react';

import { getCardTypeIcon } from '../lib/icons';
import { LEDGER_CAPTION_STYLE, LEDGER_CARD, solHeatColor } from '../lib/ledger';

type CardTileProps = {
	card: Serialized<IBoardCard>;
	labelDefs?: IBoardLabelDef[];
	onOpen: (cardId: string) => void;
	// Multi-select: when `onToggleSelect` is provided the tile shows a selection checkbox.
	// `selected` reflects the current state; `event` is forwarded so the board can honour
	// shift-click range selection.
	selected?: boolean;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
};

const isOverdue = (dueDate: Date | string | undefined, dueComplete: boolean | undefined): boolean => {
	if (!dueDate || dueComplete) {
		return false;
	}
	return new Date(dueDate).getTime() < Date.now();
};

const formatDue = (dueDate: Date | string): string => {
	const d = new Date(dueDate);
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Resolve a cover image URL from an image-/attachment-kind cover. Color covers are
// rendered as a strip instead. LitBox attachments need a signed URL we don't have on
// the tile, so they fall through to no-image (the card still renders cleanly).
const resolveCoverImage = (cover: ICardCover, attachments: Serialized<IBoardCard>['attachments']): string | undefined => {
	if (cover.kind === 'image') {
		return cover.value;
	}
	if (cover.kind === 'attachment') {
		const att = attachments?.find((a) => a.id === cover.value);
		if (!att) {
			return undefined;
		}
		if (att.source === 'url') {
			return att.ref;
		}
		if (att.source === 'local') {
			return `/file-upload/${att.ref}`;
		}
	}
	return undefined;
};

// Ledger heat input: a matter card's snapshot SOL date, if any. Module-scope so the
// branching stays out of the component's cyclomatic complexity. (Endpoint data is
// JSON-serialized, so the snapshot's solDate arrives as an ISO string.)
const matterSolDate = (card: Serialized<IBoardCard>): string | Date | undefined =>
	card.link?.kind === 'matter' ? (card.link.snapshot?.solDate as string | Date | undefined) : undefined;

const CardTile = ({ card, labelDefs, onOpen, selected, onToggleSelect }: CardTileProps) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: card._id,
		data: { type: 'card', listId: card.listId },
	});

	const selectable = Boolean(onToggleSelect);

	// Ledger-dense: paper card face + a 3px LEFT heat rule — SOL green/amber/red on
	// matter cards with a snapshot solDate, khaki otherwise (matches My Day / the panel).
	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
		overflow: 'hidden',
		backgroundColor: LEDGER_CARD,
		borderInlineStart: `3px solid ${solHeatColor(matterSolDate(card))}`,
		...(selected ? { boxShadow: '0 0 0 2px var(--rcx-color-stroke-highlight, #1d74f5)' } : {}),
	};

	// The checkbox lives outside the drag listeners: it must not start a drag and must not
	// open the card. We stop propagation and forward the native event (for shift-click range).
	const handleToggle = (e: MouseEvent) => {
		e.stopPropagation();
		onToggleSelect?.(card._id, e);
	};

	const overdue = isOverdue(card.dueDate, card.dueComplete);

	// Resolve label ids -> defs (name + color) via the board's label dictionary.
	const labelMap = useMemo(() => new Map((labelDefs ?? []).map((l) => [l.id, l] as const)), [labelDefs]);
	const cardLabels = useMemo(
		() => card.labels.map((id) => labelMap.get(id)).filter((l): l is IBoardLabelDef => Boolean(l)),
		[card.labels, labelMap],
	);

	const { cover } = card;
	const coverImage = cover ? resolveCoverImage(cover, card.attachments ?? []) : undefined;

	// Guard required arrays: CasePro-synced cards seeded before these fields existed lack them in
	// Mongo, and the type declares them required — so an unguarded read crashes the whole board.
	const doneCount = (card.checklists ?? []).reduce((sum, cl) => sum + (cl.items ?? []).filter((i) => i.done).length, 0);
	const totalCount = (card.checklists ?? []).reduce((sum, cl) => sum + (cl.items ?? []).length, 0);
	const childCount = (card.relations ?? []).filter((r) => r.type === 'child').length;
	const loggedMinutes = (card.timeEntries ?? []).reduce((sum, e) => sum + e.minutes, 0);

	const hasMeta =
		Boolean(card.dueDate) ||
		totalCount > 0 ||
		childCount > 0 ||
		loggedMinutes > 0 ||
		Boolean(card.timeEstimateMinutes) ||
		card.assignees.length > 0 ||
		Boolean(card.cardNumber);

	return (
		<Box
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			role='button'
			tabIndex={0}
			aria-label={card.title}
			onClick={() => onOpen(card._id)}
			onKeyDown={(e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					onOpen(card._id);
				}
			}}
			mbe={6}
			bg='light'
			borderRadius='x4'
			borderWidth='default'
			borderColor='extra-light'
			className='rcx-boards-card-tile'
		>
			{cover?.kind === 'color' && <Box style={{ height: 8, backgroundColor: cover.value }} />}
			{coverImage && (
				<Box style={{ height: 40, backgroundImage: `url(${coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
			)}

			{/* Denser card body (founder demand: less chrome, more cards in view). */}
			<Box pi={10} pbs={6} pbe={6}>
				{cardLabels.length > 0 && (
					<Box display='flex' alignItems='center' flexWrap='wrap' mbe={6} style={{ gap: '4px' }}>
						{/* Compact: show up to 3 chips (named -> pill, unnamed -> dot), then a +N overflow tag. */}
						{cardLabels.slice(0, 3).map((l) =>
							l.name ? (
								<Box
									key={l.id}
									fontScale='micro'
									withTruncatedText
									style={{ backgroundColor: l.color, color: '#ffffff', borderRadius: '4px', padding: '1px 7px', maxWidth: '120px' }}
								>
									{l.name}
								</Box>
							) : (
								<Box key={l.id} width='x12' height='x12' borderRadius='full' style={{ backgroundColor: l.color }} />
							),
						)}
						{cardLabels.length > 3 && (
							<Box fontScale='micro' color='hint'>
								+{cardLabels.length - 3}
							</Box>
						)}
					</Box>
				)}

				<Box display='flex' alignItems='center' mbe={hasMeta ? 4 : 0}>
					{selectable && (
						<CheckBox
							checked={Boolean(selected)}
							mie={6}
							aria-label={card.title}
							// CheckBox sits inside the draggable tile; keep pointer/keyboard events from
							// reaching the drag listeners or the tile's open-on-click handler.
							onPointerDown={(e: MouseEvent) => e.stopPropagation()}
							onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
							onClick={handleToggle}
							onChange={() => undefined}
						/>
					)}
					<Icon name={getCardTypeIcon(card.cardType)} size='x16' mie={4} color='hint' />
					{/* Matter cards carry the serif "case caption" title; other card types stay sans. */}
					<Box
						fontScale='p2'
						color='default'
						withTruncatedText
						flexGrow={1}
						style={card.cardType === 'matter' ? LEDGER_CAPTION_STYLE : undefined}
					>
						{card.title}
					</Box>
				</Box>

				{hasMeta && (
					<Box display='flex' alignItems='center' flexWrap='wrap' style={{ gap: '4px' }}>
						{card.dueDate && (
							<Tag variant={overdue ? 'danger' : undefined}>
								<Icon name='clock' size='x12' mie={2} />
								{formatDue(card.dueDate)}
							</Tag>
						)}
						{totalCount > 0 && (
							<Tag>
								<Icon name='circle-check' size='x12' mie={2} />
								{doneCount}/{totalCount}
							</Tag>
						)}
						{childCount > 0 && (
							<Tag>
								<Icon name='squares' size='x12' mie={2} />
								{childCount}
							</Tag>
						)}
						{(loggedMinutes > 0 || Boolean(card.timeEstimateMinutes)) && (
							<Tag>
								<Icon name='clock' size='x12' mie={2} />
								{Math.round((loggedMinutes / 60) * 10) / 10}h
								{card.timeEstimateMinutes ? `/${Math.round((card.timeEstimateMinutes / 60) * 10) / 10}h` : ''}
							</Tag>
						)}
						{card.assignees.length > 0 && (
							<Tag>
								<Icon name='user' size='x12' mie={2} />
								{card.assignees.length}
							</Tag>
						)}
						{card.cardNumber ? (
							<Box fontScale='micro' color='hint' mis={4}>
								#{card.cardNumber}
							</Box>
						) : null}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default CardTile;
