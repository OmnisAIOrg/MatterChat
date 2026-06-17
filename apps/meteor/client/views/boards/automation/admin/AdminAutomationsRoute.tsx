import { usePermission, useRouteParameter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';

import AdminAutomationsPage from './AdminAutomationsPage';
import NotAuthorizedPage from '../../../notAuthorized/NotAuthorizedPage';

/**
 * AdminAutomationsRoute — the admin route entry for the Automations console
 * (Admin → Automations, route name `admin-boards-automations`,
 * pattern `/admin/boards-automations/:context?`).
 *
 * Gated by `boards-manage-automations` (org-wide governance is a manage-level
 * concern). The `:context?` param selects the tab ('all' default | 'runs').
 *
 * Registered via `registerAdminRoute` — see the WIRING_SCHEMA routes report; the
 * route + the `declare module` path entry + the admin sidebar item are added by
 * Integration (this phase does not edit admin/routes.tsx or admin/sidebarItems.ts).
 */
const AdminAutomationsRoute = (): ReactElement => {
	const canManage = usePermission('boards-manage-automations');
	const context = useRouteParameter('context');

	if (!canManage) {
		return <NotAuthorizedPage />;
	}

	const tab = context === 'runs' ? 'runs' : 'all';

	return <AdminAutomationsPage tab={tab} />;
};

export default AdminAutomationsRoute;
