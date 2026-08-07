import { Box, Callout, Tabs, TabsItem } from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AutomationActivity from '../AutomationActivity';
import AutomationList from '../AutomationList';

/**
 * AdminAutomationsPage — the org-wide automation governance console (M7 client,
 * Admin → Automations). Mounted inside the AdministrationRouter via the admin route
 * group (see routes report). Two tabs driven by the `:context?` route param:
 *  - "all"  (default): every automation across all boards + globals (AutomationList
 *    with showScope, boardId omitted so the server returns the full set);
 *  - "runs": the global run log (AutomationActivity with no boardId).
 *
 * Both reuse the same components the per-board contextualbar uses. Editing happens in
 * the board contextualbar (board context resolves the list/label/member pickers), so
 * the admin list is read + enable-toggle only (no onEdit). A deep-link to the engine
 * settings group is surfaced as a banner.
 */

type AdminTab = 'all' | 'runs';

type AdminAutomationsPageProps = {
	tab?: AdminTab;
};

const AdminAutomationsPage = ({ tab = 'all' }: AdminAutomationsPageProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();

	const listQueryKey = useMemo(() => ['boards', 'admin-automations', 'all'] as const, []);
	const runsQueryKey = useMemo(() => ['boards', 'admin-automation-runs'] as const, []);

	const goTo = (next: AdminTab): void => {
		router.navigate({ name: 'admin-boards-automations', params: { context: next } });
	};

	return (
		<Page>
			<PageHeader title={t('Boards_Automations', { defaultValue: 'Automations' })} />
			<Tabs>
				<TabsItem selected={tab === 'all'} onClick={() => goTo('all')}>
					{t('Boards_Automation_AllAutomations', { defaultValue: 'All automations' })}
				</TabsItem>
				<TabsItem selected={tab === 'runs'} onClick={() => goTo('runs')}>
					{t('Boards_Automation_RunLog', { defaultValue: 'Run log' })}
				</TabsItem>
			</Tabs>
			<PageScrollableContentWithShadow>
				<Box marginBlockEnd={16}>
					<Callout type='info' icon='info' title={t('Boards_Automation_AdminHint_Title', { defaultValue: 'Engine settings' })}>
						{t('Boards_Automation_AdminHint_Body', {
							defaultValue:
								'Loop-guard budgets, the firm timezone, CasePro write-back and SMS gates live under Admin → Settings → Automation.',
						})}
					</Callout>
				</Box>

				{tab === 'all' && <AutomationList queryKey={listQueryKey} canManage canRun showScope />}

				{tab === 'runs' && <AutomationActivity queryKey={runsQueryKey} />}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default AdminAutomationsPage;
