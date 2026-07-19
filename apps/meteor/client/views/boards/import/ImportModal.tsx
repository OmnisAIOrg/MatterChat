import type { ReactElement } from 'react';
import { useState, useCallback, useRef } from 'react';
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
	TextInput,
	Select,
	Throbber,
	Icon,
} from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@rocket.chat/ui-contexts';

type ImportModalProps = {
	onClose: () => void;
	onImportSuccess?: (boardId: string) => void;
};

const ImportModal = ({ onClose, onImportSuccess }: ImportModalProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [boardName, setBoardName] = useState('');
	const [boardType, setBoardType] = useState('general');
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [fileInfo, setFileInfo] = useState<{
		name: string;
		cardCount?: number;
		listCount?: number;
	} | null>(null);

	const importMutation = useMutation({
		mutationFn: async (file: File) => {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('boardName', boardName);
			formData.append('boardType', boardType);

			const response = await fetch('/api/v1/boards.import', {
				method: 'POST',
				body: formData,
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Import failed');
			}

			return response.json();
		},
		onSuccess: (result) => {
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Import_Success', {
					defaultValue: `Imported ${result.cardCount} cards into ${result.listCount} lists`,
				}),
			});
			onImportSuccess?.(result.boardId);
			onClose();
			// Optional: navigate to the new board
			// router.navigate({ name: 'boards-board-view', params: { id: result.boardId } });
		},
		onError: (error) => {
			dispatchToastMessage({
				type: 'error',
				message: error instanceof Error ? error.message : 'Import failed',
			});
		},
	});

	const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		if (!file.name.endsWith('.json')) {
			dispatchToastMessage({
				type: 'error',
				message: t('Boards_Import_InvalidFileType', {
					defaultValue: 'Please select a JSON file',
				}),
			});
			return;
		}

		setSelectedFile(file);
		setFileInfo({
			name: file.name,
		});

		// Try to parse the file to get card/list count
		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const data = JSON.parse(e.target?.result as string);
				setFileInfo({
					name: file.name,
					cardCount: data.cards?.length || 0,
					listCount: data.lists?.length || 0,
				});
			} catch {
				// File will be re-parsed on import, just show the filename
			}
		};
		reader.readAsText(file);
	}, [dispatchToastMessage, t]);

	const handleImport = useCallback(() => {
		if (!selectedFile) return;
		importMutation.mutate(selectedFile);
	}, [selectedFile, importMutation]);

	return (
		<Modal open={true} onClose={onClose}>
			<ModalHeader>
				<ModalTitle>{t('Boards_Import_Title', { defaultValue: 'Import Board' })}</ModalTitle>
				<ModalClose onClick={onClose} />
			</ModalHeader>
			<ModalContent>
				<Box display='flex' flexDirection='column' gap={16}>
					<Box>
						<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
							{t('Boards_Import_SelectFile', { defaultValue: 'Select file (Trello JSON)' })}
						</Box>
						<Box
							paddingBlock={24}
							paddingInline={16}
							backgroundColor='surface2'
							borderRadius={9}
							textAlign='center'
							borderStyle='dashed'
							borderWidth={2}
							borderColor='border'
							cursor='pointer'
							onClick={() => fileInputRef.current?.click()}
							style={{
								transition: 'all 150ms cubic-bezier(.2,.8,.3,1)',
							}}
						>
							<input
								ref={fileInputRef}
								type='file'
								accept='.json'
								onChange={handleFileSelect}
								style={{ display: 'none' }}
							/>
							{selectedFile ? (
								<Box>
									<Icon name='file-json' size='x32' color='accent' marginBlockEnd={8} />
									<Box fontScale='p2' fontWeight='500' marginBlockEnd={4}>
										{selectedFile.name}
									</Box>
									{fileInfo?.cardCount !== undefined && (
										<Box fontScale='s2' color='hint'>
											{t('Boards_Import_FileInfo', {
												defaultValue:
													'{{cardCount}} cards in {{listCount}} lists',
												cardCount: fileInfo.cardCount,
												listCount: fileInfo.listCount || 0,
											})}
										</Box>
									)}
									<Button
										small
										secondary
										marginBlockStart={8}
										onClick={(e) => {
											e.stopPropagation();
											fileInputRef.current?.click();
										}}
									>
										{t('Boards_Import_ChooseDifferent', {
											defaultValue: 'Choose different file',
										})}
									</Button>
								</Box>
							) : (
								<Box>
									<Icon name='file-json' size='x32' color='hint' marginBlockEnd={8} />
									<Box fontScale='p2' fontWeight='500' marginBlockEnd={4}>
										{t('Boards_Import_DropFile', { defaultValue: 'Click to select a JSON file' })}
									</Box>
									<Box fontScale='s2' color='hint'>
										{t('Boards_Import_SupportedFormat', {
											defaultValue: 'Exported from Trello',
										})}
									</Box>
								</Box>
							)}
						</Box>
					</Box>

					{selectedFile && (
						<>
							<Box>
								<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
									{t('Boards_Import_BoardName', { defaultValue: 'Board name' })}
								</Box>
								<TextInput
									value={boardName}
									onChange={(e) => setBoardName(e.currentTarget.value)}
									placeholder={t('Boards_Import_BoardNamePlaceholder', {
										defaultValue: 'Enter board name',
									})}
								/>
							</Box>

							<Box>
								<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
									{t('Boards_Import_BoardType', { defaultValue: 'Board type' })}
								</Box>
								<Select value={boardType} onChange={(value) => setBoardType(value)}>
									<option value='general'>
										{t('Boards_Import_Type_General', { defaultValue: 'General' })}
									</option>
									<option value='task'>
										{t('Boards_Import_Type_Task', { defaultValue: 'Task' })}
									</option>
									<option value='matters'>
										{t('Boards_Import_Type_Matters', { defaultValue: 'Matters' })}
									</option>
									<option value='leads'>
										{t('Boards_Import_Type_Leads', { defaultValue: 'Leads' })}
									</option>
								</Select>
							</Box>
						</>
					)}
				</Box>
			</ModalContent>
			<ModalFooter>
				<ButtonGroup>
					<Button onClick={onClose}>
						{t('Boards_Import_Cancel', { defaultValue: 'Cancel' })}
					</Button>
					<Button
						primary
						onClick={handleImport}
						disabled={
							importMutation.isPending ||
							!selectedFile ||
							!boardName.trim()
						}
					>
						{importMutation.isPending ? <Throbber /> : null}
						{t('Boards_Import_Start', { defaultValue: 'Import' })}
					</Button>
				</ButtonGroup>
			</ModalFooter>
		</Modal>
	);
};

export default ImportModal;
