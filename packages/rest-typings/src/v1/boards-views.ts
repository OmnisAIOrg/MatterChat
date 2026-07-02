import type { IBoardCard, ISavedView, SavedViewType, SavedViewScope } from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';

/**
 * REST validators + endpoint types for Boards SAVED VIEWS (M8 — the generic view
 * switcher: Board / Table / Timeline / Calendar / Dashboard).
 *
 * `boards.views.list`       — the caller's own + shared views on a board.
 * `boards.views.upsert`     — create/update a saved view (gated boards-manage-saved-views).
 * `boards.views.remove`     — soft-archive a saved view.
 * `boards.views.setDefault` — make a view the auto-opened default for its board+scope.
 * `boards.views.cards`      — run a saved view's filters/groupBy/sort over the board's
 *                             cards for the Table/Timeline/Dashboard views to render.
 *
 * The `config` carried by `upsert` is kept PERMISSIVE (typed-but-open `ISavedViewConfig`)
 * mirroring how `boards-automations.ts` treats the automation document — the service
 * owns shape, ajv guards the wire surface. Reads are gated server-side by `boards-view`.
 */

const VIEW_TYPES: SavedViewType[] = ['board', 'table', 'timeline', 'calendar', 'dashboard'];
const VIEW_SCOPES: SavedViewScope[] = ['board', 'pipeline', 'personal'];

// ---------------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------------

type BoardsViewsListProps = { boardId: string };

const BoardsViewsListSchema = {
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsViewsListProps = ajvQuery.compile<BoardsViewsListProps>(BoardsViewsListSchema);

// ---------------------------------------------------------------------------
// GET — cards (run a saved view, or an empty config, over a board)
// ---------------------------------------------------------------------------

type BoardsViewsCardsProps = {
	boardId: string;
	viewId?: string;
	viewType?: string;
	/** opt-in flat paging over the sorted cards (standard RC envelope). Omit both = full set. */
	offset?: number;
	count?: number;
	/** opt-in per-group cap: each group returns at most N cards + exact total/hasMore. */
	groupLimit?: number;
};

const BoardsViewsCardsSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		viewId: { type: 'string', nullable: true },
		viewType: { type: 'string', nullable: true },
		offset: { type: 'number', nullable: true },
		count: { type: 'number', nullable: true },
		groupLimit: { type: 'number', nullable: true },
	},
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsViewsCardsProps = ajvQuery.compile<BoardsViewsCardsProps>(BoardsViewsCardsSchema);

// ---------------------------------------------------------------------------
// POST — upsert
// ---------------------------------------------------------------------------

type BoardsViewsUpsertProps = {
	viewId?: string;
	name: string;
	viewType: SavedViewType;
	scope: SavedViewScope;
	boardId?: string;
	config?: Record<string, unknown>;
	shared?: boolean;
	isDefault?: boolean;
};

const BoardsViewsUpsertSchema = {
	type: 'object',
	properties: {
		viewId: { type: 'string', nullable: true },
		name: { type: 'string', minLength: 1 },
		viewType: { type: 'string', enum: VIEW_TYPES },
		scope: { type: 'string', enum: VIEW_SCOPES },
		boardId: { type: 'string', nullable: true },
		// permissive view config: filters/groupBy/sort/visibleFields/dateField.
		config: { type: 'object', nullable: true, additionalProperties: true },
		shared: { type: 'boolean', nullable: true },
		isDefault: { type: 'boolean', nullable: true },
	},
	required: ['name', 'viewType', 'scope'],
	additionalProperties: false,
};

export const isBoardsViewsUpsertProps = ajv.compile<BoardsViewsUpsertProps>(BoardsViewsUpsertSchema);

// ---------------------------------------------------------------------------
// POST — remove / setDefault (by viewId)
// ---------------------------------------------------------------------------

type BoardsViewsByIdProps = { viewId: string };

const BoardsViewsByIdSchema = {
	type: 'object',
	properties: { viewId: { type: 'string', minLength: 1 } },
	required: ['viewId'],
	additionalProperties: false,
};

export const isBoardsViewsRemoveProps = ajv.compile<BoardsViewsByIdProps>(BoardsViewsByIdSchema);
export const isBoardsViewsSetDefaultProps = ajv.compile<BoardsViewsByIdProps>(BoardsViewsByIdSchema);

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type BoardCardGroupDTO = {
	key: string;
	label: string;
	cards: IBoardCard[];
	/** full bucket size — `cards` may be capped by `groupLimit`, this never is. */
	total?: number;
	/** true when `groupLimit` cut this bucket. */
	hasMore?: boolean;
};

export type QueryBoardCardsResultDTO = {
	boardId: string;
	viewType: SavedViewType;
	cards: IBoardCard[];
	groups?: BoardCardGroupDTO[];
	total: number;
	/** echoed when the caller opted into flat paging. */
	offset?: number;
	dateField?: string;
};

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type BoardsViewsEndpoints = {
	'/v1/boards.views.list': {
		GET: (params: BoardsViewsListProps) => { views: ISavedView[] };
	};
	'/v1/boards.views.upsert': {
		POST: (params: BoardsViewsUpsertProps) => { view: ISavedView; created: boolean };
	};
	'/v1/boards.views.remove': {
		POST: (params: BoardsViewsByIdProps) => { ok: true };
	};
	'/v1/boards.views.setDefault': {
		POST: (params: BoardsViewsByIdProps) => { view: ISavedView };
	};
	'/v1/boards.views.cards': {
		GET: (params: BoardsViewsCardsProps) => { result: QueryBoardCardsResultDTO };
	};
};
