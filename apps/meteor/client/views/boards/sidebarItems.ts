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
		href: '/boards/leads',
		i18nLabel: 'Boards_Leads',
		icon: 'magnifier',
		permissionGranted: (): boolean => hasPermission('boards-leads-view'),
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
]);
