import type { IBoardCard, IPlaybookTemplate, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Icon, ProgressBar, Select, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MatterSection from './MatterSection';

type PlaybooksSectionProps = {
	cardId: string;
	checklists: Serialized<IBoardCard>['checklists'];
};

/**
 * Playbooks — checklist-progress for every checklist on the card (a stage
 * playbook materializes named checklists), plus an "apply playbook" picker
 * (`boards.matters.playbooks.list` / `.apply`). The hidden `__playbook:<id>`
 * marker checklists the server stamps for idempotency are filtered out.
 *
 * Polish over the original: per-checklist percentage label, a completed
 * check-mark, and an explicit empty state that tells the user what applying a
 * playbook will do.
 */
const PlaybooksSection = ({ cardId, checklists }: PlaybooksSectionProps): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();
	const [selected, setSelected] = useState<string | undefined>(undefined);

	const listPlaybooks = useEndpoint('GET', '/v1/boards.matters.playbooks.list');
	const applyPlaybook = useEndpoint('POST', '/v1/boards.matters.playbooks.apply');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'matters', 'playbooks', 'list'],
		queryFn: () => listPlaybooks({}),
	});

	const playbooks = useMemo<Serialized<IPlaybookTemplate>[]>(
		() => (data?.playbooks as Serialized<IPlaybookTemplate>[] | undefined)?.filter((p) => p.enabled) ?? [],
		[data],
	);

	const options = useMemo<[string, string][]>(() => playbooks.map((p) => [p._id, p.name] as [string, string]), [playbooks]);

	// Visible checklists exclude the hidden idempotency markers.
	const visibleChecklists = useMemo(() => checklists.filter((c) => !c.title.startsWith('__playbook:')), [checklists]);

	const applyMutation = useMutation({
		mutationFn: (playbookId: string) => applyPlaybook({ cardId, playbookId }),
		onSuccess: (result) => {
			const { checklistItemsAdded, deadlinesCreated } = result.result;
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Matters_Playbook_Applied_Result', {
					items: checklistItemsAdded,
					deadlines: deadlinesCreated,
					defaultValue: 'Applied playbook ({{items}} items, {{deadlines}} deadlines)',
				}),
			});
			setSelected(undefined);
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'matters', 'deadlines', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	return (
		<MatterSection title={t('Boards_Matters_Playbooks', { defaultValue: 'Playbooks' })} icon='book'>
			{visibleChecklists.length === 0 && (
				<Box fontScale='c1' color='hint' mbe={8}>
					{t('Boards_Matters_Playbook_None', {
						defaultValue: 'No playbook applied yet. Applying one adds its checklist items and deadlines to this card.',
					})}
				</Box>
			)}

			{visibleChecklists.map((checklist) => {
				const total = checklist.items.length;
				const done = checklist.items.filter((i) => i.done).length;
				const pct = total > 0 ? Math.round((done / total) * 100) : 0;
				return (
					<Box key={checklist.id} mbe={12}>
						<Box display='flex' justifyContent='space-between' alignItems='center' mbe={4}>
							<Box display='flex' alignItems='center' style={{ minWidth: 0 }}>
								{pct === 100 && <Icon name='check' size='x14' mie={4} color='status-font-on-success' />}
								<Box fontScale='p2' color='default' withTruncatedText>
									{checklist.title}
								</Box>
							</Box>
							<Box fontScale='c1' color='hint' style={{ flexShrink: 0 }}>
								{done}/{total} · {pct}%
							</Box>
						</Box>
						<ProgressBar percentage={pct} variant={pct === 100 ? 'success' : 'info'} />
					</Box>
				);
			})}

			{/* Apply playbook picker */}
			<Box display='flex' alignItems='center' mbs={8} style={{ gap: '8px' }}>
				<Box flexGrow={1}>
					<Select
						small
						placeholder={isLoading ? t('Loading') : t('Boards_Matters_Playbook', { defaultValue: 'Playbook' })}
						value={selected ?? null}
						options={options}
						disabled={isLoading || options.length === 0 || applyMutation.isPending}
						onChange={(value): void => setSelected(value as string)}
					/>
				</Box>
				<Button small primary disabled={!selected || applyMutation.isPending} onClick={() => selected && applyMutation.mutate(selected)}>
					{applyMutation.isPending ? (
						<Throbber inheritColor size='x12' />
					) : (
						t('Boards_Matters_Playbook_Apply', { defaultValue: 'Apply playbook' })
					)}
				</Button>
			</Box>
		</MatterSection>
	);
};

export default PlaybooksSection;
