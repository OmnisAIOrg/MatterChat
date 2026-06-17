/**
 * Boards M8 — generic views client barrel (Table / Timeline / Dashboard + the
 * saved-view switcher).
 *
 * BoardRouter renders the view body by route `:view` type and passes the active
 * saved-view id; BoardHeader hosts <ViewSwitcher/>. Saved-view CRUD goes through
 * `boards.views.*`; the card rows/groups come from `boards.views.cards`.
 */
export { default as ViewSwitcher } from './ViewSwitcher';
export { default as TableView } from './TableView';
export { default as TimelineView } from './TimelineView';
export { default as DashboardView } from './DashboardView';
export { default as SaveViewModal } from './SaveViewModal';
export { useSavedViews, SAVED_VIEWS_KEY } from './lib/useSavedViews';
export { useBoardViewCards, boardViewCardsKey } from './lib/useBoardViewCards';
