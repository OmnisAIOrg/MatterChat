// Side-effect import: registers the Admin → Automations console route
// (`admin-boards-automations`, pattern `/admin/boards-automations/:context?`) on the
// existing admin route group. The boards group is loaded at startup via
// main.ts -> import('./views/boards'), so importing it here installs the route at boot
// without editing admin/routes.tsx (M7 automation client phase).
import './automation/admin/registerAdminAutomationsRoute';

export { registerBoardsRoute } from './routes';
export { registerBoardsSidebarItem, unregisterSidebarItem } from './sidebarItems';
