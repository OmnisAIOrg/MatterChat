import {
	ajv,
	isBoardsListProps,
	isBoardsInfoProps,
	isBoardsCreateProps,
	isBoardsUpdateProps,
	isBoardsArchiveProps,
	isBoardsListsProps,
	isBoardsListCreateProps,
	isBoardsListUpdateProps,
	isBoardsListMoveProps,
	isBoardsListArchiveProps,
	isBoardsCardsProps,
	isBoardsCardProps,
	isBoardsCardCreateProps,
	isBoardsCardUpdateProps,
	isBoardsCardMoveProps,
	isBoardsCardArchiveProps,
	isBoardsActivitiesProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import {
	createBoard,
	updateBoard,
	archiveBoard,
	getBoardInfo,
	createList,
	updateList,
	moveList,
	archiveList,
	createCard,
	updateCard,
	moveCard,
	archiveCard,
	listBoardsForUser,
	getListsForBoard,
	getCardsForBoard,
	getCardForUser,
	getActivities,
} from '../../../../server/lib/boards';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';

// A permissive success schema — Boards docs are large/nested; we validate the
// `success` flag and pass the payload through (same approach RC uses for
// data-heavy endpoints rather than mirroring every embedded type in ajv).
const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

// Void variant for endpoints that return `API.v1.success()` with no payload
// (archive routes). Mirrors calendar.ts's `ajv.compile<void>(...)`.
const voidSuccessSchema = ajv.compile<void>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.list',
	{
		authRequired: true,
		query: isBoardsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const { pipelineType, starred } = this.queryParams;

		const { boards, total } = await listBoardsForUser(userId, { pipelineType, starred }, { offset, count });

		return API.v1.success({ boards, count: boards.length, offset, total });
	},
);

API.v1.get(
	'boards.info',
	{
		authRequired: true,
		query: isBoardsInfoProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId } = this.queryParams;

		const { board, lists } = await getBoardInfo(userId, boardId);

		return API.v1.success({ board, lists });
	},
);

API.v1.post(
	'boards.create',
	{
		authRequired: true,
		body: isBoardsCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const board = await createBoard(userId, this.bodyParams);

		return API.v1.success({ board });
	},
);

API.v1.post(
	'boards.update',
	{
		authRequired: true,
		body: isBoardsUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, patch } = this.bodyParams;
		const board = await updateBoard(userId, boardId, patch);

		return API.v1.success({ board });
	},
);

API.v1.post(
	'boards.archive',
	{
		authRequired: true,
		body: isBoardsArchiveProps,
		response: {
			200: voidSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId } = this.bodyParams;
		await archiveBoard(userId, boardId);

		return API.v1.success();
	},
);

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.lists',
	{
		authRequired: true,
		query: isBoardsListsProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId } = this.queryParams;

		const { lists } = await getListsForBoard(userId, boardId);

		return API.v1.success({ lists });
	},
);

API.v1.post(
	'boards.list.create',
	{
		authRequired: true,
		body: isBoardsListCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const list = await createList(userId, this.bodyParams);

		return API.v1.success({ list });
	},
);

API.v1.post(
	'boards.list.update',
	{
		authRequired: true,
		body: isBoardsListUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { listId, patch } = this.bodyParams;
		const list = await updateList(userId, listId, patch);

		return API.v1.success({ list });
	},
);

API.v1.post(
	'boards.list.move',
	{
		authRequired: true,
		body: isBoardsListMoveProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { listId, position } = this.bodyParams;
		const list = await moveList(userId, listId, position);

		return API.v1.success({ list });
	},
);

API.v1.post(
	'boards.list.archive',
	{
		authRequired: true,
		body: isBoardsListArchiveProps,
		response: {
			200: voidSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { listId } = this.bodyParams;
		await archiveList(userId, listId);

		return API.v1.success();
	},
);

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.cards',
	{
		authRequired: true,
		query: isBoardsCardsProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const { boardId, listId } = this.queryParams;

		const { cards, total } = await getCardsForBoard(userId, boardId, listId, { offset, count });

		return API.v1.success({ cards, count: cards.length, offset, total });
	},
);

API.v1.get(
	'boards.card',
	{
		authRequired: true,
		query: isBoardsCardProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { cardId } = this.queryParams;

		const card = await getCardForUser(userId, cardId);

		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.create',
	{
		authRequired: true,
		body: isBoardsCardCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const card = await createCard(userId, this.bodyParams);

		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.update',
	{
		authRequired: true,
		body: isBoardsCardUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { cardId, patch } = this.bodyParams;

		// coerce the ISO date strings the wire carries into Date objects
		const { startDate, dueDate, ...rest } = patch;
		const coerced = {
			...rest,
			...(startDate ? { startDate: new Date(startDate) } : {}),
			...(dueDate ? { dueDate: new Date(dueDate) } : {}),
		};
		const card = await updateCard(userId, cardId, coerced);

		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.move',
	{
		authRequired: true,
		body: isBoardsCardMoveProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { cardId, toListId, position, subStatus } = this.bodyParams;
		const card = await moveCard(userId, cardId, toListId, position, subStatus);

		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.archive',
	{
		authRequired: true,
		body: isBoardsCardArchiveProps,
		response: {
			200: voidSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { cardId } = this.bodyParams;
		await archiveCard(userId, cardId);

		return API.v1.success();
	},
);

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.activities',
	{
		authRequired: true,
		query: isBoardsActivitiesProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const { boardId, cardId } = this.queryParams;

		const { activities, total } = await getActivities(userId, { boardId, cardId }, { offset, count });

		return API.v1.success({ activities, count: activities.length, offset, total });
	},
);
