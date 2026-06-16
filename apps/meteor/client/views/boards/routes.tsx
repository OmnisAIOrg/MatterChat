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
			pathname: '/boards/matters';
			pattern: '/boards/matters';
		};
		'boards-leads': {
			pathname: '/boards/leads';
			pattern: '/boards/leads';
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
