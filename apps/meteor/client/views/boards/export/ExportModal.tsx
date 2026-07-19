import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Box,
	Button,
	ButtonGroup,
	Modal,
	ModalHeader,
	ModalTitle,
	ModalClose,
	ModalContent,
	ModalFooter,
	RadioGroup,
	Radio,
	Throbber,
} from '@rocket.chat/fuselage';
import { useToastMessageDispatch, useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import type { IBoardList, Serialized } from '@rocket.chat/core-typings';

type ExportModalProps = {
	boardId: string;
	boardTitle: string;
	lists: Serialized<IBoardList>[];
	onClose: () => void;
};

const ExportModal = ({ boardId, boardTitle, lists, onClose }: ExportModalProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const exportEndpoint = useEndpoint('POST', '/v1/boards.export');

	const [format, setFormat] = useState<'csv' | 'json'>('csv');
	const [selectedLists, setSelectedLists] = useState<Set<string>>(
		new Set(lists.map((l) => l._id)),
	);

	const exportMutation = useMutation({
		mutationFn: async () => {
			const response = await fetch('/api/v1/boards.export', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					boardId,
					format,
					listIds: format === 'csv' ? Array.from(selectedLists) : undefined,
				}),
			});

			if (!response.ok) {
				throw new Error(
					(await response.json()).error || 'Export failed',
				);
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;

			const ext = format === 'csv' ? '.csv' : '.json';
			link.download = `${boardTitle.replace(/\s+/g, '-').toLowerCase()}-export-${Date.now()}${
				selectedLists.size > 1 && format === 'csv' ? '.zip' : ext
			}`;

			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);
		},
		onSuccess: () => {
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Export_Success', {
					defaultValue: 'Board exported successfully',
				}),
			});
			onClose();
		},
		onError: (error) => {
			dispatchToastMessage({
				type: 'error',
				message: error instanceof Error ? error.message : 'Export failed',
			});
		},
	});

	const handleToggleList = useCallback(
		(listId: string) => {
			const newSet = new Set(selectedLists);
			if (newSet.has(listId)) {
				newSet.delete(listId);
			} else {
				newSet.add(listId);
			}
			setSelectedLists(newSet);
		},
		[selectedLists],
	);

	const handleSelectAll = useCallback(() => {
		if (selectedLists.size === lists.length) {
			setSelectedLists(new Set());
		} else {
			setSelectedLists(new Set(lists.map((l) => l._id)));
		}
	}, [lists, selectedLists]);

	return (
		<Modal open={true} onClose={onClose}>
			<ModalHeader>
				<ModalTitle>{t('Boards_Export_Title', { defaultValue: 'Export Board' })}</ModalTitle>
				<ModalClose onClick={onClose} />
			</ModalHeader>
			<ModalContent>
				<Box display='flex' flexDirection='column' gap={16}>
					<Box>
						<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
							{t('Boards_Export_Format', { defaultValue: 'Export Format' })}
						</Box>
						<RadioGroup value={format} onChange={setFormat}>
							<Box marginBlockEnd={12}>
								<Radio value='csv' />
								<Box display='inline' marginInlineStart={8}>
									{t('Boards_Export_Format_CSV', { defaultValue: 'CSV (Cards and fields)' })}
								</Box>
							</Box>
							<Box>
								<Radio value='json' />
								<Box display='inline' marginInlineStart={8}>
									{t('Boards_Export_Format_JSON', {
										defaultValue: 'JSON (Full board structure)',
									})}
								</Box>
							</Box>
						</RadioGroup>
					</Box>

					{format === 'csv' && (
						<Box>
							<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
								{t('Boards_Export_Lists', { defaultValue: 'Select lists to export' })}
							</Box>
							<Box
								display='flex'
								alignItems='center'
								marginBlockEnd={12}
								paddingBlock={8}
								paddingInline={12}
								backgroundColor='surface2'
								borderRadius={7}
							>
								<input
									type='checkbox'
									checked={selectedLists.size === lists.length}
									onChange={handleSelectAll}
									style={{ cursor: 'pointer' }}
								/>
								<Box marginInlineStart={8} fontScale='p2' fontWeight='500'>
									{t('Boards_Export_SelectAll', { defaultValue: 'Select All' })}
								</Box>
							</Box>
							<Box display='flex' flexDirection='column' gap={8} maxHeight='300px' overflow='auto'>
								{lists.map((list) => (
									<Box
										key={list._id}
										display='flex'
										alignItems='center'
										paddingBlock={8}
										paddingInline={12}
										borderRadius={7}
										backgroundColor='surface2'
									>
										<input
											type='checkbox'
											checked={selectedLists.has(list._id)}
											onChange={() => handleToggleList(list._id)}
											style={{ cursor: 'pointer' }}
										/>
										<Box marginInlineStart={8} fontScale='p2'>
											{list.title}
										</Box>
									</Box>
								))}
							</Box>
						</Box>
					)}

					{format === 'json' && (
						<Box
							backgroundColor='surface2'
							padding={12}
							borderRadius={9}
							fontScale='p2'
							color='hint'
						>
							{t('Boards_Export_JSON_Info', {
								defaultValue:
									'Exports the complete board structure including all cards, lists, comments, and activity.',
							})}
						</Box>
					)}
				</Box>
			</ModalContent>
			<ModalFooter>
				<ButtonGroup>
					<Button onClick={onClose}>
						{t('Boards_Export_Cancel', { defaultValue: 'Cancel' })}
					</Button>
					<Button
						primary
						onClick={() => exportMutation.mutate()}
						disabled={
							exportMutation.isPending ||
							(format === 'csv' && selectedLists.size === 0)
						}
					>
						{exportMutation.isPending ? <Throbber /> : null}
						{t('Boards_Export_Download', { defaultValue: 'Download' })}
					</Button>
				</ButtonGroup>
			</ModalFooter>
		</Modal>
	);
};

export default ExportModal;
