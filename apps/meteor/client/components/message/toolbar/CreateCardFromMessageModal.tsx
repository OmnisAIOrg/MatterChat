import type { IMessage } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Box, Field, FieldLabel, FieldRow, Select, TextInput, Throbber } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Turns a chat message into a task card on a board (the message→card half of Fusion).
 * Self-contained: fetches boards + lists, defaults to the Matters pipeline board, and
 * creates a `task` card whose title is the message text and whose description carries
 * the full message body.
 */
type CreateCardFromMessageModalProps = {
	message: IMessage;
	onClose: () => void;
};

const CreateCardFromMessageModal = ({ message, onClose }: CreateCardFromMessageModalProps) => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();

	const listBoards = useEndpoint('GET', '/v1/boards.list');
	const getLists = useEndpoint('GET', '/v1/boards.lists');
	const createCard = useEndpoint('POST', '/v1/boards.card.create');

	const [title, setTitle] = useState((message.msg ?? '').slice(0, 140));
	const [boardId, setBoardId] = useState('');
	const [listId, setListId] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const titleId = useId();
	const boardFieldId = useId();
	const listFieldId = useId();

	const { data: boardsData, isLoading: boardsLoading } = useQuery({
		queryKey: ['create-card-from-message', 'boards'],
		queryFn: () => listBoards({}),
	});

	const boardOptions = useMemo<SelectOption[]>(
		() => (boardsData?.boards ?? []).filter((b) => !b.archived).map((b) => [b._id, b.title]),
		[boardsData],
	);

	// Default to a Matters pipeline board, otherwise the first available board.
	useEffect(() => {
		if (boardId || !boardsData?.boards?.length) {
			return;
		}
		const boards = boardsData.boards.filter((b) => !b.archived);
		const preferred = boards.find((b) => b.pipelineType === 'matters') ?? boards[0];
		if (preferred) {
			setBoardId(preferred._id);
		}
	}, [boardsData, boardId]);

	const { data: listsData, isLoading: listsLoading } = useQuery({
		queryKey: ['create-card-from-message', 'lists', boardId],
		queryFn: () => getLists({ boardId }),
		enabled: Boolean(boardId),
	});

	const listOptions = useMemo<SelectOption[]>(
		() => (listsData?.lists ?? []).filter((l) => !l.archived).map((l) => [l._id, l.title]),
		[listsData],
	);

	// Pick the first list whenever the board (and therefore the list set) changes.
	useEffect(() => {
		const lists = (listsData?.lists ?? []).filter((l) => !l.archived);
		if (lists.length && !lists.some((l) => l._id === listId)) {
			setListId(lists[0]._id);
		}
	}, [listsData, listId]);

	const canSubmit = Boolean(boardId && listId && title.trim()) && !submitting;

	const handleConfirm = async () => {
		if (!canSubmit) {
			return;
		}
		setSubmitting(true);
		try {
			await createCard({ boardId, listId, title: title.trim(), description: message.msg, cardType: 'task' });
			dispatchToastMessage({ type: 'success', message: t('Task_created') });
			onClose();
		} catch (error) {
			dispatchToastMessage({ type: 'error', message: error });
			setSubmitting(false);
		}
	};

	return (
		<GenericModal
			wrapperFunction={(props) => (
				<Box
					is='form'
					onSubmit={(e: FormEvent) => {
						e.preventDefault();
						void handleConfirm();
					}}
					{...props}
				/>
			)}
			title={t('Create_task_from_message')}
			confirmText={t('Create')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={!canSubmit}
		>
			{boardsLoading ? (
				<Box display='flex' justifyContent='center' p={24}>
					<Throbber />
				</Box>
			) : (
				<>
					<Field>
						<FieldLabel htmlFor={titleId}>{t('Title')}</FieldLabel>
						<FieldRow>
							<TextInput id={titleId} value={title} onChange={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
						</FieldRow>
					</Field>
					<Field mbs={12}>
						<FieldLabel htmlFor={boardFieldId}>{t('Board')}</FieldLabel>
						<FieldRow>
							<Select
								id={boardFieldId}
								value={boardId}
								onChange={(next) => setBoardId(String(next))}
								options={boardOptions}
								placeholder={t('Board')}
							/>
						</FieldRow>
					</Field>
					<Field mbs={12}>
						<FieldLabel htmlFor={listFieldId}>{t('List')}</FieldLabel>
						<FieldRow>
							<Select
								id={listFieldId}
								value={listId}
								onChange={(next) => setListId(String(next))}
								options={listOptions}
								placeholder={t('List')}
								disabled={listsLoading || !boardId}
							/>
						</FieldRow>
					</Field>
				</>
			)}
		</GenericModal>
	);
};

export default CreateCardFromMessageModal;
