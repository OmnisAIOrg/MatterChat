import type { ISavedViewConfig, SavedViewType } from '@rocket.chat/core-typings';
import {
	ajv,
	isBoardsViewsListProps,
	isBoardsViewsUpsertProps,
	isBoardsViewsRemoveProps,
	isBoardsViewsSetDefaultProps,
	isBoardsViewsCardsProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import { requireUid } from '../../../../server/lib/boards';
import {
	listSavedViews,
	getSavedView,
	upsertSavedView,
	removeSavedView,
	setDefaultSavedView,
	queryBoardCards,
} from '../../../../server/lib/boards/views';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';

/**
 * REST surface for Boards SAVED VIEWS (M8 — the generic view switcher).
 *
 * `boards.views.list`       — the caller's own + shared views on a board.
 * `boards.views.upsert`     — create/update a saved view (gated boards-manage-saved-views in the service).
 * `boards.views.remove`     — soft-archive a saved view.
 * `boards.views.setDefault` — make a view the auto-opened default for its board+scope.
 * `boards.views.cards`      — run a saved view's filters/groupBy/sort over the board's cards.
 *
 * Permission + board-visibility + ownership are all enforced in the savedViews service
 * (reads: `boards-view`; writes: `boards-manage-saved-views`); these routes only resolve
 * the uid + coerce params. Permissive success schema mirrors boards-matters.ts.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

API.v1.get(
	'boards.views.list',
	{
		authRequired: true,
		query: isBoardsViewsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = requireUid('boards.views.list');
		const views = await listSavedViews(uid, this.queryParams.boardId);
		return API.v1.success({ views });
	},
);

API.v1.post(
	'boards.views.upsert',
	{
		authRequired: true,
		body: isBoardsViewsUpsertProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = requireUid('boards.views.upsert');
		const { viewId, name, viewType, scope, boardId, config, shared, isDefault } = this.bodyParams;
		const { view, created } = await upsertSavedView(
			uid,
			{
				name,
				viewType,
				scope,
				config: (config ?? {}) as ISavedViewConfig,
				...(boardId !== undefined ? { boardId } : {}),
				...(shared !== undefined ? { shared } : {}),
				...(isDefault !== undefined ? { isDefault } : {}),
			},
			viewId,
		);
		return API.v1.success({ view, created });
	},
);

API.v1.post(
	'boards.views.remove',
	{
		authRequired: true,
		body: isBoardsViewsRemoveProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = requireUid('boards.views.remove');
		const result = await removeSavedView(uid, this.bodyParams.viewId);
		return API.v1.success(result);
	},
);

API.v1.post(
	'boards.views.setDefault',
	{
		authRequired: true,
		body: isBoardsViewsSetDefaultProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = requireUid('boards.views.setDefault');
		const { view } = await setDefaultSavedView(uid, this.bodyParams.viewId);
		return API.v1.success({ view });
	},
);

API.v1.get(
	'boards.views.cards',
	{
		authRequired: true,
		query: isBoardsViewsCardsProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = requireUid('boards.views.cards');
		const { boardId, viewId, viewType, groupLimit } = this.queryParams;

		// when a saved view id is given, hydrate its config + viewType (caller may
		// still override the rendered viewType, e.g. preview a saved table as a timeline).
		let config: ISavedViewConfig | undefined;
		let resolvedViewType: SavedViewType | undefined = viewType as SavedViewType | undefined;
		if (viewId) {
			const view = await getSavedView(uid, viewId);
			config = view.config;
			resolvedViewType = (viewType as SavedViewType | undefined) ?? view.viewType;
		}

		// PAGINATION (opt-in, myDay/search pattern): the Table/Timeline/Dashboard/Gantt
		// clients consume the FULL set and bucket it client-side, so callers that pass
		// no offset/count keep the historical full response. offset/count page the flat
		// `cards` (standard envelope, `total` = full match count); `groupLimit` caps each
		// group's cards while its exact `total`/`hasMore` ride along per group.
		const wantsPaging = this.queryParams.offset !== undefined || this.queryParams.count !== undefined;
		const paging = wantsPaging ? await getPaginationItems(this.queryParams) : undefined;
		const cappedGroupLimit = typeof groupLimit === 'number' && groupLimit > 0 ? Math.floor(groupLimit) : undefined;

		const result = await queryBoardCards(uid, boardId, config, resolvedViewType ?? 'table', {
			...(paging ? { paging } : {}),
			...(cappedGroupLimit ? { groupLimit: cappedGroupLimit } : {}),
		});
		return API.v1.success({ result });
	},
);
