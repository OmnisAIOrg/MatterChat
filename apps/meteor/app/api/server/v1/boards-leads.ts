import {
	ajv,
	isBoardsLeadsListProps,
	isBoardsLeadsGetProps,
	isBoardsLeadsEnsureBoardProps,
	isBoardsLeadsCreateProps,
	isBoardsLeadsUpdateProps,
	isBoardsLeadsQualifyProps,
	isBoardsLeadsAssignProps,
	isBoardsLeadsLogCommProps,
	isBoardsLeadsReferralSourceUpsertProps,
	isBoardsLeadsSyncFromCaseProProps,
	isBoardsLeadsConvertToMatterProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import {
	ensureLeadsBoard,
	createLead,
	updateLead,
	qualifyLead,
	assignLead,
	logCommunication,
	upsertReferralSource,
	listLeads,
	getLeadInfo,
	convertToMatter,
	pullFromCasePro,
	isCaseProEnabled,
} from '../../../../server/lib/boards/leads';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';

// Permissive success schema — lead/board docs are large/nested; we validate the
// `success` flag and pass the payload through (same approach boards.ts uses).
const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

// ---------------------------------------------------------------------------
// List + get
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.list',
	{
		authRequired: true,
		query: isBoardsLeadsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const { boardId, statusId, ownerId, q } = this.queryParams;

		const { leads, total } = await listLeads(userId, { boardId, statusId, ownerId, q }, { offset, count });

		return API.v1.success({ leads, count: leads.length, offset, total });
	},
);

API.v1.get(
	'boards.leads.get',
	{
		authRequired: true,
		query: isBoardsLeadsGetProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId } = this.queryParams;

		const { lead, communications } = await getLeadInfo(userId, leadId);

		return API.v1.success({ lead, communications });
	},
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.leads.ensureBoard',
	{
		authRequired: true,
		body: isBoardsLeadsEnsureBoardProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { board, lists, created } = await ensureLeadsBoard(userId);

		return API.v1.success({ board, lists, created });
	},
);

API.v1.post(
	'boards.leads.create',
	{
		authRequired: true,
		body: isBoardsLeadsCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { solDate, incident, ...rest } = this.bodyParams;

		// coerce ISO date strings the wire carries into Date objects
		const coerced = {
			...rest,
			...(solDate ? { solDate: new Date(solDate) } : {}),
			...(incident
				? {
						incident: {
							...incident,
							...(incident.incidentDate ? { incidentDate: new Date(incident.incidentDate as unknown as string) } : {}),
						},
				  }
				: {}),
		};

		const { lead, card, refNo, duplicateOf } = await createLead(userId, coerced);

		return API.v1.success({ lead, card, refNo, ...(duplicateOf ? { duplicateOf } : {}) });
	},
);

API.v1.post(
	'boards.leads.update',
	{
		authRequired: true,
		body: isBoardsLeadsUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, patch } = this.bodyParams;

		const { solDate, incident, ...rest } = patch;
		const coerced = {
			...rest,
			...(solDate ? { solDate: new Date(solDate) } : {}),
			...(incident
				? {
						incident: {
							...incident,
							...(incident.incidentDate ? { incidentDate: new Date(incident.incidentDate as unknown as string) } : {}),
						},
				  }
				: {}),
		};

		const lead = await updateLead(userId, leadId, coerced);

		return API.v1.success({ lead });
	},
);

API.v1.post(
	'boards.leads.qualify',
	{
		authRequired: true,
		body: isBoardsLeadsQualifyProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, qualification } = this.bodyParams;

		const lead = await qualifyLead(userId, leadId, qualification);

		return API.v1.success({ lead });
	},
);

API.v1.post(
	'boards.leads.assign',
	{
		authRequired: true,
		body: isBoardsLeadsAssignProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, ownerId, slaDueAt, pool } = this.bodyParams;

		const result = await assignLead(userId, leadId, {
			...(ownerId ? { ownerId } : {}),
			...(slaDueAt ? { slaDueAt: new Date(slaDueAt) } : {}),
			...(pool ? { pool } : {}),
		});

		return API.v1.success(result);
	},
);

API.v1.post(
	'boards.leads.logComm',
	{
		authRequired: true,
		body: isBoardsLeadsLogCommProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, ts, ...rest } = this.bodyParams;

		const { commId, communication } = await logCommunication(userId, leadId, {
			...rest,
			...(ts ? { ts: new Date(ts) } : {}),
		});

		return API.v1.success({ commId, communication });
	},
);

API.v1.post(
	'boards.leads.referralSource.upsert',
	{
		authRequired: true,
		body: isBoardsLeadsReferralSourceUpsertProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { sourceId, fields } = this.bodyParams;

		const { source, created } = await upsertReferralSource(userId, fields, sourceId);

		return API.v1.success({ source, created });
	},
);

// ---------------------------------------------------------------------------
// CasePro intake sync + conversion
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.leads.syncFromCasePro',
	{
		authRequired: true,
		body: isBoardsLeadsSyncFromCaseProProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		if (!isCaseProEnabled()) {
			return API.v1.failure('CasePro is not enabled; nothing to sync');
		}

		const result = await pullFromCasePro(userId);

		return API.v1.success(result);
	},
);

API.v1.post(
	'boards.leads.convertToMatter',
	{
		authRequired: true,
		body: isBoardsLeadsConvertToMatterProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId } = this.bodyParams;

		const { lead, matterId, matterCard, mattersBoardId } = await convertToMatter(userId, leadId);

		return API.v1.success({ lead, matterId, matterCard, mattersBoardId });
	},
);
