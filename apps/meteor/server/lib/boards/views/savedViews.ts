import type { IBoardCard, ISavedView, ISavedViewConfig, OmnisCardQuery, SavedViewType, SavedViewScope } from '@rocket.chat/core-typings';
import { BoardsSavedViews, BoardsCards, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { getBoardForUser } from '../permissions';

/**
 * Saved-views service (M8 — views power-user persistence; 06-data-model §4.4).
 *
 * Backs the generic board view switcher: a board can be looked at as a kanban
 * (`board`), a `table`, a `timeline`, a `calendar`, or a `dashboard`, each with its
 * own saved filters / grouping / sort / visible fields. A view is owned by a user but
 * may be `shared` to the whole board and/or `isDefault` (auto-opened).
 *
 * Permission model (HARD RULE — gate every mutation):
 *  - READS  (`list`, `get`, `queryBoardCards`)  → `boards-view` + board visibility.
 *  - WRITES (`upsert`, `remove`, `setDefault`)   → `boards-manage-saved-views`
 *    + board visibility + per-view OWNERSHIP (a user edits only their own views,
 *    unless they hold global `boards-admin`).
 *
 * Audit (HARD RULE — audit every mutation): board-scoped views write a
 * `BoardsActivities` row (verb `field.changed`, `to.kind:'saved-view'` — the generic
 * config-change verb the referrals service also uses; the activity verb union is
 * closed and owned elsewhere). Board-less `personal`/`pipeline` views have no board to
 * anchor an activity row to, so the per-doc `rev` bump is their audit trail.
 */

type SavedViewInput = {
	name: string;
	viewType: SavedViewType;
	scope: SavedViewScope;
	boardId?: string;
	config: ISavedViewConfig;
	shared?: boolean;
	isDefault?: boolean;
};

const METHOD = {
	list: 'boards.views.list',
	get: 'boards.views.get',
	upsert: 'boards.views.upsert',
	remove: 'boards.views.remove',
	setDefault: 'boards.views.setDefault',
	cards: 'boards.views.cards',
} as const;

/** Best-effort board-scoped audit row for a saved-view mutation. Never throws. */
async function logViewActivity(
	uid: string,
	view: Pick<ISavedView, '_id' | 'boardId' | 'name' | 'viewType' | 'scope'>,
	op: 'created' | 'updated' | 'removed' | 'set-default',
): Promise<void> {
	if (!view.boardId) {
		return; // personal/pipeline views aren't anchored to a board feed
	}
	try {
		await BoardsActivities.log({
			boardId: view.boardId,
			actor: uid,
			verb: 'field.changed',
			to: { kind: 'saved-view', op, viewId: view._id, name: view.name, viewType: view.viewType, scope: view.scope },
			ts: new Date(),
		});
	} catch {
		// audit is best-effort; never block the view mutation on a log failure.
	}
}

/**
 * Load a saved view by id or throw the canonical not-found. For mutations also asserts
 * the caller owns it (or is a global boards-admin) — the model finder is not
 * user-scoped, so ownership is enforced here.
 */
async function requireOwnView(uid: string, viewId: string, method: string): Promise<ISavedView> {
	const view = await BoardsSavedViews.findById(viewId);
	if (!view || view.archived) {
		throw new Meteor.Error('error-saved-view-not-found', 'Saved view not found', { method });
	}
	if (view.userId !== uid && !(await hasPermissionAsync(uid, 'boards-admin'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method });
	}
	return view;
}

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------

/**
 * Views the caller may pick on a board: their own + any shared on that board. Gated by
 * `boards-view` and board visibility (`getBoardForUser`).
 */
export async function listSavedViews(uid: string, boardId: string): Promise<ISavedView[]> {
	if (!(await hasPermissionAsync(uid, 'boards-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.list });
	}
	await getBoardForUser(boardId, uid, METHOD.list);
	return BoardsSavedViews.findForUserAndBoard(uid, boardId).toArray();
}

/** Single saved view by id (the switcher hydrates the selected config). */
export async function getSavedView(uid: string, viewId: string): Promise<ISavedView> {
	if (!(await hasPermissionAsync(uid, 'boards-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.get });
	}
	const view = await BoardsSavedViews.findById(viewId);
	if (!view || view.archived) {
		throw new Meteor.Error('error-saved-view-not-found', 'Saved view not found', { method: METHOD.get });
	}
	// visible if the caller owns it, it's shared, or they're a board admin.
	if (view.userId !== uid && !view.shared && !(await hasPermissionAsync(uid, 'boards-admin'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.get });
	}
	if (view.boardId) {
		await getBoardForUser(view.boardId, uid, METHOD.get);
	}
	return view;
}

// ---------------------------------------------------------------------------
// upsert / remove / setDefault
// ---------------------------------------------------------------------------

/**
 * Create or update a saved view. Gated by `boards-manage-saved-views`. On create the
 * view is owned by the caller; on update only the owner (or a board admin) may write.
 * When the view is board-scoped, board visibility is asserted. If `isDefault` is set
 * here, sibling defaults on the same board+scope are cleared so at most one default
 * remains.
 */
export async function upsertSavedView(
	uid: string,
	input: SavedViewInput,
	viewId?: string,
): Promise<{ view: ISavedView; created: boolean }> {
	if (!(await hasPermissionAsync(uid, 'boards-manage-saved-views'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.upsert });
	}
	if (input.boardId) {
		await getBoardForUser(input.boardId, uid, METHOD.upsert);
	}

	// on update, assert ownership before touching the doc.
	if (viewId) {
		await requireOwnView(uid, viewId, METHOD.upsert);
	}

	const view = await BoardsSavedViews.upsert(
		{
			userId: uid,
			name: input.name,
			viewType: input.viewType,
			scope: input.scope,
			config: input.config,
			...(input.boardId !== undefined ? { boardId: input.boardId } : {}),
			...(input.shared !== undefined ? { shared: input.shared } : {}),
			...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
			...(viewId ? {} : { createdBy: uid }),
		},
		viewId,
	);

	// keep at most one default per board+scope when this upsert set the flag.
	if (input.isDefault && view.boardId) {
		await clearSiblingDefaults(uid, view);
	}

	await logViewActivity(uid, view, viewId ? 'updated' : 'created');
	return { view, created: !viewId };
}

/** Soft-archive a saved view. Gated by `boards-manage-saved-views` + ownership. */
export async function removeSavedView(uid: string, viewId: string): Promise<{ ok: true }> {
	if (!(await hasPermissionAsync(uid, 'boards-manage-saved-views'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.remove });
	}
	const view = await requireOwnView(uid, viewId, METHOD.remove);
	await BoardsSavedViews.remove(viewId);
	await logViewActivity(uid, view, 'removed');
	return { ok: true };
}

/**
 * Make a view the default for its board+scope (auto-opened by the switcher). Clears
 * the flag on the caller's other views for the same board+scope first, so exactly one
 * default remains. Gated by `boards-manage-saved-views` + ownership.
 */
export async function setDefaultSavedView(uid: string, viewId: string): Promise<{ view: ISavedView }> {
	if (!(await hasPermissionAsync(uid, 'boards-manage-saved-views'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.setDefault });
	}
	const view = await requireOwnView(uid, viewId, METHOD.setDefault);
	if (view.boardId) {
		await getBoardForUser(view.boardId, uid, METHOD.setDefault);
	}

	await clearSiblingDefaults(uid, view);
	const updated = await BoardsSavedViews.upsert(
		{ userId: uid, name: view.name, viewType: view.viewType, scope: view.scope, config: view.config, isDefault: true },
		viewId,
	);
	await logViewActivity(uid, updated, 'set-default');
	return { view: updated };
}

/**
 * Clear `isDefault` on the caller's OTHER views sharing this view's board + scope.
 * The sparse `{boardId,isDefault}` index does not enforce uniqueness, so single-default
 * is maintained here in JS. Best-effort and owner-scoped.
 */
async function clearSiblingDefaults(uid: string, view: Pick<ISavedView, '_id' | 'boardId' | 'scope'>): Promise<void> {
	if (!view.boardId) {
		return;
	}
	const siblings = await BoardsSavedViews.findForUserAndBoard(uid, view.boardId).toArray();
	for (const s of siblings) {
		if (s._id !== view._id && s.userId === uid && s.scope === view.scope && s.isDefault) {
			await BoardsSavedViews.upsert(
				{ userId: uid, name: s.name, viewType: s.viewType, scope: s.scope, config: s.config, isDefault: false },
				s._id,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// queryBoardCards — apply a saved view's config over boards_cards
// ---------------------------------------------------------------------------

export type BoardCardGroup = {
	key: string;
	label: string;
	cards: IBoardCard[];
	/** full bucket size — `cards` may be capped to `groupLimit`, this never is. */
	total: number;
	/** true when `groupLimit` cut this bucket (cards.length < total). */
	hasMore: boolean;
};

export type QueryBoardCardsResult = {
	boardId: string;
	viewType: SavedViewType;
	cards: IBoardCard[];
	/** present when `config.groupBy` is set: cards bucketed by the group key, ordered. */
	groups?: BoardCardGroup[];
	total: number;
	/** echoed when the caller opted into flat paging (offset/count). */
	offset?: number;
	/** the date field the Timeline/Calendar view should plot, echoed for the client. */
	dateField?: string;
};

export type QueryBoardCardsPaging = {
	/** flat paging over the sorted `cards` array (standard RC offset/count). */
	paging?: { offset: number; count: number };
	/** cap each group's `cards` at N rows; per-group `total`/`hasMore` stay exact. */
	groupLimit?: number;
};

/**
 * Run a saved view's `config` over a board's cards for the Table / Timeline /
 * Dashboard / Calendar client views to consume. Filters are translated to the
 * `OmnisCardQuery` the indexed `BoardsCards.search` understands (text / labels /
 * assignees / cardType / listIds / due / fieldFilters); `sort`, `groupBy`, and
 * `dateField` are applied in JS afterwards. Gated by `boards-view` + board visibility.
 *
 * `config.filters` is a typed-but-open struct; recognised keys map to the query, and
 * anything unknown is ignored (forward-compatible, mirroring the automation-condition
 * convention). The `me` assignee token resolves to the calling user.
 *
 * PAGINATION (opt-in — the no-params response is unchanged): every shipped client
 * (TableView / TimelineView / DashboardView / Gantt) consumes the FULL set and
 * buckets/rolls it up client-side, so nothing is paged unless asked.
 *  - `paging` (offset/count) pages the flat `cards` array; `total` stays the full
 *    match count (standard RC envelope semantics).
 *  - `groupLimit` caps each group's `cards` at N; each group carries its exact
 *    `total` + `hasMore` so grouped tables can render "first N (+K more)" and
 *    dashboards keep exact distribution counts.
 *  The two are orthogonal: groups always bucket the FULL sorted match set (per-group
 *  totals/membership stay correct even when the flat array is paged).
 *
 * NOTE the sort (`field:<id>`, undated-last) and groupBy (multi-membership per
 * assignee/label) run in JS, so the server still scans the full filtered set to
 * build correct group totals — paging here bounds the RESPONSE. Pushing sort+group
 * into an aggregation is the follow-up if board sizes ever make the scan hurt.
 */
export async function queryBoardCards(
	uid: string,
	boardId: string,
	config: ISavedViewConfig | undefined,
	viewType: SavedViewType = 'table',
	{ paging, groupLimit }: QueryBoardCardsPaging = {},
): Promise<QueryBoardCardsResult> {
	if (!(await hasPermissionAsync(uid, 'boards-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: METHOD.cards });
	}
	await getBoardForUser(boardId, uid, METHOD.cards);

	const query = toCardQuery(uid, config?.filters);
	let cards = await BoardsCards.search(boardId, query).toArray();

	// always sort (default = position, matching the search cursor) — sortCards
	// tie-breaks on _id, which Mongo's bare {position:1} does not, and offset
	// pages are only disjoint across requests under a deterministic total order.
	cards = sortCards(cards, config?.sort ?? 'position');

	const total = cards.length;
	// groups bucket the full sorted set BEFORE any flat paging, so per-group
	// totals and membership are exact regardless of the requested page.
	const groups = config?.groupBy ? groupCards(cards, config.groupBy, groupLimit) : undefined;

	const page = paging ? cards.slice(paging.offset, paging.offset + (paging.count || total)) : cards;

	return {
		boardId,
		viewType,
		cards: page,
		total,
		...(paging ? { offset: paging.offset } : {}),
		...(groups ? { groups } : {}),
		...(config?.dateField ? { dateField: config.dateField } : {}),
	};
}

/**
 * Translate a saved-view filter map into an `OmnisCardQuery`. Only recognised keys are
 * consumed; the rest are ignored so a richer client filter never breaks the server.
 */
function toCardQuery(uid: string, filters: Record<string, unknown> | undefined): OmnisCardQuery {
	const query: OmnisCardQuery = {};
	if (!filters) {
		return query;
	}

	if (typeof filters.text === 'string' && filters.text) {
		query.text = filters.text;
	}
	const labels = asStringArray(filters.labels);
	if (labels.length) {
		query.labels = labels;
	}
	// assignees: array of user ids; the literal 'me' resolves to the caller.
	const assignees = asStringArray(filters.assignees).map((a) => (a === 'me' ? uid : a));
	if (assignees.length) {
		query.assignees = assignees;
	}
	const cardType = asStringArray(filters.cardType) as OmnisCardQuery['cardType'];
	if (cardType?.length) {
		query.cardType = cardType;
	}
	const listIds = asStringArray(filters.listIds);
	if (listIds.length) {
		query.listIds = listIds;
	}
	if (typeof filters.due === 'string' && DUE_VALUES.has(filters.due)) {
		query.due = filters.due as OmnisCardQuery['due'];
	}
	if (Array.isArray(filters.fieldFilters)) {
		const ff = filters.fieldFilters.filter(
			(f): f is { fieldId: string; op: string; value?: unknown } =>
				Boolean(f) && typeof (f as { fieldId?: unknown }).fieldId === 'string' && typeof (f as { op?: unknown }).op === 'string',
		);
		if (ff.length) {
			query.fieldFilters = ff as OmnisCardQuery['fieldFilters'];
		}
	}
	if (filters.includeArchived === true) {
		query.isOpen = false;
	}

	return query;
}

const DUE_VALUES = new Set(['overdue', 'today', 'week', 'none', 'complete', 'incomplete']);

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Sort cards by a saved-view sort key. Recognised: `position` (default), `dueDate`,
 * `startDate`, `cardNumber`, `title`, `createdAt`, and `field:<id>`. A leading `-`
 * reverses the direction. Unknown keys leave the search order (position) intact.
 * Ties break on `_id` so the order is total — a requirement for disjoint offset pages.
 */
function sortCards(cards: IBoardCard[], sortKey: string): IBoardCard[] {
	const desc = sortKey.startsWith('-');
	const key = desc ? sortKey.slice(1) : sortKey;
	const dir = desc ? -1 : 1;

	const valueOf = (c: IBoardCard): string | number => {
		if (key.startsWith('field:')) {
			const fieldId = key.slice('field:'.length);
			const v = c.fieldValues?.[fieldId];
			if (typeof v === 'number') {
				return v;
			}
			return typeof v === 'string' ? v : '';
		}
		switch (key) {
			case 'dueDate':
				return c.dueDate ? new Date(c.dueDate).getTime() : Number.POSITIVE_INFINITY; // undated last
			case 'startDate':
				return c.startDate ? new Date(c.startDate).getTime() : Number.POSITIVE_INFINITY;
			case 'createdAt':
				return c.createdAt ? new Date(c.createdAt).getTime() : 0;
			case 'cardNumber':
				return c.cardNumber ?? 0;
			case 'title':
				return c.title ?? '';
			case 'position':
			default:
				return c.position ?? 0;
		}
	};

	const tieBreak = (a: IBoardCard, b: IBoardCard): number => (a._id < b._id ? -1 : 1);

	return [...cards].sort((a, b) => {
		const av = valueOf(a);
		const bv = valueOf(b);
		if (typeof av === 'number' && typeof bv === 'number') {
			return (av - bv) * dir || tieBreak(a, b);
		}
		return String(av).localeCompare(String(bv)) * dir || tieBreak(a, b);
	});
}

/**
 * Bucket cards by a group key for the Table/Dashboard grouped views. Recognised:
 * `list` (listId), `assignee` (one bucket per assignee + Unassigned), `label` (one
 * bucket per label + Unlabeled), `cardType`, `dueComplete`, and `field:<id>`. The
 * label is the raw key id — the client resolves human names from the board's defs.
 * `groupLimit` (positive) caps each bucket's returned cards; `total`/`hasMore`
 * always reflect the uncapped bucket.
 */
function groupCards(cards: IBoardCard[], groupBy: string, groupLimit?: number): BoardCardGroup[] {
	const buckets = new Map<string, IBoardCard[]>();
	const order: string[] = [];
	const add = (key: string, card: IBoardCard): void => {
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.push(card);
		} else {
			buckets.set(key, [card]);
			order.push(key);
		}
	};

	for (const card of cards) {
		if (groupBy === 'assignee') {
			const ids = card.assignees?.length ? card.assignees : ['__unassigned__'];
			for (const id of ids) {
				add(id, card);
			}
		} else if (groupBy === 'label') {
			const labels = card.labels?.length ? card.labels : ['__unlabeled__'];
			for (const l of labels) {
				add(l, card);
			}
		} else if (groupBy === 'cardType') {
			add(card.cardType ?? '__none__', card);
		} else if (groupBy === 'dueComplete') {
			add(card.dueComplete ? 'complete' : 'incomplete', card);
		} else if (groupBy.startsWith('field:')) {
			const fieldId = groupBy.slice('field:'.length);
			const v = card.fieldValues?.[fieldId];
			add(v === undefined || v === null || v === '' ? '__empty__' : String(v), card);
		} else {
			// default: group by list (the kanban columns).
			add(card.listId ?? '__none__', card);
		}
	}

	const labelFor = (key: string): string => {
		switch (key) {
			case '__unassigned__':
				return 'Unassigned';
			case '__unlabeled__':
				return 'Unlabeled';
			case '__empty__':
				return 'Empty';
			case '__none__':
				return 'None';
			default:
				return key;
		}
	};

	const cap = groupLimit && groupLimit > 0 ? groupLimit : undefined;
	return order.map((key) => {
		const bucket = buckets.get(key) ?? [];
		return {
			key,
			label: labelFor(key),
			cards: cap ? bucket.slice(0, cap) : bucket,
			total: bucket.length,
			hasMore: cap ? bucket.length > cap : false,
		};
	});
}
