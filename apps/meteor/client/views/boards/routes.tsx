import { lazy } from 'react';

import { createRouteGroup } from '../../lib/createRouteGroup';

declare module '@rocket.chat/ui-contexts' {
	interface IRouterPaths {
		'boards-index': {
			pathname: '/boards';
			pattern: '/boards';
		};
		'boards-board': {
			pathname: `/boards/board/${string}${`/${string}` | ''}${`/${string}` | ''}`;
			pattern: '/boards/board/:id/:view?/:cardId?';
		};
		'boards-matters-calendar': {
			pathname: '/boards/matters/calendar';
			pattern: '/boards/matters/calendar';
		};
		'boards-matters-caseload': {
			pathname: '/boards/matters/caseload';
			pattern: '/boards/matters/caseload';
		};
		'boards-matters-reports': {
			pathname: '/boards/matters/reports';
			pattern: '/boards/matters/reports';
		};
		'boards-matters': {
			pathname: `/boards/matters${`/${string}` | ''}`;
			pattern: '/boards/matters/:cardId?';
		};
		'boards-leads-templates': {
			pathname: '/boards/leads/templates';
			pattern: '/boards/leads/templates';
		};
		'boards-leads-referrals': {
			pathname: '/boards/leads/referrals';
			pattern: '/boards/leads/referrals';
		};
		'boards-leads-marketing': {
			pathname: '/boards/leads/marketing';
			pattern: '/boards/leads/marketing';
		};
		'boards-leads-reports': {
			pathname: '/boards/leads/reports';
			pattern: '/boards/leads/reports';
		};
		'boards-leads': {
			pathname: `/boards/leads${`/${string}` | ''}`;
			pattern: '/boards/leads/:cardId?';
		};
		'boards-reports-source-to-settlement': {
			pathname: '/boards/reports/source-to-settlement';
			pattern: '/boards/reports/source-to-settlement';
		};
		'boards-inbox': {
			pathname: '/boards/inbox';
			pattern: '/boards/inbox';
		};
		'boards-planner': {
			pathname: '/boards/planner';
			pattern: '/boards/planner';
		};
		'boards-calendar': {
			pathname: '/boards/calendar';
			pattern: '/boards/calendar';
		};
	}
}

export const registerBoardsRoute = createRouteGroup(
	'boards',
	'/boards',
	lazy(() => import('./BoardsRouter')),
);

// The Boards home (board grid + templates + "New board") lives at /boards.
// Re-registers the group index so /boards renders BoardsRouter > BoardsHome
// (the bare group index auto-created by createRouteGroup renders no child).
// The KanbanUI phase owns ./BoardsHome.tsx (default export).
registerBoardsRoute('', {
	name: 'boards-index',
	component: lazy(() => import('./BoardsHome')),
});

// A single board view; :view ∈ board|calendar|table, :cardId deep-links the card drawer.
// The KanbanUI phase owns ./BoardRouter.tsx (default export).
registerBoardsRoute('/board/:id/:view?/:cardId?', {
	name: 'boards-board',
	component: lazy(() => import('./BoardRouter')),
});

// Matters depth (M5): board-wide deadline/SOL agenda, caseload by assignee, and reports.
// These literal sub-paths MUST be registered BEFORE the '/matters/:cardId?' catch-all below,
// otherwise 'calendar'/'caseload'/'reports' would be matched as a :cardId.
registerBoardsRoute('/matters/calendar', {
	name: 'boards-matters-calendar',
	component: lazy(() => import('./matters/calendar/MattersCalendar')),
});

registerBoardsRoute('/matters/caseload', {
	name: 'boards-matters-caseload',
	component: lazy(() => import('./matters/caseload/Caseload')),
});

registerBoardsRoute('/matters/reports', {
	name: 'boards-matters-reports',
	component: lazy(() => import('./matters/reports/MattersReports')),
});

// Matters pillar (M3a): the matters-pipeline board (13 CasePro stages) + CasePro snapshot panel.
registerBoardsRoute('/matters/:cardId?', {
	name: 'boards-matters',
	component: lazy(() => import('./matters/MattersBoardRoute')),
});

// Leads depth (M6): comm templates/sequences, referral sources & referrals-out, marketing ROI, intake reports.
// Literal sub-paths registered BEFORE the '/leads/:cardId?' catch-all for the same reason as above.
registerBoardsRoute('/leads/templates', {
	name: 'boards-leads-templates',
	component: lazy(() => import('./leads/templates/TemplatesView')),
});

registerBoardsRoute('/leads/referrals', {
	name: 'boards-leads-referrals',
	component: lazy(() => import('./leads/referrals/ReferralsView')),
});

registerBoardsRoute('/leads/marketing', {
	name: 'boards-leads-marketing',
	component: lazy(() => import('./leads/marketing/MarketingView')),
});

registerBoardsRoute('/leads/reports', {
	name: 'boards-leads-reports',
	component: lazy(() => import('./leads/reports/LeadsReports')),
});

// Leads/Intake pillar (M3b): the 8-stage intake board + lead capture + intake panel.
registerBoardsRoute('/leads/:cardId?', {
	name: 'boards-leads',
	component: lazy(() => import('./leads/LeadsBoardRoute')),
});

// Reporting (M8): the cross-pipeline source-to-settlement attribution dashboard
// (differentiators §7 closed loop). A literal sub-path with no ':cardId?' sibling,
// so it never collides with the matters/leads catch-alls above.
registerBoardsRoute('/reports/source-to-settlement', {
	name: 'boards-reports-source-to-settlement',
	component: lazy(() => import('./reports/SourceToSettlement')),
});

// Personal PM (standalone / CasePro-free): "My Day" — my cards by due date across all my boards.
registerBoardsRoute('/planner', {
	name: 'boards-planner',
	component: lazy(() => import('./planner/MyDayPlanner')),
});

// Generic personal Calendar — my tasks on a month grid by due date (standalone, CasePro-free).
registerBoardsRoute('/calendar', {
	name: 'boards-calendar',
	component: lazy(() => import('./calendar/BoardsCalendar')),
});

// Activity / Notifications inbox — the full-page version of the NavBar bell's dropdown.
// The 'boards-inbox' path type (above) was declared but never registered, so the left-rail
// "Activity" item, the Boards sidebar "Inbox" item, and the My Day "activity inbox" link all
// navigated to /boards/inbox and hit the 404 NotFoundPage. NotificationsInbox is the same
// component the bell drops down; mounted as a route its onNavigate (panel-close) prop is a no-op.
registerBoardsRoute('/inbox', {
	name: 'boards-inbox',
	component: lazy(() => import('./notifications/NotificationsInbox')),
});
