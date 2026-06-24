import type { IBoardActivity, IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Divider, Icon, Tabs, TextAreaInput, TextInput, Throbber } from '@rocket.chat/fuselage';
import {
	ContextualbarClose,
	ContextualbarDialog,
	ContextualbarHeader,
	ContextualbarScrollableContent,
	ContextualbarTitle,
} from '@rocket.chat/ui-client';
import { useEndpoint, useMethod, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getCardTypeIcon } from '../lib/icons';
import CardButtonsRow from './CardButtonsRow';
import CardLabelsControl from './CardLabelsControl';
import ChecklistPanel from './ChecklistPanel';
import LeadPanel from './LeadPanel';
import MatterPanel from './MatterPanel';
import WatchToggle from './WatchToggle';

type CardDetailProps = {
	boardId: string;
	cardId: string;
	onClose: () => void;
};

type CardTab = 'detail' | 'activity';

const CommentsBlock = ({ card }: { card: Serialized<IBoardCard> }) => {
	const { t } = useTranslation();
	return (
		<Box mbs={16}>
			<Box fontScale='p2b' color='default' mbe={8}>
				{t('Comment')}
			</Box>
			{card.comments.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}
			{card.comments.map((comment) => (
				<Box key={comment.id} mbe={8} pb={8} pi={8} bg='tint' borderRadius='x4'>
					<Box fontScale='micro' color='hint' mbe={2}>
						{comment.author} · {new Date(comment.ts).toLocaleString()}
					</Box>
					<Box fontScale='p2' color='default'>
						{comment.body}
					</Box>
				</Box>
			))}
		</Box>
	);
};

const ActivityBlock = ({ boardId, cardId }: { boardId: string; cardId: string }) => {
	const { t } = useTranslation();
	const getActivities = useEndpoint('GET', '/v1/boards.activities');
	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'activities', cardId],
		queryFn: () => getActivities({ boardId, cardId, count: 100 }),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={16}>
				<Throbber />
			</Box>
		);
	}

	const activities: Serialized<IBoardActivity>[] = data?.activities ?? [];

	if (activities.length === 0) {
		return (
			<Box fontScale='c1' color='hint' p={8}>
				{t('No_results_found')}
			</Box>
		);
	}

	return (
		<Box>
			{activities.map((activity) => (
				<Box key={activity._id} display='flex' alignItems='flex-start' mbe={8}>
					<Icon name='clock' size='x16' mie={8} mbs={2} color='hint' />
					<Box>
						<Box fontScale='p2' color='default'>
							{activity.verb}
						</Box>
						<Box fontScale='micro' color='hint'>
							{activity.actor} · {new Date(activity.ts).toLocaleString()}
						</Box>
					</Box>
				</Box>
			))}
		</Box>
	);
};

const CardDetail = ({ boardId, cardId, onClose }: CardDetailProps) => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getCard = useEndpoint('GET', '/v1/boards.card');
	const cardUpdate = useMethod('boards.cardUpdate');

	const [tab, setTab] = useState<CardTab>('detail');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'card', cardId],
		queryFn: () => getCard({ cardId }),
	});

	const card = data?.card;

	useEffect(() => {
		if (card) {
			setTitle(card.title);
			setDescription(card.description ?? '');
		}
	}, [card]);

	const saveMutation = useMutation({
		mutationFn: (patch: { title?: string; description?: string }) => cardUpdate({ cardId, patch }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	const dirty = card ? title !== card.title || description !== (card.description ?? '') : false;

	const handleSave = (): void => {
		if (!card) {
			return;
		}
		const patch: { title?: string; description?: string } = {};
		if (title.trim() && title !== card.title) {
			patch.title = title.trim();
		}
		if (description !== (card.description ?? '')) {
			patch.description = description;
		}
		if (Object.keys(patch).length > 0) {
			saveMutation.mutate(patch);
		}
	};

	return (
		<ContextualbarDialog onClose={onClose}>
			<ContextualbarHeader>
				{card && <Icon name={getCardTypeIcon(card.cardType)} size='x20' mie={4} />}
				<ContextualbarTitle>{card?.title ?? t('Loading')}</ContextualbarTitle>
				{card && <WatchToggle cardId={cardId} />}
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>

			<Tabs>
				<Tabs.Item selected={tab === 'detail'} onClick={() => setTab('detail')}>
					{t('Board')}
				</Tabs.Item>
				<Tabs.Item selected={tab === 'activity'} onClick={() => setTab('activity')}>
					{t('Boards_Card_Activity')}
				</Tabs.Item>
			</Tabs>

			<ContextualbarScrollableContent>
				{isLoading && (
					<Box display='flex' justifyContent='center' p={24}>
						<Throbber />
					</Box>
				)}

				{!isLoading && card && tab === 'detail' && (
					<Box>
						{card.cardType === 'lead' && card.link?.kind === 'lead' && (
							<Box mbe={16}>
								<LeadPanel leadId={card.link.leadId} boardId={boardId} cardId={cardId} />
							</Box>
						)}
						{card.cardType === 'matter' && (
							<Box mbe={16}>
								<MatterPanel card={card} />
							</Box>
						)}
						<Box mbe={12}>
							<Box fontScale='c1' color='hint' mbe={4}>
								{t('Title')}
							</Box>
							<TextInput value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
						</Box>

						<Box mbe={12}>
							<Box fontScale='c1' color='hint' mbe={4}>
								{t('Description')}
							</Box>
							<TextAreaInput
								rows={5}
								value={description}
								placeholder={t('Description')}
								onChange={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							/>
						</Box>

						{dirty && (
							<Box mbe={8}>
								<Button small primary onClick={handleSave} disabled={saveMutation.isPending}>
									{t('Save')}
								</Button>
							</Box>
						)}

						{/* Card labels: chips + an expandable manager (toggle/create/edit/delete board labels) */}
						<CardLabelsControl boardId={boardId} cardId={cardId} cardLabelIds={card.labels} />

						{/* M7 — card-button automations runnable against this card (hidden when none) */}
						<CardButtonsRow boardId={boardId} cardId={cardId} cardType={card.cardType} />

						<Divider />

						<Box fontScale='c1' color='hint'>
							#{card.cardNumber} · {card.cardType}
						</Box>

						<ChecklistPanel boardId={boardId} cardId={cardId} checklists={card.checklists} />
						<CommentsBlock card={card} />
					</Box>
				)}

				{!isLoading && card && tab === 'activity' && <ActivityBlock boardId={boardId} cardId={cardId} />}
			</ContextualbarScrollableContent>
		</ContextualbarDialog>
	);
};

export default CardDetail;
