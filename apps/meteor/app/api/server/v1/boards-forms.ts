import {
	ajv,
	isBoardsFormsCreateProps,
	isBoardsFormsUpdateProps,
	isBoardsFormsDeleteProps,
	isBoardsFormsListProps,
	isBoardsFormsPublicGetProps,
	isBoardsFormsPublicSubmitProps,
	validateBadRequestErrorResponse,
	validateNotFoundErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import {
	createForm,
	updateForm,
	deleteForm,
	listForms,
	getPublicFormBySlug,
	submitPublicForm,
} from '../../../../server/lib/boards/forms/service';
import { API } from '../api';

/**
 * REST surface for Boards FORMS (parity P0.7 — generic form builder: a per-board
 * form whose public submissions become cards in a target list).
 *
 * Authenticated (permission + board-visibility enforced in the forms service):
 * `boards.forms.create` / `boards.forms.update` / `boards.forms.delete` — board members.
 * `boards.forms.list` — anyone who can see the board (returns slugs for copy-link).
 *
 * PUBLIC (authRequired:false — the unguessable slug IS the capability):
 * `boards.forms.public.get`    — render payload only (title/description/fields).
 * `boards.forms.public.submit` — strict-validated answers → card. Rate-limited
 *                                harder than the default API limiter (10/min).
 *
 * Unknown, archived, and disabled slugs all return the same 404 — existence of a
 * form is not probeable. Permissive success schema mirrors boards-views.ts.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

API.v1.post(
	'boards.forms.create',
	{
		authRequired: true,
		body: isBoardsFormsCreateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId; // authRequired guarantees presence; Meteor.userId() is unavailable in this REST context
		const { boardId, targetListId, title, description, fields, titleTemplate, enabled, intakeRouting, intakeMapping, caseproOrgId, caseproSourceToken } =
			this.bodyParams;
		const form = await createForm(uid, {
			boardId,
			targetListId,
			title,
			fields,
			...(description !== undefined ? { description } : {}),
			...(titleTemplate !== undefined ? { titleTemplate } : {}),
			...(enabled !== undefined ? { enabled } : {}),
			...(intakeRouting !== undefined ? { intakeRouting } : {}),
			...(intakeMapping !== undefined ? { intakeMapping } : {}),
			...(caseproOrgId !== undefined ? { caseproOrgId } : {}),
			...(caseproSourceToken !== undefined ? { caseproSourceToken } : {}),
		});
		return API.v1.success({ form });
	},
);

API.v1.post(
	'boards.forms.update',
	{
		authRequired: true,
		body: isBoardsFormsUpdateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		const { formId, targetListId, title, description, fields, titleTemplate, enabled, intakeRouting, intakeMapping, caseproOrgId, caseproSourceToken } =
			this.bodyParams;
		const form = await updateForm(uid, formId, {
			...(targetListId !== undefined ? { targetListId } : {}),
			...(title !== undefined ? { title } : {}),
			...(description !== undefined ? { description } : {}),
			...(fields !== undefined ? { fields } : {}),
			...(titleTemplate !== undefined ? { titleTemplate } : {}),
			...(enabled !== undefined ? { enabled } : {}),
			...(intakeRouting !== undefined ? { intakeRouting } : {}),
			...(intakeMapping !== undefined ? { intakeMapping } : {}),
			...(caseproOrgId !== undefined ? { caseproOrgId } : {}),
			...(caseproSourceToken !== undefined ? { caseproSourceToken } : {}),
		});
		return API.v1.success({ form });
	},
);

API.v1.post(
	'boards.forms.delete',
	{
		authRequired: true,
		body: isBoardsFormsDeleteProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		const result = await deleteForm(uid, this.bodyParams.formId);
		return API.v1.success(result);
	},
);

API.v1.get(
	'boards.forms.list',
	{
		authRequired: true,
		query: isBoardsFormsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		const forms = await listForms(uid, this.queryParams.boardId);
		return API.v1.success({ forms });
	},
);

// ---------------------------------------------------------------------------
// PUBLIC routes — the slug is the capability; see service header for invariants.
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.forms.public.get',
	{
		authRequired: false,
		query: isBoardsFormsPublicGetProps,
		rateLimiterOptions: { numRequestsAllowed: 60, intervalTimeInMS: 60000 },
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			404: validateNotFoundErrorResponse,
		},
	},
	async function action() {
		const form = await getPublicFormBySlug(this.queryParams.slug);
		if (!form) {
			return API.v1.notFound();
		}
		return API.v1.success({ form });
	},
);

API.v1.post(
	'boards.forms.public.submit',
	{
		authRequired: false,
		body: isBoardsFormsPublicSubmitProps,
		rateLimiterOptions: { numRequestsAllowed: 10, intervalTimeInMS: 60000 },
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			404: validateNotFoundErrorResponse,
		},
	},
	async function action() {
		const { slug, answers } = this.bodyParams;
		try {
			const result = await submitPublicForm(slug, answers as Record<string, unknown>);
			return API.v1.success(result);
		} catch (e: any) {
			if (e?.error === 'error-form-not-found') {
				return API.v1.notFound();
			}
			throw e; // validation errors → the API layer's standard 400 failure
		}
	},
);
