import {
	ajv,
	isBoardsMattersEnsureBoardProps,
	isBoardsMattersBindProps,
	isBoardsMattersRefreshSnapshotProps,
	isBoardsMattersSeedFromCaseProProps,
	isBoardsCaseProMatterSnapshotProps,
	isBoardsCaseProListMattersProps,
	isBoardsCaseProListStagesProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import { caseProClient, ensureMattersBoard, bindMatterCard, refreshMatterSnapshot, seedFromCasePro } from '../../../../server/lib/boards/matters';
import { requireUid } from '../../../../server/lib/boards';
import { API } from '../api';

/**
 * REST surface for the Matters pipeline (M3a server).
 *
 * `boards.matters.*` = board/list/card ops over the matters board.
 * `boards.casepro.*` = thin read-through wrappers over the parallel CasePro client.
 *
 * The Matters UI consumes `boards.casepro.matterSnapshot` + `boards.matters.ensureBoard`.
 * Permissive success schema (Boards/CasePro payloads are large/nested) mirrors boards.ts.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

// ---------------------------------------------------------------------------
// boards.matters.*
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.matters.ensureBoard',
	{
		authRequired: true,
		body: isBoardsMattersEnsureBoardProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { board, lists } = await ensureMattersBoard(this.userId);
		return API.v1.success({ board, lists });
	},
);

API.v1.post(
	'boards.matters.bind',
	{
		authRequired: true,
		body: isBoardsMattersBindProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { boardId, listId, matterId } = this.bodyParams;
		const card = await bindMatterCard(this.userId, boardId, listId, matterId);
		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.matters.refreshSnapshot',
	{
		authRequired: true,
		body: isBoardsMattersRefreshSnapshotProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { cardId } = this.bodyParams;
		const card = await refreshMatterSnapshot(this.userId, cardId);
		return API.v1.success({ card });
	},
);

API.v1.post(
	'boards.matters.seedFromCasePro',
	{
		authRequired: true,
		body: isBoardsMattersSeedFromCaseProProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { boardId } = this.bodyParams;
		const result = await seedFromCasePro(this.userId, boardId);
		return API.v1.success({ result });
	},
);

// ---------------------------------------------------------------------------
// boards.casepro.* — thin wrappers over caseProClient (read-through)
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.casepro.matterSnapshot',
	{
		authRequired: true,
		query: isBoardsCaseProMatterSnapshotProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		// auth gate only; the client owns CasePro org-scoping.
		requireUid('boards.casepro.matterSnapshot');
		const { matterId } = this.queryParams;
		const snapshot = await caseProClient.matterSnapshot(matterId);
		return API.v1.success({ snapshot });
	},
);

API.v1.get(
	'boards.casepro.listMatters',
	{
		authRequired: true,
		query: isBoardsCaseProListMattersProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		requireUid('boards.casepro.listMatters');
		const { stageId, caseTypeId, query, limit, offset } = this.queryParams;
		const { matters, total } = await caseProClient.listMatters({ stageId, caseTypeId, query, limit, offset });
		return API.v1.success({ matters, total });
	},
);

API.v1.get(
	'boards.casepro.listStages',
	{
		authRequired: true,
		query: isBoardsCaseProListStagesProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		requireUid('boards.casepro.listStages');
		const stages = await caseProClient.listStages();
		return API.v1.success({ stages });
	},
);
