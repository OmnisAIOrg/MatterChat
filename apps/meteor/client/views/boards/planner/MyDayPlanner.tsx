import { Box, Button, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useRouter } from '@rocket.chat/ui-contexts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * "My Day" — personal-productivity view: everything assigned to you, bucketed by due date, across
 * ALL your boards. Standalone / CasePro-free (the list needs only card titles + due dates). The
 * `/boards/planner` route renders this; it is general-purpose, not tied to legal matters.
 */
const MyDayPlanner = () => {
	const router = useRouter();
	const qc = useQueryClient();
	const getMyDay = useEndpoint('GET', '/v1/boards.cards.myDay' as any, undefined as never);
	const updateCard = useEndpoint('POST', '/v1/boards.card.update' as any, undefined as never);
	const setRecEndpoint = useEndpoint('POST', '/v1/boards.card.recurrence.set' as any, undefined as never);

	const { data, isLoading } = useQuery({ queryKey: ['boards', 'myDay'], queryFn: () => getMyDay({}), refetchInterval: 30000 });
	const cards: any[] = (data as any)?.cards || [];

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
		const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
		const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
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
		<Box p={24} style={{ overflowY: 'auto', height: '100%' }}>
			<Box fontScale='h2'>My Day</Box>
			<Box fontScale='c1' color='hint' mbe={20}>Everything assigned to you, by when it&apos;s due — across all your boards. Works with or without CasePro.</Box>
			{isLoading && <Throbber />}
			{!isLoading && openCount === 0 && <Box color='hint' fontScale='p2'>Nothing due. You&apos;re all clear. 🎉</Box>}
			{buckets.map((b) => b.list.length > 0 && (
				<Box key={b.label} mbe={20}>
					<Box display='flex' alignItems='center' mbe={8}><Box fontScale='h4' mie={8}>{b.label}</Box><Tag>{b.list.length}</Tag></Box>
					{b.list.map((c: any) => (
						<Box key={c._id} display='flex' alignItems='center' p={10} mbe={6} style={{ background: 'var(--rcx-color-surface-tint, #f2f3f5)', borderRadius: '4px' }}>
							<Button mini mie={8} title='Mark done' onClick={() => markDone.mutate(c._id)}><Icon name='check' size='x16' /></Button>
							<Box flexGrow={1} style={{ cursor: 'pointer' }} onClick={() => openCard(c)}>
								<Box fontScale='p2'>{c.title}{c.recurrence ? ' ↻' : ''}</Box>
								<Box fontScale='c1' color={c.priority === 'urgent' || c.priority === 'high' ? 'danger' : b.danger ? 'danger' : 'hint'}>Due {new Date(c.dueDate).toLocaleDateString()}{c.priority ? ` · ${c.priority} priority` : ''}{c.recurrence ? ` · repeats ${c.recurrence.freq}` : ''}{c.cardType && c.cardType !== 'task' ? ` · ${c.cardType}` : ''}</Box>
							</Box>
							<select
								title='Repeat'
								value={c.recurrence?.freq || ''}
								onChange={(e) => setRec.mutate({ cardId: c._id, freq: e.currentTarget.value })}
								style={{ marginInlineStart: 8, border: '1px solid var(--rcx-color-stroke-light, #cbced1)', borderRadius: 4, padding: '2px 4px', background: 'transparent', fontSize: 12, cursor: 'pointer' }}
							>
								<option value=''>No repeat</option>
								<option value='daily'>Daily</option>
								<option value='weekly'>Weekly</option>
								<option value='monthly'>Monthly</option>
							</select>
						</Box>
					))}
				</Box>
			))}
		</Box>
	);
};

export default MyDayPlanner;
