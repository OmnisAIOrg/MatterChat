import {
	ajv,
	isBoardsListProps,
	isBoardsInfoProps,
	isBoardsCreateProps,
	isBoardsUpdateProps,
	isBoardsArchiveProps,
	isBoardsSetStatusProps,
	isBoardsListsProps,
	isBoardsListCreateProps,
	isBoardsListUpdateProps,
	isBoardsListMoveProps,
	isBoardsListReorderProps,
	isBoardsListArchiveProps,
	isBoardsCardsProps,
	isBoardsCardsIcalPublicProps,
	isBoardsCardProps,
	isBoardsCardCreateProps,
	isBoardsCardUpdateProps,
	isBoardsCardMoveProps,
	isBoardsCardArchiveProps,
	isBoardsCardsBulkProps,
	isBoardsCardChecklistAddProps,
	isBoardsCardChecklistToggleProps,
	isBoardsCardChecklistRemoveProps,
	isBoardsCardLogTimeProps,
	isBoardsCardDeleteTimeEntryProps,
	isBoardsActivitiesProps,
	isBoardsLabelCreateProps,
	isBoardsLabelUpdateProps,
	isBoardsLabelDeleteProps,
	isBoardsCardLabelsSetProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import {
	createBoard,
	updateBoard,
	archiveBoard,
	setBoardStatus,
	getBoardInfo,
	createList,
	updateList,
	moveList,
	reorderLists,
	archiveList,
	createCard,
	updateCard,
	moveCard,
	archiveCard,
	bulkCardOperation,
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
	setMilestone,
	requestApproval,
	decideApproval,
	createBoardLabel,
	updateBoardLabel,
	deleteBoardLabel,
	setCardLabels,
	addChecklistItem,
	toggleChecklistItem,
	removeChecklistItem,
	logTime,
	deleteTimeEntry,
	buildICalForUser,
	getOrCreateIcalToken,
	resolveUserIdByIcalToken,
} from '../../../../server/lib/boards';
import { settings } from '../../../settings/server';
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

// Set a board's lifecycle status ('active' | 'on_hold' | 'completed' | 'archived').
// 'archived' keeps the legacy boolean `archived` flag (and cascade) in step.
API.v1.post(
	'boards.setStatus',
	{
		authRequired: true,
		body: isBoardsSetStatusProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, status } = this.bodyParams;
		const board = await setBoardStatus(userId, boardId, status);

		return API.v1.success({ board });
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

// Reorder a board's columns. Accepts either { boardId, listIds } (full ordering, positions
// reassigned in array order) or { listId, position } (single-list move). Returns the board's
// lists in their new persisted order (same 'member' gate as the other list mutations).
API.v1.post(
	'boards.list.reorder',
	{
		authRequired: true,
		body: isBoardsListReorderProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const lists = await reorderLists(userId, this.bodyParams);

		return API.v1.success({ lists });
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
		// No `query` schema is declared for this route, so `this.queryParams` types as `never`;
		// widen it locally (type-level only — same property read at runtime).
		const { text: rawText } = this.queryParams as { text?: unknown };
		const text = typeof rawText === 'string' ? rawText : '';
		const { cards } = await searchCards(this.userId, text);
		return API.v1.success({ cards, count: cards.length });
	},
);

// iCal (.ics) calendar feed of the user's due cards — one VEVENT per assigned card with a due
// date (same set as boards.cards.myDay). Returns a raw RFC-5545 `text/calendar` body (NOT the
// usual JSON envelope) so Google / Apple / Outlook Calendar can subscribe to it.
//
// AUTH: there are two ways to read the feed:
//   1. GET boards.cards.ical            — authenticated (X-Auth-Token / X-User-Id); current user.
//   2. GET boards.cards.ical.public?token=…  — UNAUTHENTICATED; resolves the user from a per-user
//      secret token (boardsIcalToken), so a calendar app can subscribe to a plain URL it cannot
//      attach login headers to. Mint the token with POST boards.cards.ical.token.
const icalSuccessSchema = ajv.compile<string>({ type: 'string' });

const icalHeaders = {
	'Content-Type': 'text/calendar; charset=utf-8',
	'Content-Disposition': 'attachment; filename="matterchat-deadlines.ics"',
};

API.v1.get(
	'boards.cards.ical',
	{
		authRequired: true,
		response: {
			200: icalSuccessSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const siteUrl = settings.get<string>('Site_Url') || undefined;
		const ics = await buildICalForUser(this.userId, siteUrl);
		return {
			statusCode: 200,
			body: ics,
			headers: icalHeaders,
		};
	},
);

// Mint (idempotently) + return the caller's per-user secret token for the public iCal feed.
// First call generates + persists boardsIcalToken on the user; subsequent calls return the same
// token. The client builds the subscribe URL from it: `<siteUrl>/api/v1/boards.cards.ical.public?token=…`.
API.v1.post(
	'boards.cards.ical.token',
	{
		authRequired: true,
		response: {
			200: successSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const token = await getOrCreateIcalToken(this.userId);
		return API.v1.success({ token });
	},
);

// Public, UNAUTHENTICATED iCal feed. Resolves the user from `?token=`, then returns the same raw
// RFC-5545 `text/calendar` body as boards.cards.ical. A missing/unknown token is rejected with 401
// and a minimal body (never leaks whether a token exists).
API.v1.get(
	'boards.cards.ical.public',
	{
		authRequired: false,
		query: isBoardsCardsIcalPublicProps,
		response: {
			200: icalSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const token = typeof this.queryParams.token === 'string' ? this.queryParams.token : '';
		const uid = await resolveUserIdByIcalToken(token);
		if (!uid) {
			return API.v1.unauthorized();
		}
		const siteUrl = settings.get<string>('Site_Url') || undefined;
		const ics = await buildICalForUser(uid, siteUrl);
		return {
			statusCode: 200,
			body: ics,
			headers: icalHeaders,
		};
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

// Flag a card as a milestone.
const isCardMilestoneProps = ajv.compile({
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 }, isMilestone: { type: 'boolean' } },
	required: ['cardId', 'isMilestone'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.milestone.set',
	{
		authRequired: true,
		body: isCardMilestoneProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, isMilestone } = this.bodyParams as { cardId: string; isMilestone: boolean };
		const card = await setMilestone(this.userId, cardId, isMilestone);
		return API.v1.success({ card });
	},
);

// Card approvals (request -> approved | changes | rejected).
const isApprovalRequestProps = ajv.compile({
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 }, approvers: { type: 'array', items: { type: 'string' }, nullable: true } },
	required: ['cardId'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.approval.request',
	{
		authRequired: true,
		body: isApprovalRequestProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, approvers } = this.bodyParams as { cardId: string; approvers?: string[] };
		const card = await requestApproval(this.userId, cardId, approvers || []);
		return API.v1.success({ card });
	},
);

const isApprovalDecideProps = ajv.compile({
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 }, decision: { type: 'string', enum: ['approved', 'changes', 'rejected'] } },
	required: ['cardId', 'decision'],
	additionalProperties: false,
});

API.v1.post(
	'boards.card.approval.decide',
	{
		authRequired: true,
		body: isApprovalDecideProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, decision } = this.bodyParams as { cardId: string; decision: 'approved' | 'changes' | 'rejected' };
		const card = await decideApproval(this.userId, cardId, decision);
		return API.v1.success({ card });
	},
);

// Card checklists / sub-tasks: granular item-level mutations on a card's default checklist.
API.v1.post(
	'boards.card.checklist.add',
	{
		authRequired: true,
		body: isBoardsCardChecklistAddProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, text } = this.bodyParams;
		const card = await addChecklistItem(this.userId, cardId, text);
		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.checklist.toggle',
	{
		authRequired: true,
		body: isBoardsCardChecklistToggleProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, itemId, done } = this.bodyParams;
		const card = await toggleChecklistItem(this.userId, cardId, itemId, done);
		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.checklist.remove',
	{
		authRequired: true,
		body: isBoardsCardChecklistRemoveProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, itemId } = this.bodyParams;
		const card = await removeChecklistItem(this.userId, cardId, itemId);
		return API.v1.success({ card });
	},
);

// Time tracking: append / remove a logged-time entry on a card.
API.v1.post(
	'boards.card.log-time',
	{
		authRequired: true,
		body: isBoardsCardLogTimeProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, minutes, note, spentAt } = this.bodyParams;
		const card = await logTime(this.userId, cardId, {
			minutes,
			...(note ? { note } : {}),
			...(spentAt ? { spentAt: new Date(spentAt) } : {}),
		});
		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.card.delete-time-entry',
	{
		authRequired: true,
		body: isBoardsCardDeleteTimeEntryProps,
		response: { 200: successSchema, 400: validateBadRequestErrorResponse, 401: validateUnauthorizedErrorResponse },
	},
	async function action() {
		const { cardId, entryId } = this.bodyParams;
		const card = await deleteTimeEntry(this.userId, cardId, entryId);
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

// Bulk card operations: apply one action (move | complete | archive | setPriority | delete) to a
// set of cards. Each card is processed independently (its own per-card permission check) so one
// bad card doesn't abort the batch; per-card outcomes come back in `results`.
API.v1.post(
	'boards.cards.bulk',
	{
		authRequired: true,
		body: isBoardsCardsBulkProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { cardIds, action, ...actionParams } = this.bodyParams;
		const { results, updated, failed } = await bulkCardOperation(userId, cardIds, action, actionParams);

		return API.v1.success({ results, updated, failed });
	},
);

// ---------------------------------------------------------------------------
// Labels / tags
// ---------------------------------------------------------------------------

// Add a label to a board's palette (admin). Returns the fresh board (incl. labelDefs).
API.v1.post(
	'boards.label.create',
	{
		authRequired: true,
		body: isBoardsLabelCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, name, color } = this.bodyParams;
		const board = await createBoardLabel(userId, boardId, { name, color });

		return API.v1.success({ board });
	},
);

// Rename / recolor a palette label (admin).
API.v1.post(
	'boards.label.update',
	{
		authRequired: true,
		body: isBoardsLabelUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, labelId, patch } = this.bodyParams;
		const board = await updateBoardLabel(userId, boardId, labelId, patch);

		return API.v1.success({ board });
	},
);

// Delete a palette label (admin) — also scrubs the reference off every card.
API.v1.post(
	'boards.label.delete',
	{
		authRequired: true,
		body: isBoardsLabelDeleteProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, labelId } = this.bodyParams;
		const board = await deleteBoardLabel(userId, boardId, labelId);

		return API.v1.success({ board });
	},
);

// Replace a card's label-id set (member). Each id is validated against the board palette.
API.v1.post(
	'boards.card.labels.set',
	{
		authRequired: true,
		body: isBoardsCardLabelsSetProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { cardId, labelIds } = this.bodyParams;
		const card = await setCardLabels(userId, cardId, labelIds);

		return API.v1.success({ card });
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
