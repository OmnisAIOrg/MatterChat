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
	getMyDayCards,
	setRecurrence,
	completeCard,
	copyCard,
	addRelation,
	removeRelation,
	searchCards,
	copyBoard,
	createCardFromTemplate,
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

// "My Day": every card assigned to me with a due date, across all my boards (CasePro-free).
API.v1.get(
	'boards.cards.myDay',
	{
		authRequired: true,
		response: {
			200: successSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { cards } = await getMyDayCards(this.userId);
		return API.v1.success({ cards, count: cards.length });
	},
);

// Global cross-board card search (title + description).
API.v1.get(
	'boards.cards.search',
	{
		authRequired: true,
		response: {
			200: successSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const text = typeof this.queryParams.text === 'string' ? this.queryParams.text : '';
		const { cards } = await searchCards(this.userId, text);
		return API.v1.success({ cards, count: cards.length });
	},
);

// Recurring "routine" tasks: set or clear a card's repeat rule.
const isCardRecurrenceProps = ajv.compile({
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		recurrence: {
			type: 'object',
			nullable: true,
			properties: {
				freq: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
				interval: { type: 'number' },
				basis: { type: 'string', enum: ['completion', 'dueDate'], nullable: true },
				count: { type: 'number', nullable: true },
			},
			required: ['freq', 'interval'],
			additionalProperties: true,
		},
	},
	required: ['cardId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.recurrence.set',
	{
		authRequired: true,
		body: isCardRecurrenceProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { cardId, recurrence } = this.bodyParams as { cardId: string; recurrence?: any };
		const card = await setRecurrence(this.userId, cardId, recurrence ?? null);
		return API.v1.success({ card });
	},
);

// Card-level completion (Asana-style "done", distinct from dueComplete + archive).
const isCardCompleteProps = ajv.compile({
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 }, completed: { type: 'boolean', nullable: true } },
	required: ['cardId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.complete',
	{
		authRequired: true,
		body: isCardCompleteProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, completed } = this.bodyParams as { cardId: string; completed?: boolean };
		const card = await completeCard(this.userId, cardId, completed !== false);
		return API.v1.success({ card });
	},
);

// Duplicate a card.
const isCardCopyProps = ajv.compile({
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.copy',
	{
		authRequired: true,
		body: isCardCopyProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId } = this.bodyParams as { cardId: string };
		const card = await copyCard(this.userId, cardId);
		return API.v1.success({ card });
	},
);

// Card relations / dependencies (blocks / blocked-by / relates / parent / child).
const isCardRelationProps = ajv.compile({
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		type: { type: 'string', enum: ['relates', 'blocks', 'blocked-by', 'duplicate', 'parent', 'child'] },
		targetCardId: { type: 'string', minLength: 1 },
	},
	required: ['cardId', 'type', 'targetCardId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.relations.add',
	{
		authRequired: true,
		body: isCardRelationProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, type, targetCardId } = this.bodyParams as { cardId: string; type: any; targetCardId: string };
		const card = await addRelation(this.userId, cardId, type, targetCardId);
		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.relations.remove',
	{
		authRequired: true,
		body: isCardRelationProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, type, targetCardId } = this.bodyParams as { cardId: string; type: any; targetCardId: string };
		const card = await removeRelation(this.userId, cardId, type, targetCardId);
		return API.v1.success({ card });
	},
);

// Duplicate a board (structure + lists, not cards).
const isBoardCopyProps = ajv.compile({
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.copy',
	{
		authRequired: true,
		body: isBoardCopyProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { boardId } = this.bodyParams as { boardId: string };
		const board = await copyBoard(this.userId, boardId);
		return API.v1.success({ board });
	},
);

// Create a card from a template card (clone its content into a target list).
const isCardFromTemplateProps = ajv.compile({
	type: 'object',
	properties: {
		templateCardId: { type: 'string', minLength: 1 },
		listId: { type: 'string', minLength: 1 },
	},
	required: ['templateCardId', 'listId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.fromTemplate',
	{
		authRequired: true,
		body: isCardFromTemplateProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { templateCardId, listId } = this.bodyParams as { templateCardId: string; listId: string };
		const card = await createCardFromTemplate(this.userId, templateCardId, listId);
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
