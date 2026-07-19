import {
	ajv,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import { createSubtask, convertChecklistItemToSubtask, getSubtasks, deleteSubtask, updateSubtask } from '../../../../server/lib/boards/subtasks';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';

/**
 * REST surface for Boards Subtasks (wave3 Subtasks v2).
 * First-class subtask cards with 3-level nesting, descriptions, comments, and checklist migration.
 *
 *   POST boards.subtasks.create              — create a subtask as a child of a card
 *   POST boards.subtasks.convertFromChecklist — convert a checklist item to a subtask
 *   GET  boards.subtasks.list                — get all subtasks of a card (recursively)
 *   PUT  boards.subtasks.update              — update a subtask (title, assignees, due date, etc.)
 *   DELETE boards.subtasks.delete            — archive a subtask (soft delete)
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.subtasks.create',
	{
		authRequired: true,
		body: {
			type: 'object',
			properties: {
				boardId: { type: 'string' },
				parentCardId: { type: 'string' },
				title: { type: 'string' },
				description: { type: 'string' },
				assignees: { type: 'array', items: { type: 'string' } },
				dueDate: { type: 'string' },
			},
			required: ['boardId', 'parentCardId', 'title'],
		},
		response: {
			201: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, parentCardId, title, description, assignees, dueDate } = this.bodyParams;

		const subtask = await createSubtask(userId, boardId, parentCardId, {
			title,
			description,
			assignees,
			dueDate: dueDate ? new Date(dueDate) : undefined,
		});

		return API.v1.success({ subtask }, 201);
	},
);

// ---------------------------------------------------------------------------
// Convert checklist item to subtask
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.subtasks.convertFromChecklist',
	{
		authRequired: true,
		body: {
			type: 'object',
			properties: {
				boardId: { type: 'string' },
				cardId: { type: 'string' },
				checklistId: { type: 'string' },
				itemId: { type: 'string' },
			},
			required: ['boardId', 'cardId', 'checklistId', 'itemId'],
		},
		response: {
			201: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, cardId, checklistId, itemId } = this.bodyParams;

		const subtask = await convertChecklistItemToSubtask(userId, boardId, cardId, checklistId, itemId);

		return API.v1.success({ subtask }, 201);
	},
);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.subtasks.list',
	{
		authRequired: true,
		query: {
			type: 'object',
			properties: {
				boardId: { type: 'string' },
				cardId: { type: 'string' },
			},
			required: ['boardId', 'cardId'],
		},
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { boardId, cardId } = this.queryParams;

		const subtasks = await getSubtasks(boardId, cardId);

		return API.v1.success({ subtasks, count: subtasks.length });
	},
);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

API.v1.put(
	'boards.subtasks.update',
	{
		authRequired: true,
		body: {
			type: 'object',
			properties: {
				boardId: { type: 'string' },
				cardId: { type: 'string' },
				title: { type: 'string' },
				description: { type: 'string' },
				assignees: { type: 'array', items: { type: 'string' } },
				dueDate: { type: 'string' },
				completed: { type: 'boolean' },
			},
			required: ['boardId', 'cardId'],
		},
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, cardId, title, description, assignees, dueDate, completed } = this.bodyParams;

		const subtask = await updateSubtask(userId, boardId, cardId, {
			title,
			description,
			assignees,
			dueDate: dueDate ? new Date(dueDate) : undefined,
			completed,
		});

		return API.v1.success({ subtask });
	},
);

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

API.v1.delete(
	'boards.subtasks.delete',
	{
		authRequired: true,
		query: {
			type: 'object',
			properties: {
				boardId: { type: 'string' },
				cardId: { type: 'string' },
				promoteChildren: { type: 'string' },
			},
			required: ['boardId', 'cardId'],
		},
		response: {
			204: { type: 'null' },
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, cardId, promoteChildren } = this.queryParams;

		await deleteSubtask(userId, boardId, cardId, {
			promoteChildren: promoteChildren === 'true',
		});

		return API.v1.success({ success: true });
	},
);
