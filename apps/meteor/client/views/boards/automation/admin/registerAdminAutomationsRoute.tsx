import { lazy } from 'react';

import { registerAdminRoute } from '../../../admin/routes';

/**
 * Registers the Admin → Automations console route on the existing admin route group.
 *
 * This file lives in the automation feature's ownership and mirrors the registration
 * idiom of `client/views/admin/routes.tsx` (the `registerAdminRoute(path, {...})`
 * calls + the `declare module '@rocket.chat/ui-contexts'` path entry). Keeping it
 * here means the admin routes.tsx file is NOT edited by this phase.
 *
 * WIRING (reported to Integration): for the route to be installed at boot, this
 * module must be imported once for its side-effect. The minimal hook is a single line
 * in `client/views/boards/index.ts`:
 *     import './automation/admin/registerAdminAutomationsRoute';
 * (the boards group is already loaded at startup via main.ts -> import('./views/boards')).
 *
 * Route name `admin-boards-automations`, pattern `/admin/boards-automations/:context?`
 * ('all' default tab | 'runs'). Gated in the page by `boards-manage-automations`.
 */

declare module '@rocket.chat/ui-contexts' {
	interface IRouterPaths {
		'admin-boards-automations': {
			pathname: `/admin/boards-automations${`/${string}` | ''}`;
			pattern: '/admin/boards-automations/:context?';
		};
	}
}

registerAdminRoute('/boards-automations/:context?', {
	name: 'admin-boards-automations',
	component: lazy(() => import('./AdminAutomationsRoute')),
});
