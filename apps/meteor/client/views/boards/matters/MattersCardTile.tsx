import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, IBoardLabelDef, Serialized } from '@rocket.chat/core-typings';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useMemo } from 'react';

/**
 * MattersCardTile — Premium-refresh card component for the Matters kanban board.
 *
 * Extends the generic CardTile with:
 * - Checkbox with visual state (green border + bg when selected)
 * - Name + type layout
 * - Mono ID tag
 * - SOL progress bar (red when <35%)
 * - Avatar stack (team members)
 * - Quick action icons (appear on hover: assign, open, more)
 * - Stage pills (color-coded: intake/review/investigation/settled)
 *
 * Uses premium-refresh CSS variables from MattersPremiumRefreshStyles.tsx.
 */

type MattersCardTileProps = {
	card: Serialized<IBoardCard>;
	labelDefs?: IBoardLabelDef[];
	onOpen: (cardId: string) => void;
	selected?: boolean;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
	stagePill?: string; // e.g., "intake", "initial-review", "investigation", "settled"
	teamInitials?: string[]; // Array of 1-2 letter initials for avatars
	solPercentage?: number; // 0-100
	solLabel?: string; // e.g., "24 MO", "18 MO"
	onAssign?: () => void;
	onOpenDetail?: () => void;
	onMore?: () => void;
};

const MattersCardTile = ({
	card,
	labelDefs,
	onOpen,
	selected,
	onToggleSelect,
	stagePill = 'intake',
	teamInitials = [],
	solPercentage = 75,
	solLabel = '24 MO',
	onAssign,
	onOpenDetail,
	onMore,
}: MattersCardTileProps) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: card._id,
		data: { type: 'card', listId: card.listId },
	});

	const selectable = Boolean(onToggleSelect);

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	const handleToggle = (e: MouseEvent) => {
		e.stopPropagation();
		onToggleSelect?.(card._id, e as any);
	};

	const handleCheckboxClick = (e: React.MouseEvent<HTMLLabelElement>) => {
		e.stopPropagation();
		handleToggle(e as any);
	};

	// Determine if SOL is low risk (red fill)
	const isLowSol = solPercentage < 35;

	// Resolve label ids -> defs. `card.labels` is OPTIONAL on IBoardCard and is undefined on
	// CasePro-synced matter cards (they carry no labels array) — guard it, or the whole matters
	// board crashes with "Cannot read properties of undefined (reading 'map')" the moment a real
	// matter renders (P0 regression, wave 3).
	const labelMap = useMemo(() => new Map((labelDefs ?? []).map((l) => [l.id, l] as const)), [labelDefs]);
	const cardLabels = useMemo(
		() => (card.labels ?? []).map((id) => labelMap.get(id)).filter((l): l is IBoardLabelDef => Boolean(l)),
		[card.labels, labelMap],
	);

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			className={`mc-matters-card-tile${selected ? ' selected' : ''}`}
			role='button'
			tabIndex={0}
			aria-label={card.title}
			onClick={() => onOpen(card._id)}
			onKeyDown={(e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					onOpen(card._id);
				}
			}}
		>
			{/* Card Header: Checkbox, Name, Type, ID */}
			<div className='mc-matters-card-header'>
				{selectable && (
					<label
						className={`mc-matters-card-checkbox${selected ? ' checked' : ''}`}
						onClick={handleCheckboxClick}
						role='checkbox'
						aria-checked={selected}
					>
						{selected && (
							<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3.2' strokeLinecap='round' strokeLinejoin='round'>
								<path d='m5 12.5 4.5 4.5L19 7.5' />
							</svg>
						)}
					</label>
				)}
				<div style={{ flex: 1, minWidth: 0 }}>
					<div className='mc-matters-card-name'>{card.title}</div>
					<div className='mc-matters-card-type'>{card.cardType || 'Motor Vehicle Accident'}</div>
				</div>
				<span className='mc-matters-card-id'>#{card.cardNumber || card._id.substring(0, 5)}</span>
			</div>

			{/* SOL Progress Bar */}
			<div className='mc-matters-sol-bar'>
				<div className='mc-matters-sol-track'>
					<div className={`mc-matters-sol-fill${isLowSol ? ' low' : ''}`} style={{ width: `${solPercentage}%` }} />
				</div>
				<span className='mc-matters-sol-label'>{solLabel}</span>
			</div>

			{/* Avatar Stack and Quick Actions */}
			<div className='mc-matters-card-footer'>
				<div className='mc-matters-avatar-stack'>
					{teamInitials.slice(0, 3).map((initials, idx) => (
						<div key={idx} className='mc-matters-avatar'>
							{initials}
						</div>
					))}
				</div>
				<div className='mc-matters-card-actions'>
					<div className='mc-matters-quick-actions'>
						<button
							className='mc-matters-quick-action-btn'
							title='Assign'
							onClick={(e) => {
								e.stopPropagation();
								onAssign?.();
							}}
						>
							<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round'>
								<circle cx='10' cy='8' r='3.5' />
								<path d='M4 19.5c.6-3.2 3-4.8 6-4.8s5.4 1.6 6 4.8M18 6v5M15.5 8.5h5' />
							</svg>
						</button>
						<button
							className='mc-matters-quick-action-btn'
							title='Open'
							onClick={(e) => {
								e.stopPropagation();
								onOpenDetail?.();
							}}
						>
							<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
								<path d='M14 4h6v6M20 4 11 13M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3' />
							</svg>
						</button>
						<button
							className='mc-matters-quick-action-btn'
							title='More'
							onClick={(e) => {
								e.stopPropagation();
								onMore?.();
							}}
						>
							<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
								<circle cx='5.5' cy='12' r='1' />
								<circle cx='12' cy='12' r='1' />
								<circle cx='18.5' cy='12' r='1' />
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default MattersCardTile;
