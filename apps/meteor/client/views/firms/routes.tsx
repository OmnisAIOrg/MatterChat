import { lazy } from 'react';

import { appLayout } from '../../lib/appLayout';
import { router } from '../../providers/RouterProvider';
import MainLayout from '../root/MainLayout';

const FirmConsolePage = lazy(() => import('./console/FirmConsolePage'));
const FirmDomainVerifyPage = lazy(() => import('./FirmDomainVerifyPage'));

/**
 * MATTERCHAT: routes for the self-serve firms surface.
 *
 * Kept in the feature's own directory (the pattern `views/boards/routes.tsx`
 * established) rather than added to `startup/routes.tsx`, so the file merges
 * clean against upstream forever. Registration happens because `main.ts`
 * imports `./views/firms`, exactly as it does for boards and litbox.
 *
 * Both routes sit inside `MainLayout`, which is what supplies
 * `AuthenticationCheck` — and both endpoints behind them are `authRequired`, so
 * an anonymous visitor should meet the login screen and land here afterwards
 * rather than see a page that cannot work.
 *
 * `/firm-domain/verify/:token` is not a nicety: `sendFirmDomainVerification`
 * mails that exact path, and without this route every verification email in the
 * product pointed at the 404 page.
 */
declare module '@rocket.chat/ui-contexts' {
	interface IRouterPaths {
		'firm-console': {
			pathname: '/firm-console';
			pattern: '/firm-console';
		};
		'firm-domain-verify': {
			pathname: `/firm-domain/verify/${string}`;
			pattern: '/firm-domain/verify/:token';
		};
	}
}

router.defineRoutes([
	{
		path: '/firm-console',
		id: 'firm-console',
		element: appLayout.wrap(
			<MainLayout>
				<FirmConsolePage />
			</MainLayout>,
		),
	},
	{
		path: '/firm-domain/verify/:token',
		id: 'firm-domain-verify',
		element: appLayout.wrap(
			<MainLayout>
				<FirmDomainVerifyPage />
			</MainLayout>,
		),
	},
]);
