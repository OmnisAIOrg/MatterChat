import {
	ajv,
	isBoardsAutomationsListProps,
	isBoardsAutomationsGetProps,
	isBoardsAutomationsCreateProps,
	isBoardsAutomationsUpdateProps,
	isBoardsAutomationsArchiveProps,
	isBoardsAutomationsRunProps,
	isBoardsAutomationsDryRunProps,
	isBoardsAutomationsRunsListProps,
	isBoardsAutomationsTemplatesListProps,
	isBoardsAutomationsTemplatesInstallProps,
	isBoardsAutomationsButtonsForBoardProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';
import type { BoardAutomationKind, BoardsCardType } from '@rocket.chat/core-typings';
import { BoardsAutomations } from '@rocket.chat/models';

import {
	listAutomations,
	getAutomation,
	createAutomation,
	updateAutomation,
	archiveAutomation,
	listRuns,
} from '../../services/automation/manage';
import { listTemplates, installTemplate } from '../../services/automation/templates';
import { runOne } from '../../services/automation/dispatcher';
import { hasPermissionAsync } from '../../lib/authorization/hasPermission';
import { API } from '../api';
import { getPaginationItems } from '../lib/getPaginationItems';

/**
 * REST surface for the Boards AUTOMATION ENGINE (M7 — 05-automation-engine.md §8.2).
 *
 *   GET  boards.automations.list       — automations on a board (manager view)
 *   GET  boards.automations.get        — one automation
 *   POST boards.automations.create     — create (boards-manage-automations)
 *   POST boards.automations.update     — patch (boards-manage-automations)
 *   POST boards.automations.archive    — remove (boards-manage-automations)
 *   POST boards.automations.run        — run a button now (boards-run-automation)
 *   POST boards.automations.dryRun     — editor preview / plan (boards-run-automation)
 *   GET  boards.automations.runs.list  — the run-log audit view (boards-view-automation-runs)
 *   GET  boards.automations.templates.list    — the prebuilt template catalog (boards-manage-automations)
 *   POST boards.automations.templates.install — clone a template onto a board (boards-manage-automations)
 *   GET  boards.automations.buttonsForBoard   — enabled card/board buttons for a board (boards-run-automation)
 *
 * Mirrors `boards-leads.ts`: a permissive `successSchema` (the docs are large/nested — we
 * validate `success` + pass the payload), `getPaginationItems` for paging, and gating
 * delegated to the service layer where the service already enforces it.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.automations.list',
	{
		authRequired: true,
		query: isBoardsAutomationsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const { boardId, kind, enabled } = this.queryParams;

		const { automations, total } = await listAutomations(
			userId,
			{
				...(boardId ? { boardId } : {}),
				...(kind ? { kind: kind as BoardAutomationKind } : {}),
				...(enabled !== undefined ? { enabled: enabled === 'true' } : {}),
			},
			{ offset, count },
		);

		return API.v1.success({ automations, count: automations.length, offset, total });
	},
);

API.v1.get(
	'boards.automations.get',
	{
		authRequired: true,
		query: isBoardsAutomationsGetProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const automation = await getAutomation(userId, this.queryParams.automationId);
		return API.v1.success({ automation });
	},
);

API.v1.get(
	'boards.automations.runs.list',
	{
		authRequired: true,
		query: isBoardsAutomationsRunsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const { automationId, boardId, cardId } = this.queryParams;

		const { runs, total } = await listRuns(
			userId,
			{
				...(automationId ? { automationId } : {}),
				...(boardId ? { boardId } : {}),
				...(cardId ? { cardId } : {}),
			},
			{ offset, count },
		);

		return API.v1.success({ runs, count: runs.length, offset, total });
	},
);

API.v1.get(
	'boards.automations.templates.list',
	{
		authRequired: true,
		query: isBoardsAutomationsTemplatesListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { templates, total } = await listTemplates(userId);
		return API.v1.success({ templates, total });
	},
);

API.v1.get(
	'boards.automations.buttonsForBoard',
	{
		authRequired: true,
		query: isBoardsAutomationsButtonsForBoardProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { boardId, cardType } = this.queryParams;

		// read gate: running a button requires run permission (board-scoped).
		if (!(await hasPermissionAsync(userId, 'boards-run-automation', boardId))) {
			return API.v1.unauthorized();
		}

		const all = await BoardsAutomations.findButtonsForBoard(boardId).toArray();
		// optional cardType filter: card-buttons may scope to a card type via their trigger
		// filter; board-buttons (no card subject) are always returned.
		const automations = cardType
			? all.filter((a) => a.kind === 'board-button' || !a.trigger?.filters?.cardType || a.trigger.filters.cardType === (cardType as BoardsCardType))
			: all;

		return API.v1.success({ automations, count: automations.length, total: automations.length });
	},
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.automations.create',
	{
		authRequired: true,
		body: isBoardsAutomationsCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const automation = await createAutomation(userId, this.bodyParams);
		return API.v1.success({ automation });
	},
);

API.v1.post(
	'boards.automations.update',
	{
		authRequired: true,
		body: isBoardsAutomationsUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { automationId, patch } = this.bodyParams;
		const automation = await updateAutomation(userId, automationId, patch);
		return API.v1.success({ automation });
	},
);

API.v1.post(
	'boards.automations.archive',
	{
		authRequired: true,
		body: isBoardsAutomationsArchiveProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const result = await archiveAutomation(userId, this.bodyParams.automationId);
		return API.v1.success(result);
	},
);

// ---------------------------------------------------------------------------
// Run / dry-run
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.automations.run',
	{
		authRequired: true,
		body: isBoardsAutomationsRunProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { automationId, cardId, leadId } = this.bodyParams;

		const automation = await BoardsAutomations.findOneById(automationId);
		if (!automation) {
			return API.v1.failure('Automation not found');
		}
		// running a button requires explicit run permission (board-scoped where known).
		if (!(await hasPermissionAsync(userId, 'boards-run-automation', automation.boardId))) {
			return API.v1.unauthorized();
		}

		const result = await runOne(automation, {
			actor: userId,
			...(cardId ? { cardId } : {}),
			...(leadId ? { leadId } : {}),
		});
		return API.v1.success(result);
	},
);

API.v1.post(
	'boards.automations.dryRun',
	{
		authRequired: true,
		body: isBoardsAutomationsDryRunProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { automationId, automation: inlineAutomation, cardId, leadId } = this.bodyParams;

		// Resolve the automation: a saved id, or an inline body for the editor preview.
		let automation = null;
		if (automationId) {
			automation = await BoardsAutomations.findOneById(automationId);
		} else if (inlineAutomation) {
			// inline preview: synthesize a transient automation doc (never persisted).
			automation = {
				_id: 'dry-run',
				name: 'Dry run',
				scope: 'board',
				kind: 'rule',
				conditions: [],
				actions: [],
				enabled: true,
				rev: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
				...inlineAutomation,
			} as unknown as Parameters<typeof runOne>[0];
		}
		if (!automation) {
			return API.v1.failure('Automation not found and no inline automation provided');
		}

		// dry-run requires the same run permission (board-scoped where known).
		if (!(await hasPermissionAsync(userId, 'boards-run-automation', automation.boardId))) {
			return API.v1.unauthorized();
		}

		const result = await runOne(automation, {
			actor: userId,
			dryRun: true,
			...(cardId ? { cardId } : {}),
			...(leadId ? { leadId } : {}),
		});
		return API.v1.success(result);
	},
);

// ---------------------------------------------------------------------------
// Templates — install a catalog template onto a board
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.automations.templates.install',
	{
		authRequired: true,
		body: isBoardsAutomationsTemplatesInstallProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { templateId, boardId } = this.bodyParams;
		const result = await installTemplate(userId, templateId, boardId);
		return API.v1.success(result);
	},
);
