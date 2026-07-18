import type { FirmFeedKind, IBoardCard, IDirectoryUserResult, IFirmFeedEntry, Serialized } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	CheckBox,
	Field,
	FieldLabel,
	FieldRow,
	FieldError,
	Icon,
	IconButton,
	InputBox,
	Tag,
	TextAreaInput,
	TextInput,
	Throbber,
} from '@rocket.chat/fuselage';
import { UserAvatar } from '@rocket.chat/ui-avatar';
import { GenericModal, Page, PageScrollableContent } from '@rocket.chat/ui-client';
import { usePermission, useEndpoint, useRouter, useSetModal, useToastMessageDispatch, useUser } from '@rocket.chat/ui-contexts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { useId, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
	LEDGER_ACCENT,
	LEDGER_CAPTION_STYLE,
	LEDGER_CARD,
	LEDGER_LABEL_STYLE,
	LEDGER_NUMERIC_STYLE,
	LEDGER_PAPER,
	LEDGER_RULE,
	SOL_HEAT_COLORS,
	solHeatColor,
} from '../boards/lib/ledger';

/**
 * MyDayHomePage — the MatterChat "My Day" command center (Wave 2).
 *
 * Replaces Rocket.Chat's generic getting-started home with a personalized legal
 * dashboard: what's due today, approaching deadlines (SOL), a pipeline snapshot, and a
 * "My matters" quick-jump list. All derived from the Matters pipeline board's cards +
 * their CasePro matter snapshots (single board.cards fetch — no extra endpoints).
 *
 * Wave 2b look: the "Ledger-dense" language (paper ground, serif case-caption headings,
 * one dense tabular stat-bar, SOL heat dots) via the shared `--mc-*` tokens declared in
 * MainLayoutStyleTags.tsx — styling only, all queries/behavior untouched.
 */

const timeGreeting = (): string => {
	const h = new Date().getHours();
	if (h < 12) {
		return 'Good morning';
	}
	if (h < 18) {
		return 'Good afternoon';
	}
	return 'Good evening';
};

const isSameDay = (a: Date, b: Date): boolean =>
	a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const daysUntil = (iso: string): number => {
	const ms = new Date(iso).getTime() - Date.now();
	return Math.ceil(ms / 86400000);
};

const formatCountdown = (days: number): string => {
	if (days < 0) {
		return `${Math.abs(days)}d overdue`;
	}
	if (days === 0) {
		return 'today';
	}
	if (days < 14) {
		return `${days} days`;
	}
	if (days < 60) {
		return `${Math.round(days / 7)} weeks`;
	}
	return `${Math.round(days / 30)} months`;
};

// Same SOL heat tiers as the boards/panel: red ≤30d, amber ≤90d.
const countdownVariant = (days: number): 'danger' | 'warning' | undefined => {
	if (days <= 30) {
		return 'danger';
	}
	if (days <= 90) {
		return 'warning';
	}
	return undefined;
};

type MatterCard = Serialized<IBoardCard>;

type DecoratedMatter = {
	card: MatterCard;
	stage?: string;
	practiceArea?: string;
	clientName?: string;
	solDate?: string;
};

const decorate = (card: MatterCard): DecoratedMatter => {
	if (card.link?.kind === 'matter') {
		const snap = card.link.snapshot;
		return {
			card,
			stage: snap?.stageName,
			practiceArea: snap?.practiceArea,
			clientName: snap?.clientName,
			solDate: snap?.solDate as string | undefined,
		};
	}
	return { card };
};

// Ledger paper card: #fffdf6 face, khaki hairline, serif "case caption" section head,
// tighter padding than the stock card (density is a founder demand).
const SectionCard = ({
	icon,
	title,
	count,
	action,
	children,
}: {
	icon: string;
	title: string;
	count?: number;
	action?: ReactNode;
	children: ReactNode;
}) => (
	<Box borderRadius='x8' borderWidth='default' p={12} mbe={12} style={{ backgroundColor: LEDGER_CARD, borderColor: LEDGER_RULE }}>
		<Box display='flex' alignItems='center' mbe={8}>
			<Icon name={icon as ComponentProps<typeof Icon>['name']} size='x16' mie={6} color='hint' />
			<Box fontScale='p2b' color='default' style={LEDGER_CAPTION_STYLE}>
				{title}
			</Box>
			{typeof count === 'number' && count > 0 && (
				<Box mis={8} fontScale='micro' color='hint' style={LEDGER_NUMERIC_STYLE}>
					{count}
				</Box>
			)}
			{action && <Box mis='auto'>{action}</Box>}
		</Box>
		{children}
	</Box>
);

// One dense stat-bar — bordered segments, tabular numerals, small-caps labels; the
// SOL ≤30d segment is red-accented (number + a 3px heat rule) whenever it is non-zero.
// eslint-disable-next-line react/no-multi-comp -- local presentational subcomponent, kept in-file per the fork-safe confinement rule
const StatBar = ({ stats }: { stats: { label: string; value: number; heat?: 'red' }[] }) => (
	<Box
		display='flex'
		flexWrap='wrap'
		mbe={12}
		borderWidth='default'
		borderRadius='x8'
		style={{ backgroundColor: LEDGER_CARD, borderColor: LEDGER_RULE, overflow: 'hidden' }}
	>
		{stats.map((stat, index) => {
			const accent = stat.heat === 'red' && stat.value > 0 ? SOL_HEAT_COLORS.red : undefined;
			return (
				<Box
					key={stat.label}
					flexGrow={1}
					flexBasis='0'
					pi={12}
					pbs={8}
					pbe={8}
					style={{
						borderInlineStart: index > 0 ? `1px solid ${LEDGER_RULE}` : undefined,
						boxShadow: accent ? `inset 3px 0 0 0 ${accent}` : undefined,
						// MATTERCHAT: phones — the 4-across strip truncated its labels ("ACTIV…");
						// a 140px floor wraps it into a clean 2×2 grid at ≤ ~600px widths.
						minWidth: 'min(140px, 100%)',
					}}
				>
					<Box
						fontScale='h3'
						color={accent ? undefined : 'default'}
						style={{ ...LEDGER_NUMERIC_STYLE, ...(accent ? { color: accent } : {}) }}
					>
						{stat.value}
					</Box>
					<Box color='hint' withTruncatedText style={LEDGER_LABEL_STYLE}>
						{stat.label}
					</Box>
				</Box>
			);
		})}
	</Box>
);

const EmptyLine = ({ children }: { children: ReactNode }) => (
	<Box fontScale='c1' color='hint' pb={4}>
		{children}
	</Box>
);

// ---------------------------------------------------------------------------
// MATTERCHAT: Firm Feed — the admin-managed My Day bulletin
// (📣 announcements, 🎂 birthdays, 🎉 shout-outs). Everyone reads it; only holders
// of the `firm-feed-manage` permission see the inline add / edit / delete controls.
// The list endpoint already orders each kind sensibly (birthdays by upcoming date).
// ---------------------------------------------------------------------------

type FirmFeedEntrySer = Serialized<IFirmFeedEntry>;

/** The three sections rendered on the dashboard; `update` entries live under announcements. */
type FeedSectionKind = 'announcement' | 'birthday' | 'shoutout';

const FIRM_FEED_QUERY_KEY = ['my-day', 'firm-feed'] as const;

const KIND_META: Record<FeedSectionKind, { icon: string; titleKey: string; emptyKey: string; newKey: string }> = {
	announcement: {
		icon: 'balloon-text',
		titleKey: 'Firm_Feed_Announcements',
		emptyKey: 'Firm_Feed_Empty_Announcements',
		newKey: 'Firm_Feed_New_Announcement',
	},
	birthday: { icon: 'balloons', titleKey: 'Firm_Feed_Birthdays', emptyKey: 'Firm_Feed_Empty_Birthdays', newKey: 'Firm_Feed_New_Birthday' },
	shoutout: { icon: 'star', titleKey: 'Firm_Feed_Shoutouts', emptyKey: 'Firm_Feed_Empty_Shoutouts', newKey: 'Firm_Feed_New_Shoutout' },
};

/** Days until the next month/day occurrence of a date (year-agnostic; for birthdays). */
const daysUntilAnniversary = (date: Date): number => {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	let next = new Date(now.getFullYear(), date.getMonth(), date.getDate());
	if (next.getTime() < today.getTime()) {
		next = new Date(now.getFullYear() + 1, date.getMonth(), date.getDate());
	}
	return Math.round((next.getTime() - today.getTime()) / 86400000);
};

const birthdayLabel = (iso: string): string => {
	const d = new Date(iso);
	const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	const days = daysUntilAnniversary(d);
	if (days === 0) {
		return `${md} · today 🎉`;
	}
	if (days === 1) {
		return `${md} · tomorrow`;
	}
	if (days <= 14) {
		return `${md} · in ${days} days`;
	}
	return md;
};

const dateLabel = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

type FirmFeedFormValues = { title: string; body: string; eventDate: string; pinned: boolean };

/** Create/edit modal for a single feed entry. `kind` is fixed per section. */
// eslint-disable-next-line react/no-multi-comp -- local presentational subcomponents, kept in-file per the fork-safe confinement rule
const FirmFeedEditorModal = ({ kind, entry, onClose }: { kind: FirmFeedKind; entry?: FirmFeedEntrySer; onClose: () => void }) => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToast = useToastMessageDispatch();
	const createEntry = useEndpoint('POST', '/v1/firm-feed.create');
	const updateEntry = useEndpoint('POST', '/v1/firm-feed.update');

	const isBirthday = kind === 'birthday';
	// Narrow the (possibly 'update') kind to a section key for KIND_META lookups.
	const sectionKind: FeedSectionKind = kind === 'birthday' || kind === 'shoutout' ? kind : 'announcement';

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<FirmFeedFormValues>({
		defaultValues: {
			title: entry?.title ?? '',
			body: entry?.body ?? '',
			eventDate: entry?.eventDate ? String(entry.eventDate).slice(0, 10) : '',
			pinned: entry?.pinned ?? false,
		},
	});

	const titleId = useId();
	const bodyId = useId();
	const dateId = useId();
	const pinId = useId();

	const onSubmit = async (values: FirmFeedFormValues): Promise<void> => {
		try {
			if (entry) {
				await updateEntry({
					entryId: entry._id,
					title: values.title,
					body: values.body,
					eventDate: values.eventDate,
					pinned: values.pinned,
				});
			} else {
				await createEntry({
					kind,
					title: values.title,
					...(values.body ? { body: values.body } : {}),
					...(values.eventDate ? { eventDate: values.eventDate } : {}),
					pinned: values.pinned,
				});
			}
			await queryClient.invalidateQueries({ queryKey: FIRM_FEED_QUERY_KEY });
			dispatchToast({ type: 'success', message: t('Firm_Feed_Entry_Saved') });
			onClose();
		} catch (error) {
			dispatchToast({ type: 'error', message: error });
		}
	};

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={handleSubmit(onSubmit)} {...props} />}
			title={entry ? t('Firm_Feed_Edit') : t(KIND_META[sectionKind].newKey)}
			confirmText={t('Firm_Feed_Save')}
			cancelText={t('Firm_Feed_Cancel')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting}
		>
			<Field>
				<FieldLabel htmlFor={titleId}>{isBirthday ? t('Name') : t('Firm_Feed_Title')}</FieldLabel>
				<FieldRow>
					<TextInput
						id={titleId}
						{...register('title', { required: t('Required_field', { field: t('Firm_Feed_Title') }) })}
						placeholder={t('Firm_Feed_Title_Placeholder')}
						aria-invalid={errors.title ? 'true' : 'false'}
					/>
				</FieldRow>
				{errors.title && <FieldError>{errors.title.message}</FieldError>}
			</Field>

			<Field mbs={12}>
				<FieldLabel htmlFor={bodyId}>{t('Firm_Feed_Body')}</FieldLabel>
				<FieldRow>
					<TextAreaInput id={bodyId} rows={3} {...register('body')} placeholder={t('Firm_Feed_Body_Placeholder')} />
				</FieldRow>
			</Field>

			<Field mbs={12}>
				<FieldLabel htmlFor={dateId}>{t('Firm_Feed_Date')}</FieldLabel>
				<FieldRow>
					<InputBox
						id={dateId}
						type='date'
						{...register('eventDate', isBirthday ? { required: t('Required_field', { field: t('Firm_Feed_Date') }) } : {})}
						aria-invalid={errors.eventDate ? 'true' : 'false'}
					/>
				</FieldRow>
				{errors.eventDate && <FieldError>{errors.eventDate.message}</FieldError>}
			</Field>

			<Field mbs={12}>
				<FieldRow justifyContent='flex-start'>
					<CheckBox id={pinId} {...register('pinned')} />
					<FieldLabel htmlFor={pinId} mis={8} style={{ cursor: 'pointer' }}>
						{t('Firm_Feed_Pin')}
					</FieldLabel>
				</FieldRow>
			</Field>
		</GenericModal>
	);
};

// eslint-disable-next-line react/no-multi-comp -- local presentational subcomponent, kept in-file per the fork-safe confinement rule
const FeedEntryRow = ({
	entry,
	kind,
	canManage,
	onEdit,
	onDelete,
}: {
	entry: FirmFeedEntrySer;
	kind: FeedSectionKind;
	canManage: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) => {
	const { t } = useTranslation();
	const isBirthday = kind === 'birthday';

	return (
		<Box display='flex' alignItems='flex-start' pb={10} style={{ gap: '8px' }}>
			{entry.pinned && <Icon name='pin-filled' size='x14' color='hint' mbs={2} />}
			<Box flexGrow={1} style={{ minWidth: 0 }}>
				<Box display='flex' alignItems='center' flexWrap='wrap' style={{ gap: '8px' }}>
					<Box fontScale='p2b' color='default' withTruncatedText>
						{entry.title}
					</Box>
					{isBirthday && entry.eventDate && (
						<Tag variant={daysUntilAnniversary(new Date(entry.eventDate)) <= 7 ? 'primary' : undefined}>
							{birthdayLabel(entry.eventDate)}
						</Tag>
					)}
				</Box>
				{entry.body && (
					<Box fontScale='c1' color='hint' mbs={2} style={{ whiteSpace: 'pre-wrap' }}>
						{entry.body}
					</Box>
				)}
				{!isBirthday && entry.eventDate && (
					<Box fontScale='micro' color='hint' mbs={2}>
						{dateLabel(entry.eventDate)}
					</Box>
				)}
			</Box>
			{canManage && (
				<Box display='flex' style={{ gap: '2px', flexShrink: 0 }}>
					<IconButton tiny icon='pencil' aria-label={t('Firm_Feed_Edit')} onClick={onEdit} />
					<IconButton tiny icon='trash' aria-label={t('Firm_Feed_Delete')} onClick={onDelete} />
				</Box>
			)}
		</Box>
	);
};

// eslint-disable-next-line react/no-multi-comp -- local presentational subcomponent, kept in-file per the fork-safe confinement rule
const FeedSection = ({ kind, entries, canManage }: { kind: FeedSectionKind; entries: FirmFeedEntrySer[]; canManage: boolean }) => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const queryClient = useQueryClient();
	const dispatchToast = useToastMessageDispatch();
	const deleteEntry = useEndpoint('POST', '/v1/firm-feed.delete');
	const meta = KIND_META[kind];

	const openEditor = (entry?: FirmFeedEntrySer): void => {
		setModal(<FirmFeedEditorModal kind={kind} entry={entry} onClose={() => setModal(null)} />);
	};

	const confirmDelete = (entry: FirmFeedEntrySer): void => {
		const doDelete = async (): Promise<void> => {
			try {
				await deleteEntry({ entryId: entry._id });
				await queryClient.invalidateQueries({ queryKey: FIRM_FEED_QUERY_KEY });
				dispatchToast({ type: 'success', message: t('Firm_Feed_Entry_Saved') });
			} catch (error) {
				dispatchToast({ type: 'error', message: error });
			} finally {
				setModal(null);
			}
		};
		setModal(
			<GenericModal
				variant='danger'
				title={t('Firm_Feed_Delete')}
				confirmText={t('Firm_Feed_Delete')}
				cancelText={t('Firm_Feed_Cancel')}
				onConfirm={doDelete}
				onCancel={() => setModal(null)}
				onClose={() => setModal(null)}
			>
				{t('Firm_Feed_Delete_Confirm')}
			</GenericModal>,
		);
	};

	const addButton = canManage ? (
		<Button small onClick={() => openEditor()} title={t(meta.newKey)}>
			<Icon name='plus' size='x16' mie={4} />
			{t('Firm_Feed_Add')}
		</Button>
	) : undefined;

	return (
		<SectionCard icon={meta.icon} title={t(meta.titleKey)} count={entries.length} action={addButton}>
			{entries.length === 0 ? (
				<EmptyLine>{t(meta.emptyKey)}</EmptyLine>
			) : (
				entries.map((entry) => (
					<FeedEntryRow
						key={entry._id}
						entry={entry}
						kind={kind}
						canManage={canManage}
						onEdit={() => openEditor(entry)}
						onDelete={() => confirmDelete(entry)}
					/>
				))
			)}
		</SectionCard>
	);
};

const MyDayHomePage = () => {
	const router = useRouter();
	const user = useUser();
	const uid = user?._id;

	const listBoards = useEndpoint('GET', '/v1/boards.list');
	const getCards = useEndpoint('GET', '/v1/boards.cards');
	const directory = useEndpoint('GET', '/v1/directory');
	const listFeed = useEndpoint('GET', '/v1/firm-feed.list');

	// MATTERCHAT: Firm Feed — admin-managed bulletin. Everyone can read; only holders of
	// `firm-feed-manage` see the add/edit/delete controls (server also enforces this).
	const canManageFeed = usePermission('firm-feed-manage');

	const { data: boardsData, isLoading: boardsLoading } = useQuery({
		queryKey: ['my-day', 'boards'],
		queryFn: () => listBoards({}),
	});

	const { data: feedData, isLoading: feedLoading } = useQuery({
		queryKey: FIRM_FEED_QUERY_KEY,
		queryFn: () => listFeed({}),
	});

	const feed = useMemo(() => {
		const entries = (feedData?.entries ?? []) as FirmFeedEntrySer[];
		return {
			announcements: entries.filter((e) => e.kind === 'announcement' || e.kind === 'update'),
			birthdays: entries.filter((e) => e.kind === 'birthday'),
			shoutouts: entries.filter((e) => e.kind === 'shoutout'),
		};
	}, [feedData]);

	const mattersBoard = useMemo(() => {
		const boards = boardsData?.boards ?? [];
		return boards.find((b) => b.pipelineType === 'matters' && !b.archived) ?? boards.find((b) => !b.archived);
	}, [boardsData]);

	const { data: cardsData, isLoading: cardsLoading } = useQuery({
		queryKey: ['my-day', 'cards', mattersBoard?._id],
		queryFn: () => getCards({ boardId: mattersBoard!._id, count: 500 }),
		enabled: Boolean(mattersBoard?._id),
	});

	// Org directory — every MatterChat/CasePro user (auto-provisioned org staff).
	const { data: usersData, isLoading: usersLoading } = useQuery({
		queryKey: ['my-day', 'directory-users'],
		queryFn: () => directory({ type: 'users', count: 200 }),
	});

	const staff = useMemo(
		() =>
			(usersData?.result ?? []).filter((r): r is Serialized<IDirectoryUserResult> => {
				if (!('username' in r) || !r.username) {
					return false;
				}
				// MATTERCHAT: keep system bots out of the Team roster (founder saw "Rocket.Cat"
				// leaking in). rocket.cat is filtered by id/username; roles/type are checked
				// defensively in case the directory payload carries them.
				if (r._id === 'rocket.cat' || r.username === 'rocket.cat') {
					return false;
				}
				const meta = r as Serialized<IDirectoryUserResult> & { roles?: string[]; type?: string };
				if (meta.roles?.includes('bot') || meta.roles?.includes('app')) {
					return false;
				}
				if (meta.type === 'bot' || meta.type === 'app') {
					return false;
				}
				return true;
			}),
		[usersData],
	);

	const derived = useMemo(() => {
		const cards = (cardsData?.cards ?? []).filter((c) => !c.archived);
		const matterCards = cards.filter((c) => c.cardType === 'matter');
		const mineRaw = uid ? matterCards.filter((c) => c.assignees?.includes(uid)) : [];
		// Show the user's own matters; fall back to the whole board for solo/unassigned setups.
		const scope = mineRaw.length > 0 ? mineRaw : matterCards;
		const myMatters = scope.map(decorate);

		const now = new Date();
		const dueToday = scope.filter((c) => c.dueDate && !c.dueComplete && isSameDay(new Date(c.dueDate), now));

		const deadlines = myMatters
			.filter((m) => m.solDate)
			.map((m) => ({ ...m, days: daysUntil(m.solDate as string) }))
			.filter((m) => m.days <= 120)
			.sort((a, b) => a.days - b.days)
			.slice(0, 6);

		const dueThisWeek = scope.filter((c) => c.dueDate && !c.dueComplete && daysUntil(c.dueDate) <= 7 && daysUntil(c.dueDate) >= 0);
		const solRisk = myMatters.filter((m) => m.solDate && daysUntil(m.solDate) <= 30).length;

		return { myMatters, dueToday, deadlines, dueThisWeek, activeMatters: matterCards.length, solRisk };
	}, [cardsData, uid]);

	const openCard = (cardId: string) => {
		if (!mattersBoard?._id) {
			return;
		}
		router.navigate({ name: 'boards-board', params: { id: mattersBoard._id, view: 'board', cardId } });
	};

	const goToBoards = () => router.navigate('/boards');

	const loading = boardsLoading || (Boolean(mattersBoard) && cardsLoading);
	const displayName = user?.name || user?.username || '';

	return (
		<Page color='default' background='tint' style={{ backgroundColor: LEDGER_PAPER }}>
			<PageScrollableContent>
				<Box display='flex' alignItems='flex-end' justifyContent='space-between' flexWrap='wrap' mbe={16} style={{ gap: '12px' }}>
					<Box>
						{/* Serif "case caption" greeting — the ledger heading voice. */}
						<Box is='h1' fontScale='h1' color='default' style={LEDGER_CAPTION_STYLE}>
							{timeGreeting()}
							{displayName ? `, ${displayName}` : ''}
						</Box>
						<Box fontScale='p2' color='hint' mbs={4}>
							{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
							{derived.solRisk > 0 ? ` · ${derived.solRisk} matter${derived.solRisk === 1 ? '' : 's'} with a deadline within 30 days` : ''}
						</Box>
					</Box>
					<Box display='flex' style={{ gap: '8px' }}>
						<Button primary small onClick={goToBoards}>
							<Icon name='plus' size='x16' mie={4} />
							New matter
						</Button>
						<Button small onClick={goToBoards}>
							<Icon name='plus' size='x16' mie={4} />
							New lead
						</Button>
					</Box>
				</Box>

				{loading ? (
					<Box display='flex' justifyContent='center' p={24}>
						<Throbber />
					</Box>
				) : (
					<>
						{/* The DENSE stat-bar — replaces the stacked "Pipeline" stat tiles (same derived
						    numbers, one bordered tabular strip; SOL ≤30d segment red-accented). */}
						<StatBar
							stats={[
								{ label: 'Active matters', value: derived.activeMatters },
								{ label: 'Due today', value: derived.dueToday.length },
								{ label: 'Due this week', value: derived.dueThisWeek.length },
								{ label: 'SOL ≤ 30d', value: derived.solRisk, heat: 'red' },
							]}
						/>
						<Box display='flex' flexWrap='wrap' style={{ gap: '12px' }}>
							<Box flexGrow={2} flexShrink={1} style={{ flexBasis: '320px', minWidth: '280px' }}>
								<SectionCard icon='circle-check' title='Due today' count={derived.dueToday.length}>
									{derived.dueToday.length === 0 ? (
										<EmptyLine>Nothing due today — you&apos;re clear.</EmptyLine>
									) : (
										derived.dueToday.map((c) => (
											<Box
												key={c._id}
												display='flex'
												alignItems='center'
												pb={8}
												style={{ cursor: 'pointer', gap: '8px' }}
												onClick={() => openCard(c._id)}
											>
												<Icon name='circle' size='x12' color='hint' />
												<Box fontScale='p2' color='default' flexGrow={1} withTruncatedText>
													{c.title}
												</Box>
											</Box>
										))
									)}
								</SectionCard>

								<SectionCard icon='clock' title='Approaching deadlines'>
									{derived.deadlines.length === 0 ? (
										<EmptyLine>No statute or filing deadlines in the next few months.</EmptyLine>
									) : (
										derived.deadlines.map((m) => (
											<Box
												key={m.card._id}
												display='flex'
												alignItems='center'
												pb={6}
												style={{ cursor: 'pointer', gap: '8px' }}
												onClick={() => openCard(m.card._id)}
											>
												{/* SOL heat dot — same thresholds as the boards/panel. */}
												<Box
													width='x8'
													height='x8'
													borderRadius='full'
													flexShrink={0}
													aria-hidden='true'
													style={{ backgroundColor: solHeatColor(m.solDate) }}
												/>
												<Box fontScale='p2' color='default' flexGrow={1} withTruncatedText>
													SOL — {m.card.title}
												</Box>
												<Tag variant={countdownVariant(m.days)}>{formatCountdown(m.days)}</Tag>
											</Box>
										))
									)}
								</SectionCard>
							</Box>

							<Box flexGrow={1} flexShrink={1} style={{ flexBasis: '240px', minWidth: '240px' }}>
								{/* Pipeline numbers moved up into the dense StatBar; green stays the action color. */}
								<SectionCard icon='bell' title='Activity'>
									<Box fontScale='p2' style={{ color: LEDGER_ACCENT, cursor: 'pointer' }} onClick={() => router.navigate('/boards/inbox')}>
										Open your activity inbox →
									</Box>
								</SectionCard>
							</Box>
						</Box>

						<SectionCard icon='folder' title='My matters' count={derived.myMatters.length}>
							{derived.myMatters.length === 0 ? (
								<EmptyLine>No matters yet. Create one to get started.</EmptyLine>
							) : (
								derived.myMatters.slice(0, 8).map((m) => (
									// Compact single-row strip: SOL heat dot (green >90d / amber ≤90 / red ≤30,
									// khaki when no SOL on file) + title with the practice area inline.
									<Box
										key={m.card._id}
										display='flex'
										alignItems='center'
										pb={6}
										style={{ cursor: 'pointer', gap: '8px' }}
										onClick={() => openCard(m.card._id)}
									>
										<Box
											width='x8'
											height='x8'
											borderRadius='full'
											flexShrink={0}
											aria-hidden='true'
											style={{ backgroundColor: solHeatColor(m.solDate) }}
										/>
										<Box fontScale='p2' color='default' flexGrow={1} withTruncatedText>
											{m.card.title}
											{m.practiceArea && (
												<Box is='span' fontScale='c1' color='hint'>
													{` · ${m.practiceArea}`}
												</Box>
											)}
										</Box>
										{m.stage && <Tag>{m.stage}</Tag>}
										{m.solDate && <Tag variant={countdownVariant(daysUntil(m.solDate))}>SOL {formatCountdown(daysUntil(m.solDate))}</Tag>}
										<Icon name='chevron-right' size='x16' color='hint' />
									</Box>
								))
							)}
						</SectionCard>
					</>
				)}

				{/* MATTERCHAT: Firm Feed — admin-managed bulletin (announcements / birthdays / shout-outs) */}
				{feedLoading ? (
					<Box display='flex' justifyContent='center' p={16}>
						<Throbber />
					</Box>
				) : (
					<Box display='flex' flexWrap='wrap' style={{ gap: '12px' }}>
						<Box flexGrow={2} flexShrink={1} style={{ flexBasis: '360px', minWidth: '280px' }}>
							<FeedSection kind='announcement' entries={feed.announcements} canManage={canManageFeed} />
						</Box>
						<Box flexGrow={1} flexShrink={1} style={{ flexBasis: '260px', minWidth: '240px' }}>
							<FeedSection kind='birthday' entries={feed.birthdays} canManage={canManageFeed} />
						</Box>
						<Box flexGrow={1} flexShrink={1} style={{ flexBasis: '260px', minWidth: '240px' }}>
							<FeedSection kind='shoutout' entries={feed.shoutouts} canManage={canManageFeed} />
						</Box>
					</Box>
				)}

				<SectionCard icon='team' title='Team' count={staff.length}>
					{usersLoading ? (
						<Box display='flex' justifyContent='center' p={8}>
							<Throbber />
						</Box>
					) : staff.length === 0 ? (
						<EmptyLine>No teammates found yet.</EmptyLine>
					) : (
						<Box display='flex' flexWrap='wrap' style={{ gap: '6px' }}>
							{staff.map((u) => (
								<Box
									key={u._id}
									display='flex'
									alignItems='center'
									pb={6}
									pi={8}
									borderRadius='x8'
									style={{ gap: '8px', cursor: 'pointer', width: '224px' }}
									onClick={() => u.username && router.navigate({ name: 'direct', params: { rid: u.username } })}
								>
									<UserAvatar username={u.username ?? ''} size='x36' />
									<Box style={{ minWidth: 0 }}>
										<Box fontScale='p2' color='default' withTruncatedText>
											{u.name || u.username}
										</Box>
										{u.username && (
											<Box fontScale='micro' color='hint' withTruncatedText>
												@{u.username}
											</Box>
										)}
									</Box>
								</Box>
							))}
						</Box>
					)}
				</SectionCard>
			</PageScrollableContent>
		</Page>
	);
};

export default MyDayHomePage;
