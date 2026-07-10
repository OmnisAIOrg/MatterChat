import {
	ajv,
	isBoardsMattersEnsureBoardProps,
	isBoardsMattersBindProps,
	isBoardsMattersRefreshSnapshotProps,
	isBoardsMattersSeedFromCaseProProps,
	isBoardsCaseProMatterSnapshotProps,
	isBoardsCaseProListMattersProps,
	isBoardsCaseProListStagesProps,
	isBoardsCaseProStatusProps,
	isBoardsMattersPlaybooksListProps,
	isBoardsMattersPlaybooksSeedProps,
	isBoardsMattersPlaybooksApplyProps,
	isBoardsMattersDeadlinesListProps,
	isBoardsMattersDeadlinesCreateProps,
	isBoardsMattersDeadlinesAcknowledgeProps,
	isBoardsMattersDeadlinesSetStatusProps,
	isBoardsMattersReportProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import {
	caseProClient,
	ensureMattersBoard,
	bindMatterCard,
	refreshMatterSnapshot,
	seedFromCasePro,
	listPlaybooks,
	seedDefaultPlaybooks,
	applyPlaybookToCard,
	listDeadlines,
	createDeadline,
	acknowledgeDeadline,
	setDeadlineStatus,
	aging,
	financial,
	caseload,
} from '../../../../server/lib/boards/matters';
import { caseProStatus } from '../../../../server/lib/boards/casepro';
import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
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
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-casepro-sync'))) {
			return API.v1.unauthorized();
		}
		const { cardId } = this.bodyParams;
		const card = await refreshMatterSnapshot(uid, cardId);
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
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-casepro-sync'))) {
			return API.v1.unauthorized();
		}
		const { boardId } = this.bodyParams;
		const result = await seedFromCasePro(uid, boardId);
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
		// permission-gated read; the client owns CasePro org-scoping.
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-casepro-view'))) {
			return API.v1.unauthorized();
		}
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
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-casepro-view'))) {
			return API.v1.unauthorized();
		}
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
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-casepro-view'))) {
			return API.v1.unauthorized();
		}
		const stages = await caseProClient.listStages();
		return API.v1.success({ stages });
	},
);

API.v1.get(
	'boards.casepro.status',
	{
		authRequired: true,
		query: isBoardsCaseProStatusProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-casepro-view'))) {
			return API.v1.unauthorized();
		}
		const status = await caseProStatus();
		return API.v1.success({ status });
	},
);

// ---------------------------------------------------------------------------
// boards.matters.playbooks.* (M5) — gated boards-matters-playbooks-manage
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.matters.playbooks.list',
	{
		authRequired: true,
		query: isBoardsMattersPlaybooksListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		// reads are gated by the matters-view permission (mirrors the board reads).
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-view'))) {
			return API.v1.unauthorized();
		}
		const playbooks = await listPlaybooks();
		return API.v1.success({ playbooks });
	},
);

API.v1.post(
	'boards.matters.playbooks.seed',
	{
		authRequired: true,
		body: isBoardsMattersPlaybooksSeedProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-playbooks-manage'))) {
			return API.v1.unauthorized();
		}
		const result = await seedDefaultPlaybooks(uid);
		return API.v1.success({ result });
	},
);

API.v1.post(
	'boards.matters.playbooks.apply',
	{
		authRequired: true,
		body: isBoardsMattersPlaybooksApplyProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-playbooks-manage'))) {
			return API.v1.unauthorized();
		}
		const { cardId, playbookId } = this.bodyParams;
		const result = await applyPlaybookToCard(uid, cardId, playbookId);
		return API.v1.success({ result });
	},
);

// ---------------------------------------------------------------------------
// boards.matters.deadlines.* (M5) — the SOL/deadline engine
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.matters.deadlines.list',
	{
		authRequired: true,
		query: isBoardsMattersDeadlinesListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-view'))) {
			return API.v1.unauthorized();
		}
		const { cardId, boardId, matterId } = this.queryParams;
		const deadlines = await listDeadlines({ cardId, boardId, matterId });
		return API.v1.success({ deadlines });
	},
);

API.v1.post(
	'boards.matters.deadlines.create',
	{
		authRequired: true,
		body: isBoardsMattersDeadlinesCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-deadlines-manage'))) {
			return API.v1.unauthorized();
		}
		const { cardId, kind, dueDate, label, highRisk, notes } = this.bodyParams;
		const deadline = await createDeadline(uid, {
			cardId,
			kind,
			dueDate: new Date(dueDate),
			...(label !== undefined ? { label } : {}),
			...(highRisk !== undefined ? { highRisk } : {}),
			...(notes !== undefined ? { notes } : {}),
		});
		return API.v1.success({ deadline });
	},
);

API.v1.post(
	'boards.matters.deadlines.acknowledge',
	{
		authRequired: true,
		body: isBoardsMattersDeadlinesAcknowledgeProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-deadlines-acknowledge'))) {
			return API.v1.unauthorized();
		}
		const { deadlineId } = this.bodyParams;
		const deadline = await acknowledgeDeadline(uid, deadlineId);
		return API.v1.success({ deadline });
	},
);

API.v1.post(
	'boards.matters.deadlines.setStatus',
	{
		authRequired: true,
		body: isBoardsMattersDeadlinesSetStatusProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-deadlines-manage'))) {
			return API.v1.unauthorized();
		}
		const { deadlineId, status, waivedReason } = this.bodyParams;
		const deadline = await setDeadlineStatus(uid, deadlineId, status, waivedReason);
		return API.v1.success({ deadline });
	},
);

// ---------------------------------------------------------------------------
// boards.matters.reports.* + boards.matters.caseload (M5)
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.matters.reports.aging',
	{
		authRequired: true,
		query: isBoardsMattersReportProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-reports-view'))) {
			return API.v1.unauthorized();
		}
		const report = await aging(uid);
		return API.v1.success({ report });
	},
);

API.v1.get(
	'boards.matters.reports.financial',
	{
		authRequired: true,
		query: isBoardsMattersReportProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-reports-view'))) {
			return API.v1.unauthorized();
		}
		const report = await financial(uid);
		return API.v1.success({ report });
	},
);

API.v1.get(
	'boards.matters.caseload',
	{
		authRequired: true,
		query: isBoardsMattersReportProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, 'boards-matters-reports-view'))) {
			return API.v1.unauthorized();
		}
		const report = await caseload(uid);
		return API.v1.success({ report });
	},
);
