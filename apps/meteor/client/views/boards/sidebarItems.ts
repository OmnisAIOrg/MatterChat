import { hasPermission } from '../../../app/authorization/client';
import { createSidebarItems } from '../../lib/createSidebarItems';

export const {
	registerSidebarItem: registerBoardsSidebarItem,
	unregisterSidebarItem,
	getSidebarItems: getBoardsSidebarItems,
	subscribeToSidebarItems: subscribeToBoardsSidebarItems,
} = createSidebarItems([
	{
		href: '/boards/matters',
		i18nLabel: 'Boards_Matters',
		icon: 'bag',
		permissionGranted: (): boolean => hasPermission('boards-matters-view'),
	},
	{
		href: '/boards/matters/calendar',
		i18nLabel: 'Boards_Matters_Deadlines',
		icon: 'calendar',
		permissionGranted: (): boolean => hasPermission('boards-matters-view'),
	},
	{
		href: '/boards/matters/caseload',
		i18nLabel: 'Boards_Matters_Caseload',
		icon: 'team',
		permissionGranted: (): boolean => hasPermission('boards-matters-view'),
	},
	{
		href: '/boards/matters/reports',
		i18nLabel: 'Boards_Matters_Reports',
		icon: 'dashboard',
		permissionGranted: (): boolean => hasPermission('boards-matters-reports-view'),
	},
	{
		href: '/boards/leads',
		i18nLabel: 'Boards_Leads',
		icon: 'magnifier',
		permissionGranted: (): boolean => hasPermission('boards-leads-view'),
	},
	{
		href: '/boards/leads/templates',
		i18nLabel: 'Boards_Leads_Templates',
		icon: 'mail',
		permissionGranted: (): boolean => hasPermission('boards-leads-templates-manage'),
	},
	{
		href: '/boards/leads/referrals',
		i18nLabel: 'Boards_Leads_Referrals_Out',
		icon: 'user-plus',
		permissionGranted: (): boolean => hasPermission('boards-leads-referrals-manage'),
	},
	{
		href: '/boards/leads/marketing',
		i18nLabel: 'Boards_Leads_Marketing_ROI',
		icon: 'dashboard',
		permissionGranted: (): boolean => hasPermission('boards-leads-marketing-manage'),
	},
	{
		href: '/boards/leads/reports',
		i18nLabel: 'Boards_Leads_Report_Funnel',
		icon: 'report',
		permissionGranted: (): boolean => hasPermission('boards-leads-reports-view'),
	},
	{
		href: '/boards/reports/source-to-settlement',
		i18nLabel: 'Boards_Reports_SourceToSettlement',
		icon: 'dashboard',
		permissionGranted: (): boolean => hasPermission('boards-view-reports'),
	},
	{
		divider: true,
		i18nLabel: 'Boards_General',
	},
	{
		href: '/boards',
		i18nLabel: 'Boards_All',
		icon: 'squares',
		permissionGranted: (): boolean => hasPermission('boards-view'),
	},
	{
		href: '/boards/inbox',
		i18nLabel: 'Boards_Inbox',
		icon: 'inbox',
		tag: 'Beta',
		permissionGranted: (): boolean => hasPermission('boards-view'),
	},
	{
		href: '/boards/planner',
		i18nLabel: 'Boards_Planner',
		icon: 'calendar',
		tag: 'Beta',
		permissionGranted: (): boolean => hasPermission('boards-view'),
	},
	{
		href: '/boards/calendar',
		i18nLabel: 'Calendar',
		icon: 'calendar',
		tag: 'Beta',
		permissionGranted: (): boolean => hasPermission('boards-view'),
	},
]);
