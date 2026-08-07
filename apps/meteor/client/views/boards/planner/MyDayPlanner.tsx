import { Box, Button, Icon, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useRouter } from '@rocket.chat/ui-contexts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { monoLabel, serifCaption, tabularNums, useLedgerTones } from '../lib/ledgerTheme';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * "My Day" — personal-productivity view: everything assigned to you, bucketed by due date, across
 * ALL your boards. Standalone / CasePro-free (the list needs only card titles + due dates). The
 * `/boards/planner` route renders this; it is general-purpose, not tied to legal matters.
 *
 * LEDGER-DENSE SKIN (style-only): paper ground, serif caption + bucket heads,
 * dense paper-card rows with a heat rail (red for overdue/urgent — same
 * conditions as before, green when on plan), tabular due dates.
 */
const MyDayPlanner = () => {
	const tones = useLedgerTones();
	const router = useRouter();
	const qc = useQueryClient();
	const getMyDay = useEndpoint('GET', '/v1/boards.cards.myDay' as any, undefined as never);
	const updateCard = useEndpoint('POST', '/v1/boards.card.update' as any, undefined as never);
	const setRecEndpoint = useEndpoint('POST', '/v1/boards.card.recurrence.set' as any, undefined as never);

	const { data, isLoading } = useQuery({ queryKey: ['boards', 'myDay'], queryFn: () => getMyDay({}), refetchInterval: 30000 });
	const cards: any[] = data?.cards || [];

	const markDone = useMutation({
		mutationFn: (cardId: string) => updateCard({ cardId, patch: { dueComplete: true } } as any),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['boards', 'myDay'] }),
	});

	const setRec = useMutation({
		mutationFn: ({ cardId, freq }: { cardId: string; freq: string }) =>
			setRecEndpoint((freq ? { cardId, recurrence: { freq, interval: 1 } } : { cardId, recurrence: null }) as any),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['boards', 'myDay'] }),
	});

	const buckets = useMemo(() => {
		const today = startOfDay(new Date());
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const weekEnd = new Date(today);
		weekEnd.setDate(weekEnd.getDate() + 7);
		const open = cards.filter((c) => !c.dueComplete && !c.completed && c.dueDate);
		const at = (c: any) => new Date(c.dueDate);
		return [
			{ label: 'Overdue', danger: true, list: open.filter((c) => at(c) < today) },
			{ label: 'Today', danger: false, list: open.filter((c) => at(c) >= today && at(c) < tomorrow) },
			{ label: 'This week', danger: false, list: open.filter((c) => at(c) >= tomorrow && at(c) < weekEnd) },
			{ label: 'Later', danger: false, list: open.filter((c) => at(c) >= weekEnd) },
		];
	}, [cards]);

	const openCard = (c: any) => router.navigate({ name: 'boards-board', params: { id: c.boardId, view: 'board', cardId: c._id } } as any);
	const openCount = cards.filter((c) => !c.dueComplete && !c.completed && c.dueDate).length;

	return (
		<Box padding={24} style={{ overflowY: 'auto', height: '100%', background: tones.paper }}>
			<Box fontScale='h2' style={serifCaption}>
				My Day
			</Box>
			<Box fontScale='c1' marginBlockEnd={20} style={{ color: tones.inkMuted }}>
				Everything assigned to you, by when it&apos;s due — across all your boards. Works with or without CasePro.
			</Box>
			{isLoading && <Throbber />}
			{!isLoading && openCount === 0 && (
				<Box fontScale='p2' style={{ color: tones.inkMuted }}>
					Nothing due. You&apos;re all clear. 🎉
				</Box>
			)}
			{buckets.map(
				(b) =>
					b.list.length > 0 && (
						<Box key={b.label} marginBlockEnd={16}>
							<Box display='flex' alignItems='center' marginBlockEnd={6}>
								<Box fontScale='h4' marginInlineEnd={8} style={serifCaption}>
									{b.label}
								</Box>
								<Box is='span' style={{ ...monoLabel(tones), fontWeight: 400 }}>
									({b.list.length})
								</Box>
							</Box>
							{b.list.map((c: any) => {
								const hot = b.danger || c.priority === 'urgent' || c.priority === 'high';
								return (
									<Box
										key={c._id}
										display='flex'
										alignItems='center'
										padding={8}
										marginBlockEnd={4}
										style={{
											background: tones.card,
											border: `1px solid ${tones.strokeSoft}`,
											borderRadius: 4,
											boxShadow: `inset 3px 0 0 0 ${hot ? tones.red : tones.green}`,
										}}
									>
										<Button mini marginInlineEnd={8} title='Mark done' onClick={() => markDone.mutate(c._id)}>
											<Icon name='check' size='x16' />
										</Button>
										<Box flexGrow={1} style={{ cursor: 'pointer' }} onClick={() => openCard(c)}>
											<Box fontScale='p2'>
												{c.title}
												{c.recurrence ? ' ↻' : ''}
											</Box>
											<Box fontScale='c1' style={{ ...tabularNums, color: hot ? tones.red : tones.inkMuted }}>
												Due {new Date(c.dueDate).toLocaleDateString()}
												{c.priority ? ` · ${c.priority} priority` : ''}
												{c.recurrence ? ` · repeats ${c.recurrence.freq}` : ''}
												{c.cardType && c.cardType !== 'task' ? ` · ${c.cardType}` : ''}
											</Box>
										</Box>
										<select
											title='Repeat'
											value={c.recurrence?.freq || ''}
											onChange={(e) => setRec.mutate({ cardId: c._id, freq: e.currentTarget.value })}
											style={{
												marginInlineStart: 8,
												border: `1px solid ${tones.stroke}`,
												borderRadius: 3,
												padding: '1px 4px',
												background: 'transparent',
												color: 'inherit',
												fontSize: 11,
												cursor: 'pointer',
											}}
										>
											<option value=''>No repeat</option>
											<option value='daily'>Daily</option>
											<option value='weekly'>Weekly</option>
											<option value='monthly'>Monthly</option>
										</select>
									</Box>
								);
							})}
						</Box>
					),
			)}
		</Box>
	);
};

export default MyDayPlanner;
