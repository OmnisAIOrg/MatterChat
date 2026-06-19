import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * A persisted, switchable Boards view (Tier 5, collection `boards_saved_views`).
 * Powers the M8 generic view switcher: a board can be looked at as a kanban,
 * a table, a timeline, a calendar, or a dashboard, each with its own saved
 * filters / grouping / sort / visible columns. A view is owned by a user but
 * may be `shared` to the board (and `isDefault` to auto-open).
 *
 * `scope` says how broadly the view applies:
 * - 'board'    : tied to one board (`boardId` set).
 * - 'pipeline' : applies to a pipeline of boards (cross-board Matters/Leads roll-up; `boardId` may be unset).
 * - 'personal' : a private cross-board power view (`boardId` unset).
 *
 * `config` is the view payload. Kept as a typed-but-open struct (the same
 * convention the automation conditions use) so adding a filter/operator does
 * not force a core-typings change.
 */

export type SavedViewScope = 'board' | 'pipeline' | 'personal';

export type SavedViewType = 'board' | 'table' | 'timeline' | 'calendar' | 'dashboard';

export interface ISavedViewConfig {
	/** Filter map: assignee/label/cardType/due/sol/field ops — interpreted by the view. */
	filters?: Record<string, unknown>;
	/** Group cards by a card field or fieldDef id (e.g. 'list','assignee','label','field:<id>'). */
	groupBy?: string;
	/** Sort key (e.g. 'position','dueDate','-cardNumber','field:<id>'). */
	sort?: string;
	/** Card/field ids shown as columns in the Table view (and chips elsewhere). */
	visibleFields?: string[];
	/** Which date field the Calendar/Timeline view plots ('dueDate','startDate','sol', field id). */
	dateField?: string;
}

export interface ISavedView extends IRocketChatRecord {
	userId: IUser['_id'];
	boardId?: string; // -> boards_boards._id; unset for cross-board pipeline/personal views

	scope: SavedViewScope;
	name: string;
	viewType: SavedViewType;
	config: ISavedViewConfig;

	shared?: boolean; // visible to the whole board, not just the owner
	isDefault?: boolean; // auto-opened view for this board/scope

	archived: boolean;
	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
}
