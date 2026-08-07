import type { IAutomation, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Icon, Tabs, TabsItem } from '@rocket.chat/fuselage';
import {
	ContextualbarClose,
	ContextualbarDialog,
	ContextualbarHeader,
	ContextualbarScrollableContent,
	ContextualbarTitle,
} from '@rocket.chat/ui-client';
import { usePermission } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutomationActivity from './AutomationActivity';
import AutomationList from './AutomationList';
import TemplateGallery from './TemplateGallery';
import AutomationBuilder from './builder/AutomationBuilder';
import type { AutomationTab } from './lib/catalog';
import { TAB_KIND } from './lib/catalog';

/**
 * AutomationsContextualBar — the per-board automation manager (M7 client, primary
 * surface). Opened from the board header "Automations" action (see BoardHeader).
 *
 * Tabs: Rules · Card Buttons · Board Buttons · Scheduled · Sequences · Activity.
 *  - the kind tabs render an AutomationList filtered to that kind + an "Add" button
 *    that opens the AutomationBuilder inline (within the same contextualbar);
 *  - Activity renders the run-log (AutomationActivity) for the whole board.
 *
 * Permissions: list is visible to anyone who can open the board; the enable toggle
 * + create/edit are gated by `boards-manage-automations`; running a button by
 * `boards-run-automation`; the Activity tab by `boards-view-automation-runs`. These
 * mirror the engine's permissionsUsed.
 */

type AutomationsContextualBarProps = {
	boardId: string;
	onClose: () => void;
};

const TAB_ORDER: { tab: AutomationTab; labelKey: string }[] = [
	{ tab: 'rules', labelKey: 'Boards_Automation_Rules' },
	{ tab: 'card-buttons', labelKey: 'Boards_Automation_Card_Buttons' },
	{ tab: 'board-buttons', labelKey: 'Boards_Automation_Board_Buttons' },
	{ tab: 'scheduled', labelKey: 'Boards_Automation_Scheduled_Plural' },
	{ tab: 'sequences', labelKey: 'Boards_Automation_Sequences' },
	{ tab: 'templates', labelKey: 'Boards_Automation_Templates' },
	{ tab: 'activity', labelKey: 'Boards_Automation_Activity' },
];

const AutomationsContextualBar = ({ boardId, onClose }: AutomationsContextualBarProps): ReactElement => {
	const { t } = useTranslation();

	const canManage = usePermission('boards-manage-automations');
	const canRun = usePermission('boards-run-automation');
	const canViewRuns = usePermission('boards-view-automation-runs');

	const [tab, setTab] = useState<AutomationTab>('rules');
	// when set, the builder is open (either a kind for a new automation, or an existing doc)
	const [editing, setEditing] = useState<{ existing?: Serialized<IAutomation> } | null>(null);

	const kind = tab !== 'activity' && tab !== 'templates' ? TAB_KIND[tab] : undefined;

	const listQueryKey = useMemo(() => ['boards', 'automations', boardId, kind ?? 'all'] as const, [boardId, kind]);
	const runsQueryKey = useMemo(() => ['boards', 'automation-runs', boardId] as const, [boardId]);
	// installing a template clones a kind:'rule' automation; invalidate the Rules tab list key.
	const rulesQueryKey = useMemo(() => ['boards', 'automations', boardId, 'rule'] as const, [boardId]);

	const tabs = useMemo(() => (canViewRuns ? TAB_ORDER : TAB_ORDER.filter((tabitem) => tabitem.tab !== 'activity')), [canViewRuns]);

	const closeBuilder = (): void => setEditing(null);

	return (
		<ContextualbarDialog onClose={onClose}>
			<ContextualbarHeader>
				<Icon name='lightning' size='x20' marginInlineEnd={4} />
				<ContextualbarTitle>{t('Boards_Automations', { defaultValue: 'Automations' })}</ContextualbarTitle>
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>

			{!editing && (
				<Tabs>
					{tabs.map(({ tab: tabKey, labelKey }) => (
						<TabsItem key={tabKey} selected={tab === tabKey} onClick={() => setTab(tabKey)}>
							{t(labelKey as Parameters<typeof t>[0])}
						</TabsItem>
					))}
				</Tabs>
			)}

			<ContextualbarScrollableContent>
				{editing ? (
					<AutomationBuilder
						boardId={boardId}
						kind={kind ?? 'rule'}
						existing={editing.existing}
						listQueryKey={listQueryKey}
						onClose={closeBuilder}
					/>
				) : (
					<>
						{tab === 'activity' && canViewRuns && <AutomationActivity boardId={boardId} queryKey={runsQueryKey} />}

						{tab === 'templates' && <TemplateGallery boardId={boardId} canManage={canManage} rulesQueryKey={rulesQueryKey} />}

						{tab !== 'activity' && tab !== 'templates' && (
							<Box>
								{canManage && (
									<Box display='flex' justifyContent='flex-end' marginBlockEnd={8}>
										<Button small primary onClick={() => setEditing({})}>
											<Icon name='plus' size='x16' marginInlineEnd={4} />
											{t('Boards_Automation_New', { defaultValue: 'New' })}
										</Button>
									</Box>
								)}
								<AutomationList
									boardId={boardId}
									kind={kind}
									queryKey={listQueryKey}
									canManage={canManage}
									canRun={canRun}
									onEdit={canManage ? (existing) => setEditing({ existing }) : undefined}
								/>
							</Box>
						)}
					</>
				)}
			</ContextualbarScrollableContent>
		</ContextualbarDialog>
	);
};

export default AutomationsContextualBar;
