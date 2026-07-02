import { Box, Button, Icon, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useRouter, useSetModal } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SubscribeCalendarModal from './SubscribeCalendarModal';

/**
 * Generic personal Calendar — your tasks plotted on a month grid by due date, across ALL your
 * boards. Reuses the CasePro-free `boards.cards.myDay` feed (every assigned card with a due date).
 * Milestones render as ◆; completed cards are struck through; high/urgent priority is tinted.
 * Standalone — not tied to legal matters (the Matters deadline calendar is separate).
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const BoardsCalendar = () => {
	const { t } = useTranslation();
	const router = useRouter();
	const setModal = useSetModal();
	const getMyDay = useEndpoint('GET', '/v1/boards.cards.myDay' as any, undefined as never);

	const openSubscribe = useCallback(() => {
		setModal(<SubscribeCalendarModal onClose={() => setModal(null)} />);
	}, [setModal]);
	const { data, isLoading } = useQuery({ queryKey: ['boards', 'myDay'], queryFn: () => getMyDay({}) });
	const cards: any[] = (data as any)?.cards || [];

	const now = new Date();
	const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });

	const byDate = useMemo(() => {
		const map: Record<string, any[]> = {};
		for (const c of cards) {
			if (!c.dueDate) continue;
			const k = ymd(new Date(c.dueDate));
			(map[k] ||= []).push(c);
		}
		return map;
	}, [cards]);

	const weeks = useMemo(() => {
		const first = new Date(ym.y, ym.m, 1);
		const start = new Date(first);
		start.setDate(1 - first.getDay());
		const cells: Date[] = [];
		for (let i = 0; i < 42; i += 1) {
			const d = new Date(start);
			d.setDate(start.getDate() + i);
			cells.push(d);
		}
		const w: Date[][] = [];
		for (let i = 0; i < 42; i += 7) w.push(cells.slice(i, i + 7));
		return w;
	}, [ym]);

	const openCard = (c: any) => router.navigate({ name: 'boards-board', params: { id: c.boardId, view: 'board', cardId: c._id } } as any);
	const shift = (n: number) => setYm((p) => { const d = new Date(p.y, p.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
	const todayKey = ymd(now);

	return (
		<Box p={24} style={{ overflowY: 'auto', height: '100%' }}>
			<Box display='flex' alignItems='center' mbe={12}>
				<Box fontScale='h2' flexGrow={1}>{MONTHS[ym.m]} {ym.y}</Box>
				<Button small mie={4} icon='calendar' onClick={openSubscribe} title={t('Boards_Subscribe_Calendar', { defaultValue: 'Subscribe in your calendar' })}>{t('Boards_Subscribe_Calendar_Button', { defaultValue: 'Subscribe' })}</Button>
				<Button small mie={4} title='Previous month' onClick={() => shift(-1)}><Icon name='chevron-left' size='x16' /></Button>
				<Button small mie={4} onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Today</Button>
				<Button small title='Next month' onClick={() => shift(1)}><Icon name='chevron-right' size='x16' /></Button>
			</Box>
			<Box fontScale='c1' color='hint' mbe={12}>Your tasks by due date, across all your boards. ◆ = milestone · struck‑through = done.</Box>
			{isLoading && <Throbber />}
			<Box display='flex' mbe={4}>
				{DAYS.map((d) => (
					<Box key={d} flexGrow={1} flexBasis={0} fontScale='c1' color='hint' style={{ textAlign: 'center' }}>{d}</Box>
				))}
			</Box>
			{weeks.map((week, wi) => (
				<Box key={wi} display='flex'>
					{week.map((day) => {
						const k = ymd(day);
						const inMonth = day.getMonth() === ym.m;
						const dayCards = byDate[k] || [];
						return (
							<Box
								key={k}
								flexGrow={1}
								flexBasis={0}
								style={{
									minHeight: 94,
									minWidth: 0,
									width: 'calc(100% / 7)',
									boxSizing: 'border-box',
									border: '1px solid var(--rcx-color-stroke-extra-light, #eee)',
									padding: 4,
									background: k === todayKey ? 'var(--rcx-color-surface-tint, #f2f3f5)' : 'transparent',
									opacity: inMonth ? 1 : 0.4,
									overflow: 'hidden',
								}}
							>
								<Box fontScale='c1' color={k === todayKey ? 'default' : 'hint'} style={{ fontWeight: k === todayKey ? 700 : 400 }}>{day.getDate()}</Box>
								{dayCards.slice(0, 4).map((c: any) => (
									<Box
										key={c._id}
										onClick={() => openCard(c)}
										title={c.title}
										fontScale='c1'
										style={{
											cursor: 'pointer',
											whiteSpace: 'nowrap',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											borderRadius: 3,
											padding: '1px 4px',
											marginTop: 2,
											background:
												c.priority === 'urgent' || c.priority === 'high'
													? 'var(--rcx-color-status-background-danger, #ffe3e3)'
													: 'var(--rcx-color-surface-neutral, #e9edf0)',
											textDecoration: c.completed || c.dueComplete ? 'line-through' : 'none',
										}}
									>
										{c.isMilestone ? '◆ ' : ''}{c.title}
									</Box>
								))}
								{dayCards.length > 4 && <Box fontScale='c1' color='hint' style={{ marginTop: 2 }}>+{dayCards.length - 4} more</Box>}
							</Box>
						);
					})}
				</Box>
			))}
		</Box>
	);
};

export default BoardsCalendar;
