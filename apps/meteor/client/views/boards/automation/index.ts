/**
 * Public surface of the Boards Automation UI (M7 client).
 *
 * - BoardAutomationsButton: the one-line launcher for the per-board manager, dropped
 *   into a board header ButtonGroup (see WIRING_SCHEMA insertion points).
 * - AutomationsContextualBar: the manager itself (if a board view wants to own the
 *   open state instead of using the button).
 *
 * The Admin console route registers itself via a side-effect import of
 * `./admin/registerAdminAutomationsRoute` (reported to Integration).
 */
export { default as BoardAutomationsButton } from './BoardAutomationsButton';
export { default as AutomationsContextualBar } from './AutomationsContextualBar';
