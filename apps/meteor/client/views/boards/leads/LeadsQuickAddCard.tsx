import { Box, Icon } from '@rocket.chat/fuselage';
import { useThemeMode } from '@rocket.chat/ui-client';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getLeadsTokens, LEADS_RADIUS } from './leadsDesignTokens';

type LeadsQuickAddCardProps = {
	isAdding: boolean;
	onAdd: (title: string) => Promise<void> | void;
};

const LeadsQuickAddCard = ({ isAdding, onAdd }: LeadsQuickAddCardProps) => {
	const { t } = useTranslation();
	const [, , themeMode] = useThemeMode();
	const isDark = themeMode === 'dark';
	const tokens = getLeadsTokens(isDark);
	const [isActive, setIsActive] = useState(false);
	const [inputValue, setInputValue] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	const handleAdd = useCallback(async () => {
		const trimmed = inputValue.trim();
		if (!trimmed) {
			return;
		}
		setInputValue('');
		setIsActive(false);
		await onAdd(trimmed);
	}, [inputValue, onAdd]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void handleAdd();
			} else if (e.key === 'Escape') {
				setIsActive(false);
				setInputValue('');
			}
		},
		[handleAdd],
	);

	if (isActive) {
		return (
			<Box
				display='flex'
				flexDirection='column'
				gap={8}
				style={{
					marginTop: '4px',
				}}
			>
				<input
					ref={inputRef}
					type='text'
					placeholder={t('Boards_Add_Card_Placeholder', { defaultValue: 'Enter card title...' })}
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					autoFocus
					style={{
						width: '100%',
						padding: '8px 11px',
						borderRadius: LEADS_RADIUS.button,
						border: `1px solid ${tokens.border}`,
						backgroundColor: tokens.surface,
						color: tokens.ink,
						fontFamily: "'Geist', system-ui, sans-serif",
						fontSize: '13px',
						boxSizing: 'border-box',
						outline: 'none',
						transition: 'all 0.15s',
						boxShadow: tokens.shadow1,
					}}
					onBlur={() => {
						if (!inputValue.trim()) {
							setIsActive(false);
						}
					}}
				/>
				<Box display='flex' gap={8}>
					<button
						onClick={() => void handleAdd()}
						disabled={!inputValue.trim() || isAdding}
						style={{
							flex: 1,
							padding: '6px 10px',
							borderRadius: LEADS_RADIUS.button,
							border: 'none',
							backgroundColor: tokens.green,
							color: tokens.onGreen,
							fontFamily: "'Geist', system-ui, sans-serif",
							fontSize: '12px',
							fontWeight: 600,
							cursor: 'pointer',
							transition: 'all 0.15s',
							opacity: !inputValue.trim() || isAdding ? 0.6 : 1,
						}}
					>
						{isAdding ? '...' : t('Boards_Add_Card_Button', { defaultValue: 'Add' })}
					</button>
					<button
						onClick={() => {
							setIsActive(false);
							setInputValue('');
						}}
						style={{
							flex: 1,
							padding: '6px 10px',
							borderRadius: LEADS_RADIUS.button,
							border: `1px solid ${tokens.border}`,
							backgroundColor: tokens.surface,
							color: tokens.ink,
							fontFamily: "'Geist', system-ui, sans-serif",
							fontSize: '12px',
							fontWeight: 600,
							cursor: 'pointer',
							transition: 'all 0.15s',
						}}
					>
						{t('Boards_Cancel', { defaultValue: 'Cancel' })}
					</button>
				</Box>
			</Box>
		);
	}

	return (
		<button
			onClick={() => {
				setIsActive(true);
				setTimeout(() => inputRef.current?.focus(), 0);
			}}
			disabled={isAdding}
			style={{
				height: '34px',
				borderRadius: LEADS_RADIUS.button,
				border: `1.5px dashed ${tokens.border2}`,
				backgroundColor: 'transparent',
				color: tokens.ink3,
				fontFamily: "'Geist', system-ui, sans-serif",
				fontSize: '12.5px',
				fontWeight: 500,
				cursor: 'pointer',
				transition: 'all 0.15s',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '6px',
			}}
			onMouseEnter={(e) => {
				(e.target as HTMLButtonElement).style.borderColor = tokens.green;
				(e.target as HTMLButtonElement).style.color = tokens.green;
				(e.target as HTMLButtonElement).style.backgroundColor = tokens.greenSoft;
			}}
			onMouseLeave={(e) => {
				(e.target as HTMLButtonElement).style.borderColor = tokens.border2;
				(e.target as HTMLButtonElement).style.color = tokens.ink3;
				(e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
			}}
		>
			<Icon name='plus' size='x16' />
			{t('Boards_Add_Card', { defaultValue: 'Add card' })}
		</button>
	);
};

export default LeadsQuickAddCard;
