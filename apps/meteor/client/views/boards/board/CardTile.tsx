import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon, Tag } from '@rocket.chat/fuselage';
import type { KeyboardEvent } from 'react';

import { getCardTypeIcon } from '../lib/icons';

type CardTileProps = {
	card: Serialized<IBoardCard>;
	onOpen: (cardId: string) => void;
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

const CardTile = ({ card, onOpen }: CardTileProps) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: card._id,
		data: { type: 'card', listId: card.listId },
	});

	const style = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	const overdue = isOverdue(card.dueDate, card.dueComplete);

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
			mbe={8}
			pi={12}
			pb={8}
			bg='light'
			borderRadius='x4'
			borderWidth='default'
			borderColor='extra-light'
			className='rcx-boards-card-tile'
		>
			<Box display='flex' alignItems='center' mbe={4}>
				<Icon name={getCardTypeIcon(card.cardType)} size='x16' mie={4} color='hint' />
				<Box fontScale='p2' color='default' withTruncatedText flexGrow={1}>
					{card.title}
				</Box>
			</Box>

			{(card.labels.length > 0 || card.dueDate || card.checklists.length > 0) && (
				<Box display='flex' alignItems='center' flexWrap='wrap' style={{ gap: '4px' }}>
					{card.dueDate && (
						<Tag variant={overdue ? 'danger' : undefined}>
							<Icon name='clock' size='x12' mie={2} />
							{formatDue(card.dueDate)}
						</Tag>
					)}
					{card.checklists.length > 0 && (
						<Tag>
							<Icon name='circle-check' size='x12' mie={2} />
							{card.checklists.reduce((sum, cl) => sum + cl.items.filter((i) => i.done).length, 0)}/
							{card.checklists.reduce((sum, cl) => sum + cl.items.length, 0)}
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
	);
};

export default CardTile;
