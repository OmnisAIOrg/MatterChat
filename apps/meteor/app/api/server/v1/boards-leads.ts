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
	isBoardsLeadsMarkLostProps,
	isBoardsLeadsRunConflictCheckProps,
	isBoardsLeadsCheckDuplicatesProps,
	isBoardsLeadsComputeScoreProps,
	isBoardsLeadsComputeSolProps,
	isBoardsLeadsTimelineProps,
	isBoardsLeadsTemplateListProps,
	isBoardsLeadsTemplateUpsertProps,
	isBoardsLeadsTemplateSendProps,
	isBoardsLeadsCreateTaskProps,
	isBoardsLeadsTasksListProps,
	isBoardsLeadsTaskCompleteProps,
	isBoardsLeadsSequencesListProps,
	isBoardsLeadsSequencesEnrollProps,
	isBoardsLeadsSequencesAdvanceProps,
	isBoardsLeadsReferralOutUpsertProps,
	isBoardsLeadsReferralOutSetStatusProps,
	isBoardsLeadsReferralsOutListProps,
	isBoardsLeadsMarketingSourceRoiProps,
	isBoardsLeadsSignupPacketGenerateProps,
	isBoardsLeadsSignupPacketSetStatusProps,
	isBoardsLeadsSignupPacketGetProps,
	isBoardsLeadsSignupPacketSendProps,
	isBoardsLeadsReportFunnelProps,
	isBoardsLeadsReportScoreboardProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';
import { BoardsLeads } from '@rocket.chat/models';

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
	markLeadLost,
	pullFromCasePro,
	isCaseProEnabled,
	runConflictCheck,
	checkDuplicates,
	computeScore,
	computeLeadSol,
	getTimeline,
	listCommTemplates,
	upsertCommTemplate,
	sendTemplate,
	createTask,
	listSequences,
	enrollLead,
	advanceEnrollment,
	createReferralOut,
	updateReferralOutStatus,
	listReferralsOut,
	sourceRoi,
	generateSignupPacket,
	setSignupPacketStatus,
	getLatestPacket,
	sendSignupPacket,
	listTasks,
	completeTask,
	funnel,
	scoreboard,
} from '../../../../server/lib/boards/leads';
import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';

/** Load a lead or throw the canonical not-found failure (shared by the by-leadId reads). */
async function requireLead(leadId: string) {
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Error('error-lead-not-found');
	}
	return lead;
}

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
		// boards-casepro-sync gates every "pull rows out of CasePro" surface.
		if (!(await hasPermissionAsync(userId, 'boards-casepro-sync'))) {
			return API.v1.unauthorized();
		}
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
		// converting creates a live `matters` row upstream — that's a CasePro WRITE, so it
		// requires boards-casepro-write on top of the service-level conversion guards.
		// (Live writes are pilot-scoped: they also require CasePro_Enabled inside the service.)
		if (isCaseProEnabled() && !(await hasPermissionAsync(userId, 'boards-casepro-write'))) {
			return API.v1.unauthorized();
		}
		const { leadId } = this.bodyParams;

		const { lead, matterId, matterCard, mattersBoardId } = await convertToMatter(userId, leadId);

		return API.v1.success({ lead, matterId, matterCard, mattersBoardId });
	},
);

API.v1.post(
	'boards.leads.markLost',
	{
		authRequired: true,
		body: isBoardsLeadsMarkLostProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		if (!(await hasPermissionAsync(userId, 'boards-leads-edit'))) {
			return API.v1.unauthorized();
		}
		const { leadId, reason } = this.bodyParams;

		const lead = await markLeadLost(userId, leadId, reason);

		return API.v1.success({ lead });
	},
);

// ---------------------------------------------------------------------------
// M6 — conflict / dedupe / scoring / SOL (GET reads over a lead)
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.runConflictCheck',
	{
		authRequired: true,
		query: isBoardsLeadsRunConflictCheckProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		if (!(await hasPermissionAsync(userId, 'boards-leads-conflict-check'))) {
			return API.v1.unauthorized();
		}
		const lead = await requireLead(this.queryParams.leadId);
		const result = await runConflictCheck(lead);
		return API.v1.success(result);
	},
);

API.v1.get(
	'boards.leads.checkDuplicates',
	{
		authRequired: true,
		query: isBoardsLeadsCheckDuplicatesProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		if (!(await hasPermissionAsync(userId, 'boards-leads-view'))) {
			return API.v1.unauthorized();
		}
		const lead = await requireLead(this.queryParams.leadId);
		const result = await checkDuplicates(lead);
		return API.v1.success(result);
	},
);

API.v1.get(
	'boards.leads.computeScore',
	{
		authRequired: true,
		query: isBoardsLeadsComputeScoreProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		if (!(await hasPermissionAsync(userId, 'boards-leads-view'))) {
			return API.v1.unauthorized();
		}
		const lead = await requireLead(this.queryParams.leadId);
		const result = computeScore(lead);
		return API.v1.success(result);
	},
);

API.v1.get(
	'boards.leads.computeSol',
	{
		authRequired: true,
		query: isBoardsLeadsComputeSolProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		if (!(await hasPermissionAsync(userId, 'boards-leads-view'))) {
			return API.v1.unauthorized();
		}
		const lead = await requireLead(this.queryParams.leadId);
		const result = computeLeadSol(lead);
		return API.v1.success(result);
	},
);

// ---------------------------------------------------------------------------
// M6 — communications timeline
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.timeline',
	{
		authRequired: true,
		query: isBoardsLeadsTimelineProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const communications = await getTimeline(userId, this.queryParams.leadId);
		return API.v1.success({ communications });
	},
);

// ---------------------------------------------------------------------------
// M6 — comm templates
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.template.list',
	{
		authRequired: true,
		query: isBoardsLeadsTemplateListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { channel } = this.queryParams;
		const templates = await listCommTemplates(userId, channel);
		return API.v1.success({ templates });
	},
);

API.v1.post(
	'boards.leads.template.upsert',
	{
		authRequired: true,
		body: isBoardsLeadsTemplateUpsertProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { templateId, fields } = this.bodyParams;
		const { template, created } = await upsertCommTemplate(userId, fields, templateId);
		return API.v1.success({ template, created });
	},
);

API.v1.post(
	'boards.leads.template.send',
	{
		authRequired: true,
		body: isBoardsLeadsTemplateSendProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, templateId, vars } = this.bodyParams;
		const result = await sendTemplate(userId, leadId, templateId, vars);
		return API.v1.success(result);
	},
);

// ---------------------------------------------------------------------------
// M6 — intake tasks
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.leads.createTask',
	{
		authRequired: true,
		body: isBoardsLeadsCreateTaskProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, title, description, dueAt, assigneeId } = this.bodyParams;
		const { task } = await createTask(userId, {
			leadId,
			title,
			...(description ? { description } : {}),
			...(dueAt ? { dueAt: new Date(dueAt) } : {}),
			...(assigneeId ? { assigneeId } : {}),
		});
		return API.v1.success({ task });
	},
);

API.v1.get(
	'boards.leads.tasks.list',
	{
		authRequired: true,
		query: isBoardsLeadsTasksListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// permission enforced inside listTasks (boards-leads-view), mirroring createTask
		// which delegates its gating to the service layer.
		const tasks = await listTasks(userId, this.queryParams.leadId);
		return API.v1.success({ tasks });
	},
);

API.v1.post(
	'boards.leads.tasks.complete',
	{
		authRequired: true,
		body: isBoardsLeadsTaskCompleteProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// permission enforced inside completeTask (boards-leads-comms — the same
		// intake-worklist capability createTask uses).
		const task = await completeTask(userId, this.bodyParams.taskId);
		return API.v1.success({ task });
	},
);

// ---------------------------------------------------------------------------
// M6 — sequences (drip)
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.sequences.list',
	{
		authRequired: true,
		query: isBoardsLeadsSequencesListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const sequences = await listSequences(userId);
		return API.v1.success({ sequences });
	},
);

API.v1.post(
	'boards.leads.sequences.enroll',
	{
		authRequired: true,
		body: isBoardsLeadsSequencesEnrollProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { sequenceId, leadId } = this.bodyParams;
		const { enrollment, alreadyEnrolled } = await enrollLead(userId, sequenceId, leadId);
		return API.v1.success({ enrollment, alreadyEnrolled });
	},
);

API.v1.post(
	'boards.leads.sequences.advance',
	{
		authRequired: true,
		body: isBoardsLeadsSequencesAdvanceProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// advancing is a sequence-management action (the engine seam M7 will own).
		if (!(await hasPermissionAsync(userId, 'boards-leads-sequences-manage'))) {
			return API.v1.unauthorized();
		}
		const result = await advanceEnrollment(userId, this.bodyParams.enrollmentId);
		return API.v1.success(result);
	},
);

// ---------------------------------------------------------------------------
// M6 — referrals out
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.leads.referralOut.upsert',
	{
		authRequired: true,
		body: isBoardsLeadsReferralOutUpsertProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { sentAt, ...rest } = this.bodyParams;
		const { referralOut, lead, created } = await createReferralOut(userId, {
			...rest,
			...(sentAt ? { sentAt: new Date(sentAt) } : {}),
		});
		return API.v1.success({ referralOut, lead, created });
	},
);

API.v1.post(
	'boards.leads.referralOut.setStatus',
	{
		authRequired: true,
		body: isBoardsLeadsReferralOutSetStatusProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { referralOutId, status, receivedFee, receivedAt, notes } = this.bodyParams;
		const referralOut = await updateReferralOutStatus(userId, referralOutId, {
			status,
			...(receivedFee !== undefined ? { receivedFee } : {}),
			...(receivedAt ? { receivedAt: new Date(receivedAt) } : {}),
			...(notes !== undefined ? { notes } : {}),
		});
		return API.v1.success({ referralOut });
	},
);

API.v1.get(
	'boards.leads.referralsOut.list',
	{
		authRequired: true,
		query: isBoardsLeadsReferralsOutListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// permission is enforced inside listReferralsOut (boards-leads-view), mirroring
		// the sibling referralOut.* routes which delegate gating to the service layer.
		const referralsOut = await listReferralsOut(userId, this.queryParams.leadId);
		return API.v1.success({ referralsOut });
	},
);

// ---------------------------------------------------------------------------
// M6 — marketing ROI
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.marketing.sourceRoi',
	{
		authRequired: true,
		query: isBoardsLeadsMarketingSourceRoiProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { from, to } = this.queryParams;
		const result = await sourceRoi(userId, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
		return API.v1.success(result);
	},
);

// ---------------------------------------------------------------------------
// M6 — signup packets
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.leads.signupPacket.generate',
	{
		authRequired: true,
		body: isBoardsLeadsSignupPacketGenerateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { leadId, docTemplateId, esignProvider, generatedDocRef, signerEmail } = this.bodyParams;
		const { packet } = await generateSignupPacket(userId, leadId, docTemplateId, {
			...(esignProvider ? { esignProvider } : {}),
			...(generatedDocRef ? { generatedDocRef } : {}),
			...(signerEmail ? { signerEmail } : {}),
		});
		return API.v1.success({ packet });
	},
);

API.v1.post(
	'boards.leads.signupPacket.setStatus',
	{
		authRequired: true,
		body: isBoardsLeadsSignupPacketSetStatusProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { packetId, status, signedDocRef, at } = this.bodyParams;
		const { packet, conversionArmed } = await setSignupPacketStatus(userId, packetId, {
			status,
			...(signedDocRef ? { signedDocRef } : {}),
			...(at ? { at: new Date(at) } : {}),
		});
		return API.v1.success({ packet, conversionArmed });
	},
);

API.v1.get(
	'boards.leads.signupPacket.get',
	{
		authRequired: true,
		query: isBoardsLeadsSignupPacketGetProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// permission enforced inside getLatestPacket (boards-leads-view).
		const packet = await getLatestPacket(userId, this.queryParams.leadId);
		return API.v1.success({ packet });
	},
);

API.v1.post(
	'boards.leads.signupPacket.send',
	{
		authRequired: true,
		body: isBoardsLeadsSignupPacketSendProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// permission enforced inside sendSignupPacket (boards-leads-signups-manage).
		const { packetId, provider, subject } = this.bodyParams;
		const { packet, envelopeId, signUrl } = await sendSignupPacket(userId, packetId, {
			...(provider ? { provider } : {}),
			...(subject ? { subject } : {}),
		});
		return API.v1.success({ packet, envelopeId, ...(signUrl ? { signUrl } : {}) });
	},
);

// ---------------------------------------------------------------------------
// M6 — reports
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.leads.reports.funnel',
	{
		authRequired: true,
		query: isBoardsLeadsReportFunnelProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const result = await funnel(userId, this.queryParams.boardId);
		return API.v1.success(result);
	},
);

API.v1.get(
	'boards.leads.reports.scoreboard',
	{
		authRequired: true,
		query: isBoardsLeadsReportScoreboardProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const result = await scoreboard(userId, this.queryParams.boardId);
		return API.v1.success(result);
	},
);
