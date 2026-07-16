/**
 * MatterChat fork — canned replies / templates picker modal.
 *
 * Rendered imperatively (imperativeModal). `onPick` decides delivery: the "+"
 * menu passes an inserter (stages text in the composer for editing); the
 * `/canned` slash-command fallback passes a sender (posts immediately).
 */
import {
	Box,
	Button,
	ButtonGroup,
	Divider,
	IconButton,
	Modal,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalFooterControllers,
	ModalHeader,
	ModalHeaderText,
	ModalTitle,
	Scrollable,
	SearchInput,
	TextAreaInput,
	TextInput,
} from '@rocket.chat/fuselage';
import { useMemo, useState } from 'react';

import type { CannedTemplate } from './cannedTemplates';
import { addTemplate, getTemplates, removeTemplate } from './cannedTemplates';

type CannedRepliesModalProps = {
	userId?: string;
	/** verb shown on the primary per-template button, e.g. 'Insert' or 'Send' */
	actionLabel?: string;
	onPick: (text: string) => void;
	onClose: () => void;
};

const matches = (t: CannedTemplate, q: string): boolean => {
	if (!q) {
		return true;
	}
	const needle = q.toLowerCase();
	return t.title.toLowerCase().includes(needle) || t.body.toLowerCase().includes(needle);
};

const CannedRepliesModal = ({ userId, actionLabel = 'Insert', onPick, onClose }: CannedRepliesModalProps) => {
	const [templates, setTemplates] = useState<CannedTemplate[]>(() => getTemplates(userId));
	const [search, setSearch] = useState('');
	const [showAdd, setShowAdd] = useState(false);
	const [newTitle, setNewTitle] = useState('');
	const [newBody, setNewBody] = useState('');

	const visible = useMemo(() => templates.filter((t) => matches(t, search)), [templates, search]);

	const handlePick = (body: string): void => {
		onPick(body);
		onClose();
	};

	const handleRemove = (id: string): void => {
		removeTemplate(userId, id);
		setTemplates(getTemplates(userId));
	};

	const handleSaveNew = (): void => {
		if (!newBody.trim()) {
			return;
		}
		addTemplate(userId, newTitle, newBody);
		setTemplates(getTemplates(userId));
		setNewTitle('');
		setNewBody('');
		setShowAdd(false);
	};

	return (
		<Modal>
			<ModalHeader>
				<ModalHeaderText>
					<ModalTitle>Canned replies</ModalTitle>
				</ModalHeaderText>
				<ModalClose aria-label='Close' onClick={onClose} />
			</ModalHeader>
			<ModalContent>
				<Box mbe={12}>
					<SearchInput
						placeholder='Search templates'
						value={search}
						onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
						addon={undefined}
					/>
				</Box>

				<Scrollable vertical>
					<Box maxHeight='x320' display='flex' flexDirection='column'>
						{visible.length === 0 && (
							<Box color='hint' pi={8} pb={16}>
								No templates match “{search}”.
							</Box>
						)}
						{visible.map((tpl) => (
							<Box
								key={tpl.id}
								display='flex'
								alignItems='flex-start'
								justifyContent='space-between'
								pb={12}
								mbe={12}
								style={{ borderBottom: '1px solid var(--rcx-color-stroke-extra-light, rgba(0,0,0,0.1))' }}
							>
								<Box flexGrow={1} mie={8} style={{ minWidth: 0 }}>
									<Box fontWeight='600' mbe={2}>
										{tpl.title}
									</Box>
									<Box
										fontScale='c1'
										color='hint'
										style={{
											whiteSpace: 'pre-wrap',
											overflow: 'hidden',
											display: '-webkit-box',
											WebkitLineClamp: 2,
											WebkitBoxOrient: 'vertical',
										}}
									>
										{tpl.body}
									</Box>
								</Box>
								<ButtonGroup>
									{!tpl.readonly && (
										<IconButton
											icon='trash'
											small
											title='Delete template'
											aria-label='Delete template'
											onClick={() => handleRemove(tpl.id)}
										/>
									)}
									<Button small primary onClick={() => handlePick(tpl.body)}>
										{actionLabel}
									</Button>
								</ButtonGroup>
							</Box>
						))}
					</Box>
				</Scrollable>

				<Divider />

				{!showAdd && (
					<Box>
						<Button small icon='plus' onClick={() => setShowAdd(true)}>
							Add template
						</Button>
					</Box>
				)}

				{showAdd && (
					<Box display='flex' flexDirection='column' mbs={8}>
						<Box mbe={8}>
							<TextInput placeholder='Template name' value={newTitle} onChange={(e) => setNewTitle((e.target as HTMLInputElement).value)} />
						</Box>
						<Box mbe={8}>
							<TextAreaInput
								rows={4}
								placeholder='Template text…'
								value={newBody}
								onChange={(e) => setNewBody((e.target as HTMLTextAreaElement).value)}
							/>
						</Box>
						<ButtonGroup align='end'>
							<Button small onClick={() => setShowAdd(false)}>
								Cancel
							</Button>
							<Button small primary disabled={!newBody.trim()} onClick={handleSaveNew}>
								Save template
							</Button>
						</ButtonGroup>
					</Box>
				)}
			</ModalContent>
			<ModalFooter>
				<ModalFooterControllers>
					<Button onClick={onClose}>Close</Button>
				</ModalFooterControllers>
			</ModalFooter>
		</Modal>
	);
};

export default CannedRepliesModal;
