import { Box, Button, Icon, TextAreaInput } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type QuickAddCardProps = {
	isAdding: boolean;
	onAdd: (title: string) => Promise<void> | void;
};

const QuickAddCard = ({ isAdding, onAdd }: QuickAddCardProps) => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState('');

	const submit = async (): Promise<void> => {
		const trimmed = title.trim();
		if (!trimmed) {
			return;
		}
		try {
			await onAdd(trimmed);
			setTitle('');
		} catch (error) {
			dispatchToastMessage({ type: 'error', message: error });
		}
	};

	if (!open) {
		return (
			<Button small secondary onClick={() => setOpen(true)} aria-label={t('Boards_Add_Card')} marginBlockStart={4}>
				<Icon name='plus' size='x16' marginInlineEnd={4} />
				{t('Boards_Add_Card')}
			</Button>
		);
	}

	return (
		<Box marginBlockStart={4}>
			<TextAreaInput
				rows={2}
				value={title}
				placeholder={t('Boards_Add_Card')}
				onChange={(e) => setTitle((e.target as HTMLTextAreaElement).value)}
				onKeyDown={(e: KeyboardEvent) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						void submit();
					}
					if (e.key === 'Escape') {
						setOpen(false);
						setTitle('');
					}
				}}
				autoFocus
			/>
			<Box display='flex' alignItems='center' marginBlockStart={4}>
				<Button small primary onClick={() => void submit()} disabled={isAdding || !title.trim()}>
					{t('Add')}
				</Button>
				<Button
					small
					secondary
					marginInlineStart={4}
					onClick={() => {
						setOpen(false);
						setTitle('');
					}}
				>
					{t('Cancel')}
				</Button>
			</Box>
		</Box>
	);
};

export default QuickAddCard;
