import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, IBoardLabelDef, ICardCover, Serialized } from '@rocket.chat/core-typings';
import { Box, CheckBox, Icon } from '@rocket.chat/fuselage';
import { useThemeMode } from '@rocket.chat/ui-client';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useMemo } from 'react';

import { getCardTypeIcon } from '../lib/icons';
import { getLeadsTokens, LEADS_CARD_TITLE_STYLE, LEADS_RADIUS } from './leadsDesignTokens';

type LeadsCardTileProps = {
	card: Serialized<IBoardCard>;
	labelDefs?: IBoardLabelDef[];
	onOpen: (cardId: string) => void;
	selected?: boolean;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
};

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

const LeadsCardTile = ({ card, labelDefs, onOpen, selected, onToggleSelect }: LeadsCardTileProps) => {
	const [, , themeMode] = useThemeMode();
	const isDark = themeMode === 'dark';
	const tokens = getLeadsTokens(isDark);

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: card._id,
		data: { type: 'card', listId: card.listId },
	});

	const selectable = Boolean(onToggleSelect);

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
		backgroundColor: tokens.surface,
		border: `1px solid ${tokens.border}`,
		borderRadius: LEADS_RADIUS.card,
		boxShadow: tokens.shadow1,
		padding: '11px 13px',
		cursor: 'pointer',
		...(selected ? { boxShadow: `0 0 0 2px ${tokens.green}` } : {}),
	};

	const handleToggle = (e: MouseEvent) => {
		e.stopPropagation();
		onToggleSelect?.(card._id, e);
	};

	// Resolve label definitions
	const labelMap = useMemo(() => new Map((labelDefs ?? []).map((l) => [l.id, l] as const)), [labelDefs]);
	const cardLabels = useMemo(
		() => card.labels.map((id) => labelMap.get(id)).filter((l): l is IBoardLabelDef => Boolean(l)),
		[card.labels, labelMap],
	);

	const { cover } = card;
	const coverImage = cover ? resolveCoverImage(cover, card.attachments) : undefined;

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
			display='flex'
			alignItems='center'
			gap={10}
			onMouseEnter={(e) => {
				const el = e.currentTarget as HTMLElement;
				el.style.boxShadow = tokens.shadow2;
				el.style.transform = 'translateY(-1px)';
			}}
			onMouseLeave={(e) => {
				const el = e.currentTarget as HTMLElement;
				el.style.boxShadow = selected ? `0 0 0 2px ${tokens.green}` : tokens.shadow1;
				el.style.transform = 'none';
			}}
		>
			{/* Checkbox for multi-select */}
			{selectable && (
				<CheckBox
					checked={Boolean(selected)}
					aria-label={card.title}
					style={{
						width: '15px',
						height: '15px',
						borderRadius: '4.5px',
						flexShrink: 0,
						accentColor: tokens.green,
					}}
					onPointerDown={(e: MouseEvent) => e.stopPropagation()}
					onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
					onClick={handleToggle}
					onChange={() => undefined}
				/>
			)}

			{/* Card content container */}
			<Box
				display='flex'
				flexDirection='column'
				flex={1}
				minWidth={0}
				gap={4}
			>
				{/* Card title and ID row */}
				<Box
					display='flex'
					alignItems='center'
					gap={8}
					style={{
						minWidth: 0,
					}}
				>
					<Icon name={getCardTypeIcon(card.cardType)} size='x16' style={{ color: tokens.ink3, flexShrink: 0 }} />
					<Box
						style={{
							...LEADS_CARD_TITLE_STYLE,
							color: tokens.ink,
							flex: 1,
							minWidth: 0,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{card.title}
					</Box>
					<Box
						style={{
							fontFamily: "'Geist Mono', ui-monospace, monospace",
							fontSize: '10px',
							color: tokens.ink3,
							flexShrink: 0,
							whiteSpace: 'nowrap',
						}}
					>
						{card.cardNumber ? `#${card.cardNumber}` : ''}
					</Box>
				</Box>

				{/* Age/status text */}
				{card.createdAt && (
					<Box
						style={{
							fontSize: '11px',
							color: tokens.ink3,
						}}
					>
						New · 2d
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default LeadsCardTile;
