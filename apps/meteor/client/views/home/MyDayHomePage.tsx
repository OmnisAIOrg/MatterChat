import type { IBoardCard, IDirectoryUserResult, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { UserAvatar } from '@rocket.chat/ui-avatar';
import { Page, PageScrollableContent } from '@rocket.chat/ui-client';
import { useEndpoint, useRouter, useUser } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { useMemo } from 'react';

/**
 * MyDayHomePage — the MatterChat "My Day" command center (Wave 2).
 *
 * Replaces Rocket.Chat's generic getting-started home with a personalized legal
 * dashboard: what's due today, approaching deadlines (SOL), a pipeline snapshot, and a
 * "My matters" quick-jump list. All derived from the Matters pipeline board's cards +
 * their CasePro matter snapshots (single board.cards fetch — no extra endpoints).
 */

const BRAND_RED = '#e1140a';

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

const countdownVariant = (days: number): 'danger' | undefined => (days <= 30 ? 'danger' : undefined);

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

const SectionCard = ({ icon, title, count, children }: { icon: string; title: string; count?: number; children: ReactNode }) => (
	<Box bg='light' borderRadius='x12' borderWidth='default' borderColor='extra-light' p={16} mbe={16}>
		<Box display='flex' alignItems='center' mbe={12}>
			<Icon name={icon as ComponentProps<typeof Icon>['name']} size='x18' mie={8} color='hint' />
			<Box fontScale='p2b' color='default'>
				{title}
			</Box>
			{typeof count === 'number' && count > 0 && (
				<Box mis={8} fontScale='micro' color='hint'>
					{count}
				</Box>
			)}
		</Box>
		{children}
	</Box>
);

const EmptyLine = ({ children }: { children: ReactNode }) => (
	<Box fontScale='c1' color='hint' pb={4}>
		{children}
	</Box>
);

const MyDayHomePage = () => {
	const router = useRouter();
	const user = useUser();
	const uid = user?._id;

	const listBoards = useEndpoint('GET', '/v1/boards.list');
	const getCards = useEndpoint('GET', '/v1/boards.cards');
	const directory = useEndpoint('GET', '/v1/directory');

	const { data: boardsData, isLoading: boardsLoading } = useQuery({
		queryKey: ['my-day', 'boards'],
		queryFn: () => listBoards({}),
	});

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
		() => (usersData?.result ?? []).filter((r): r is Serialized<IDirectoryUserResult> => 'username' in r && Boolean(r.username)),
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
		<Page color='default' background='tint'>
			<PageScrollableContent>
				<Box display='flex' alignItems='flex-end' justifyContent='space-between' flexWrap='wrap' mbe={20} style={{ gap: '12px' }}>
					<Box>
						<Box is='h1' fontScale='h1' color='default'>
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
						<Box display='flex' flexWrap='wrap' style={{ gap: '16px' }}>
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
												pb={8}
												style={{ cursor: 'pointer', gap: '8px' }}
												onClick={() => openCard(m.card._id)}
											>
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
								<SectionCard icon='dashboard' title='Pipeline'>
									<Box display='flex' justifyContent='space-between' style={{ textAlign: 'center' }}>
										<Box>
											<Box fontScale='h2' color='default'>
												{derived.activeMatters}
											</Box>
											<Box fontScale='micro' color='hint'>
												Active matters
											</Box>
										</Box>
										<Box>
											<Box fontScale='h2' color='default'>
												{derived.dueThisWeek.length}
											</Box>
											<Box fontScale='micro' color='hint'>
												Due this week
											</Box>
										</Box>
										<Box>
											<Box fontScale='h2' style={{ color: BRAND_RED }}>
												{derived.solRisk}
											</Box>
											<Box fontScale='micro' color='hint'>
												SOL ≤ 30d
											</Box>
										</Box>
									</Box>
								</SectionCard>

								<SectionCard icon='bell' title='Activity'>
									<Box
										fontScale='p2'
										style={{ color: BRAND_RED, cursor: 'pointer' }}
										onClick={() => router.navigate('/boards/inbox')}
									>
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
									<Box
										key={m.card._id}
										display='flex'
										alignItems='center'
										pb={10}
										style={{ cursor: 'pointer', gap: '12px' }}
										onClick={() => openCard(m.card._id)}
									>
										<Box flexGrow={1} style={{ minWidth: 0 }}>
											<Box fontScale='p2' color='default' withTruncatedText>
												{m.card.title}
											</Box>
											{m.practiceArea && (
												<Box fontScale='micro' color='hint'>
													{m.practiceArea}
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
