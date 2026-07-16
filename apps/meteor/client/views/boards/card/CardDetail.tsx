import type { IBoardActivity, IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { css } from '@rocket.chat/css-in-js';
import { Box, Button, ContextualbarV2, Divider, Icon, IconButton, Tabs, TextAreaInput, TextInput, Throbber } from '@rocket.chat/fuselage';
import {
	ContextualbarClose,
	ContextualbarDialog,
	ContextualbarHeader,
	ContextualbarScrollableContent,
	ContextualbarTitle,
} from '@rocket.chat/ui-client';
import { useEndpoint, useMethod, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CardButtonsRow from './CardButtonsRow';
import CardErrorBoundary from './CardErrorBoundary';
import CardLabelsControl from './CardLabelsControl';
import ChecklistPanel from './ChecklistPanel';
import LeadPanel from './LeadPanel';
import MatterPanel from './MatterPanel';
import SubtasksPanel from './SubtasksPanel';
import TimePanel from './TimePanel';
import WatchToggle from './WatchToggle';
import { ledgerHead, ledgerRule, serifCaption, tabularFigures, useLedgerTone } from './ledgerStyles';
import { getCardTypeIcon } from '../lib/icons';

type CardDetailProps = {
	boardId: string;
	cardId: string;
	onClose: () => void;
	// When true (matter cards), the panel opens EXPANDED — a majority-width detail beside a
	// shrunken kanban — instead of the narrow right drawer. See BoardRouter.
	defaultExpanded?: boolean;
};

type CardTab = 'detail' | 'activity';

// The expanded shell reuses Fuselage's ContextualbarV2 (same styled column as the drawer) but
// escapes ContextualbarResizable's hard 50% cap: it takes the majority of the board area,
// clamped so it never gets absurdly wide, and drops to full-width on a narrow viewport.
const expandedBarClass = css`
	width: clamp(560px, 62%, 980px);
	max-width: 100%;
	@media (max-width: 767px) {
		width: 100%;
	}
`;

const CommentsBlock = ({ card }: { card: Serialized<IBoardCard> }) => {
	const { t } = useTranslation();
	const tone = useLedgerTone();
	return (
		<Box mbs={12}>
			<Box mbe={6} pbe={2} style={{ ...ledgerHead(tone), ...ledgerRule(tone) }}>
				{t('Comment')}
			</Box>
			{card.comments.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}
			{card.comments.map((comment) => (
				<Box
					key={comment.id}
					mbe={6}
					pb={8}
					pi={8}
					borderRadius='x4'
					style={{ backgroundColor: tone.card, boxShadow: `inset 0 0 0 1px ${tone.rule}` }}
				>
					<Box fontScale='micro' color='hint' mbe={2} style={tabularFigures}>
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
	const tone = useLedgerTone();
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
				<Box key={activity._id} display='flex' alignItems='flex-start' mbe={6} pbe={4} style={ledgerRule(tone)}>
					<Icon name='clock' size='x16' mie={8} mbs={2} color='hint' />
					<Box>
						<Box fontScale='p2' color='default'>
							{activity.verb}
						</Box>
						<Box fontScale='micro' color='hint' style={tabularFigures}>
							{activity.actor} · {new Date(activity.ts).toLocaleString()}
						</Box>
					</Box>
				</Box>
			))}
		</Box>
	);
};

const CardDetail = ({ boardId, cardId, onClose, defaultExpanded = false }: CardDetailProps) => {
	const { t } = useTranslation();
	const tone = useLedgerTone();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getCard = useEndpoint('GET', '/v1/boards.card');
	const cardUpdate = useMethod('boards.cardUpdate');

	const [tab, setTab] = useState<CardTab>('detail');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');

	// undefined = follow the default (matter → expanded, else drawer); a boolean = user override.
	const [expandedOverride, setExpandedOverride] = useState<boolean | undefined>(undefined);

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'card', cardId],
		queryFn: () => getCard({ cardId }),
	});

	const card = data?.card;

	// A card's own type is the source of truth once loaded; the board-level hint drives the
	// first paint. Reset any manual toggle when the open card changes.
	const expandedByDefault = card ? card.cardType === 'matter' : defaultExpanded;
	const expanded = expandedOverride ?? expandedByDefault;
	const toggleExpanded = (): void => setExpandedOverride(!expanded);

	useEffect(() => {
		setExpandedOverride(undefined);
	}, [cardId]);

	// ContextualbarDialog wires ESC-to-close itself; the expanded shell doesn't, so mirror it.
	useEffect(() => {
		if (!expanded) {
			return undefined;
		}
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [expanded, onClose]);

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

	const body: ReactNode = (
		<>
			<ContextualbarHeader>
				{card && <Icon name={getCardTypeIcon(card.cardType)} size='x20' mie={4} />}
				{/* Serif "case caption" title — same treatment as the room-header caption. */}
				<ContextualbarTitle>
					<Box is='span' style={serifCaption}>
						{card?.title ?? t('Loading')}
					</Box>
				</ContextualbarTitle>
				{card && <WatchToggle cardId={cardId} />}
				<IconButton
					small
					icon={expanded ? 'arrow-collapse' : 'arrow-expand'}
					// The expanded shell (ContextualbarV2) and the drawer (ContextualbarDialog) reuse this
					// button's DOM node across the switch, and Fuselage applies `title` imperatively on
					// mount — so on the collapse→drawer transition the tooltip title went stale/empty,
					// leaving the drawer's Expand button with NO accessible name. An explicit `aria-label`
					// (a plainly React-managed attribute) guarantees a stable accessible name in both states.
					title={expanded ? t('Collapse', { defaultValue: 'Collapse' }) : t('Expand', { defaultValue: 'Expand' })}
					aria-label={expanded ? t('Collapse', { defaultValue: 'Collapse' }) : t('Expand', { defaultValue: 'Expand' })}
					onClick={toggleExpanded}
				/>
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

			{/* Paper treatment: warm paper (light) / calm dense dark surface behind the card body. */}
			<ContextualbarScrollableContent style={{ backgroundColor: tone.paper }}>
				{isLoading && (
					<Box display='flex' justifyContent='center' p={24}>
						<Throbber />
					</Box>
				)}

				{!isLoading && card && tab === 'detail' && (
					<Box>
						{/* Typed panels render inside a local error boundary: a panel bug degrades to an
						    inline callout with retry instead of white-screening the entire client. */}
						{card.cardType === 'lead' && card.link?.kind === 'lead' && (
							<Box mbe={16}>
								<CardErrorBoundary>
									<LeadPanel leadId={card.link.leadId} boardId={boardId} cardId={cardId} />
								</CardErrorBoundary>
							</Box>
						)}
						{card.cardType === 'matter' && (
							<Box mbe={16}>
								<CardErrorBoundary>
									<MatterPanel card={card} />
								</CardErrorBoundary>
							</Box>
						)}
						<Box mbe={10}>
							<Box mbe={4} style={ledgerHead(tone)}>
								{t('Title')}
							</Box>
							<TextInput value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
						</Box>

						<Box mbe={10}>
							<Box mbe={4} style={ledgerHead(tone)}>
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

						<Box fontScale='c1' color='hint' style={tabularFigures}>
							#{card.cardNumber} · {card.cardType}
						</Box>

						<ChecklistPanel boardId={boardId} cardId={cardId} checklists={card.checklists} />
						<SubtasksPanel boardId={boardId} cardId={cardId} card={card} />
						<TimePanel boardId={boardId} cardId={cardId} estimateMinutes={card.timeEstimateMinutes} entries={card.timeEntries ?? []} />
						<CommentsBlock card={card} />
					</Box>
				)}

				{!isLoading && card && tab === 'activity' && <ActivityBlock boardId={boardId} cardId={cardId} />}
			</ContextualbarScrollableContent>
		</>
	);

	// Expanded (matter default / user toggle): render the same styled column at majority width
	// via a plain ContextualbarV2 — NOT the ContextualbarDialog, whose resizable wrapper is hard-
	// capped at 50%. position='static' makes it a normal flex sibling so the kanban Page shrinks
	// beside it. Drawer mode keeps the original ContextualbarDialog (ESC + focus handling intact).
	if (expanded) {
		return (
			<ContextualbarV2 className={expandedBarClass} position='static'>
				{body}
			</ContextualbarV2>
		);
	}

	return <ContextualbarDialog onClose={onClose}>{body}</ContextualbarDialog>;
};

export default CardDetail;
