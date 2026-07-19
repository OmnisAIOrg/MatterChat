import type { IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon, TextInput, Throbber, Callout, Avatar } from '@rocket.chat/fuselage';
import { useDebouncedValue } from '@rocket.chat/fuselage-hooks';
import { useEndpoint, useRouter } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ChangeEvent } from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { css } from '@rocket.chat/css-in-js';

type SerializedCard = Serialized<IBoardCard>;

type MattersSearchProps = {
	boardId: string;
};

const searchResultsDropdownClass = css`
	position: absolute;
	top: calc(100% + 8px);
	left: 0;
	right: 0;
	background: var(--rcx-color-surface-light);
	border: 1px solid var(--rcx-color-stroke-light);
	border-radius: 4px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	z-index: 100;
	max-height: 400px;
	overflow-y: auto;
`;

const searchResultItemClass = css`
	padding: 8px 12px;
	cursor: pointer;
	border-bottom: 1px solid var(--rcx-color-stroke-extra-light);
	transition: background-color 150ms;

	&:hover {
		background-color: var(--rcx-color-surface-hover);
	}

	&:last-child {
		border-bottom: none;
	}
`;

// boardId is accepted for future board-scoped search; the endpoint is global today.
const MattersSearch = (_props: MattersSearchProps) => {
	const { t } = useTranslation();
	const router = useRouter();
	const searchCardsEndpoint = useEndpoint('GET', '/v1/boards.cards.search');

	const [searchText, setSearchText] = useState('');
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const debouncedQuery = useDebouncedValue(searchText, 250);

	// Perform search when debounced query changes
	const { data: searchResult, isPending, isError } = useQuery({
		queryKey: ['boards.cards.search', debouncedQuery],
		queryFn: async () => {
			if (!debouncedQuery.trim()) {
				return { cards: [] };
			}
			return searchCardsEndpoint({ text: debouncedQuery });
		},
		enabled: !!debouncedQuery.trim(),
	});

	const handleSearchTextChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		setSearchText(event.currentTarget.value);
		setIsOpen(true);
	}, []);

	const handleClear = useCallback(() => {
		setSearchText('');
		setIsOpen(false);
		inputRef.current?.focus();
	}, []);

	const handleResultClick = useCallback(
		(cardId: string) => {
			router.navigate({ name: 'boards-matters', params: { cardId } });
			setSearchText('');
			setIsOpen(false);
		},
		[router],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Escape') {
				if (searchText) {
					handleClear();
				} else {
					setIsOpen(false);
				}
			}
		},
		[searchText, handleClear],
	);

	// Handle click outside to close dropdown
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => {
				document.removeEventListener('mousedown', handleClickOutside);
			};
		}
	}, [isOpen]);

	const cards = searchResult?.cards ?? [];

	return (
		<Box position='relative' display='flex' flexGrow={1} maxWidth='400px' ref={containerRef}>
			<TextInput
				ref={inputRef}
				aria-label={t('Search_Matters')}
				placeholder={t('Search_Matters')}
				addon={<Icon name='magnifier' size='x20' />}
				value={searchText}
				onChange={handleSearchTextChange}
				onKeyDown={handleKeyDown}
				onFocus={() => searchText && setIsOpen(true)}
			/>
			{searchText && (
				<Box
					display='flex'
					alignItems='center'
					paddingInlineEnd={8}
					onClick={handleClear}
					style={{ cursor: 'pointer', position: 'absolute', right: 0, top: 0, bottom: 0 }}
				>
					<Icon name='cross' size='x20' color='hint' />
				</Box>
			)}

			{isOpen && debouncedQuery && (
				<Box className={searchResultsDropdownClass}>
					{isPending && (
						<Box pi={12} pb={12} display='flex' alignItems='center' justifyContent='center' minHeight='80px'>
							<Throbber size='x12' />
						</Box>
					)}

					{!isPending && cards.length === 0 && (
						<Box pi={12} pb={12} pbs={12}>
							<Box fontScale='p2' color='hint'>
								{t('No_Matters_Found')}
							</Box>
						</Box>
					)}

					{!isPending &&
						cards.length > 0 &&
						cards.map((card: SerializedCard) => (
							<Box
								key={card._id}
								className={searchResultItemClass}
								onClick={() => handleResultClick(card._id)}
								display='flex'
								flexDirection='column'
								gap={4}
							>
								<Box fontScale='p2' fontWeight='500'>
									{card.title}
								</Box>
								{card.assignees && card.assignees.length > 0 && (
									<Box display='flex' alignItems='center' gap={4}>
										{card.assignees.slice(0, 2).map((assignee: any) => (
											<Avatar key={assignee._id} size='x16' title={assignee.name} />
										))}
										{card.assignees.length > 2 && (
											<Box fontScale='c1' color='hint'>
												+{card.assignees.length - 2}
											</Box>
										)}
									</Box>
								)}
							</Box>
						))}

					{isError && (
						<Box pi={12} pb={12}>
							<Callout type='danger'>{t('Something_went_wrong')}</Callout>
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
};

export default MattersSearch;
