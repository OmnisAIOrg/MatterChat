import { lazy } from 'react';

import { createRouteGroup } from '../../lib/createRouteGroup';

declare module '@rocket.chat/ui-contexts' {
	interface IRouterPaths {
		'litbox-index': {
			pathname: '/litbox';
			pattern: '/litbox';
		};
	}
}

// `/litbox` → the embedded LitBox "Files" screen. Registered at boot via
// main.ts -> import('./views/litbox'), mirroring how the Boards group is wired.
export const registerLitboxRoute = createRouteGroup('litbox', '/litbox', lazy(() => import('./LitboxFilesView')));
