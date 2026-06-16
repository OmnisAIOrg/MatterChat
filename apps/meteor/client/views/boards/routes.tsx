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
		'boards-matters': {
			pathname: `/boards/matters${`/${string}` | ''}`;
			pattern: '/boards/matters/:cardId?';
		};
		'boards-leads': {
			pathname: `/boards/leads${`/${string}` | ''}`;
			pattern: '/boards/leads/:cardId?';
		};
		'boards-inbox': {
			pathname: '/boards/inbox';
			pattern: '/boards/inbox';
		};
		'boards-planner': {
			pathname: '/boards/planner';
			pattern: '/boards/planner';
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

// Matters pillar (M3a): the matters-pipeline board (13 CasePro stages) + CasePro snapshot panel.
registerBoardsRoute('/matters/:cardId?', {
	name: 'boards-matters',
	component: lazy(() => import('./matters/MattersBoardRoute')),
});

// Leads/Intake pillar (M3b): the 8-stage intake board + lead capture + intake panel.
registerBoardsRoute('/leads/:cardId?', {
	name: 'boards-leads',
	component: lazy(() => import('./leads/LeadsBoardRoute')),
});
