import type { IBoardForm, IBoardFormField } from '@rocket.chat/core-typings';
import type { PublicBoardFormDTO } from '@rocket.chat/rest-typings';
import { BoardsForms, BoardsLists } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

import { assertBoardRole, getBoardForUser } from '../permissions';
import { createCard } from '../service';

/**
 * Boards FORMS service (parity P0.7 — generic form builder: intake → card).
 *
 * Authenticated CRUD is gated exactly like every other board mutation
 * (`assertBoardRole 'member'` — form authors need card-create rights anyway,
 * since submissions create cards on their behalf). Reads gate on board
 * visibility (`getBoardForUser`).
 *
 * The PUBLIC surface is keyed by `form.slug` — a 43-char `Random.secret()`
 * (~256 bits, the iCal-feed-token precedent). Security invariants:
 *  - unknown slug, archived form, and disabled form are INDISTINGUISHABLE
 *    (all resolve to null → 404), so form existence cannot be probed;
 *  - the public render payload is ONLY {title, description, fields};
 *  - answers are validated STRICTLY against the form's own field defs
 *    (unknown keys rejected — the data-driven additionalProperties:false);
 *  - a successful submit returns nothing but {ok:true}.
 *
 * Submission cards are created AS the form's creator through the normal
 * `createCard` service path, so board ACL, activity log, card numbering, and
 * board events all behave exactly as if the author had created the card. If
 * the author has lost board access the submit fails — a disabled-by-ACL form,
 * which is the conservative outcome.
 */

// value-length caps per field type (defense against public-endpoint abuse)
const MAX_VALUE_LEN: Partial<Record<IBoardFormField['type'], number>> = { textarea: 8000 };
const DEFAULT_MAX_VALUE_LEN = 4000;
const MAX_TITLE_LEN = 200;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
const PHONE_RE = /^[+()\-.\s0-9]{5,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BoardFormFieldInput = Omit<IBoardFormField, 'id'> & { id?: string };

export type CreateFormParams = {
	boardId: string;
	targetListId: string;
	title: string;
	description?: string;
	fields: BoardFormFieldInput[];
	titleTemplate?: string;
	enabled?: boolean;
};

export type UpdateFormPatch = Partial<Omit<CreateFormParams, 'boardId'>>;

/** Normalize + validate the field-builder payload; throws on structural problems. */
function normalizeFields(inputs: BoardFormFieldInput[], method: string): IBoardFormField[] {
	const seen = new Set<string>();
	return inputs.map((input) => {
		const label = input.label?.trim();
		if (!label) {
			throw new Meteor.Error('error-invalid-form-field', 'Field label is required', { method });
		}
		const id = (input.id ?? Random.id()).trim();
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
			throw new Meteor.Error('error-invalid-form-field', 'Invalid field id', { method });
		}
		if (seen.has(id)) {
			throw new Meteor.Error('error-invalid-form-field', 'Duplicate field id', { method });
		}
		seen.add(id);

		const options = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
		if (input.type === 'select' && options.length === 0) {
			throw new Meteor.Error('error-invalid-form-field', 'Select fields need at least one option', { method });
		}

		return {
			id,
			label,
			type: input.type,
			...(input.required ? { required: true } : {}),
			...(input.type === 'select' ? { options } : {}),
			...(input.placeholder?.trim() ? { placeholder: input.placeholder.trim() } : {}),
		};
	});
}

/** Assert the target list exists, belongs to the board, and is not archived. */
async function assertTargetList(boardId: string, listId: string, method: string): Promise<void> {
	const list = await BoardsLists.findOneById(listId);
	if (!list || list.boardId !== boardId || list.archived) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method });
	}
}

export async function createForm(uid: string, params: CreateFormParams): Promise<IBoardForm> {
	await assertBoardRole(params.boardId, uid, 'member', 'boards.forms.create');
	await assertTargetList(params.boardId, params.targetListId, 'boards.forms.create');

	const title = params.title.trim();
	if (!title) {
		throw new Meteor.Error('error-invalid-form-title', 'Invalid form title', { method: 'boards.forms.create' });
	}

	const now = new Date();
	const doc: Omit<IBoardForm, '_id' | '_updatedAt'> = {
		boardId: params.boardId,
		targetListId: params.targetListId,
		title,
		...(params.description?.trim() ? { description: params.description.trim() } : {}),
		fields: normalizeFields(params.fields, 'boards.forms.create'),
		...(params.titleTemplate?.trim() ? { titleTemplate: params.titleTemplate.trim() } : {}),
		enabled: params.enabled ?? true,
		slug: Random.secret(), // 43 chars ≈ 256 bits — the public-URL capability token
		submissionCount: 0,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId } = await BoardsForms.insertOne(doc);
	const form = await BoardsForms.findById(insertedId);
	if (!form) {
		throw new Meteor.Error('error-form-not-found', 'Form not found', { method: 'boards.forms.create' });
	}
	return form;
}

async function requireFormForMember(uid: string, formId: string, method: string): Promise<IBoardForm> {
	const form = await BoardsForms.findById(formId);
	if (!form || form.archived) {
		throw new Meteor.Error('error-form-not-found', 'Form not found', { method });
	}
	await assertBoardRole(form.boardId, uid, 'member', method);
	return form;
}

export async function updateForm(uid: string, formId: string, patch: UpdateFormPatch): Promise<IBoardForm> {
	const form = await requireFormForMember(uid, formId, 'boards.forms.update');

	const $set: Partial<IBoardForm> = {};
	if (patch.targetListId !== undefined) {
		await assertTargetList(form.boardId, patch.targetListId, 'boards.forms.update');
		$set.targetListId = patch.targetListId;
	}
	if (patch.title !== undefined) {
		const title = patch.title.trim();
		if (!title) {
			throw new Meteor.Error('error-invalid-form-title', 'Invalid form title', { method: 'boards.forms.update' });
		}
		$set.title = title;
	}
	if (patch.description !== undefined) {
		$set.description = patch.description.trim();
	}
	if (patch.fields !== undefined) {
		$set.fields = normalizeFields(patch.fields, 'boards.forms.update');
	}
	if (patch.titleTemplate !== undefined) {
		$set.titleTemplate = patch.titleTemplate.trim();
	}
	if (patch.enabled !== undefined) {
		$set.enabled = patch.enabled;
	}

	await BoardsForms.updateForm(formId, $set);
	const updated = await BoardsForms.findById(formId);
	if (!updated) {
		throw new Meteor.Error('error-form-not-found', 'Form not found', { method: 'boards.forms.update' });
	}
	return updated;
}

export async function deleteForm(uid: string, formId: string): Promise<{ ok: true }> {
	await requireFormForMember(uid, formId, 'boards.forms.delete');
	await BoardsForms.softDelete(formId);
	return { ok: true };
}

export async function listForms(uid: string, boardId: string): Promise<IBoardForm[]> {
	await getBoardForUser(boardId, uid, 'boards.forms.list');
	// full docs (incl. slug) — the management UI builds the copyable public link from it
	return BoardsForms.findByBoard(boardId).toArray();
}

// ---------------------------------------------------------------------------
// PUBLIC surface
// ---------------------------------------------------------------------------

/** Resolve an ACTIVE (non-archived, enabled) form by slug; null otherwise — never throws. */
async function resolveActiveForm(slug: string): Promise<IBoardForm | null> {
	if (!slug || typeof slug !== 'string') {
		return null;
	}
	const form = await BoardsForms.findOneActiveBySlug(slug);
	if (!form || !form.enabled) {
		// disabled == unknown == archived: identical outcome, no existence probing
		return null;
	}
	return form;
}

/** The public render payload: title/description/fields ONLY. Null → caller 404s. */
export async function getPublicFormBySlug(slug: string): Promise<PublicBoardFormDTO | null> {
	const form = await resolveActiveForm(slug);
	if (!form) {
		return null;
	}
	return {
		title: form.title,
		...(form.description ? { description: form.description } : {}),
		fields: form.fields,
	};
}

/** Strip control chars (except newlines for textarea) and cap length. */
function sanitizeValue(raw: string, type: IBoardFormField['type']): string {
	// eslint-disable-next-line no-control-regex
	const controls = type === 'textarea' ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
	const cleaned = raw.replace(controls, ' ').trim();
	return cleaned.slice(0, MAX_VALUE_LEN[type] ?? DEFAULT_MAX_VALUE_LEN);
}

/**
 * Validate raw public answers strictly against the form's field defs.
 * Returns display-ready string values keyed by field id (checkbox → Yes/No).
 */
function validateAnswers(form: IBoardForm, answers: Record<string, unknown>): Map<string, string> {
	const method = 'boards.forms.public.submit';
	if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
		throw new Meteor.Error('error-invalid-submission', 'Invalid submission', { method });
	}

	const fieldIds = new Set(form.fields.map((f) => f.id));
	for (const key of Object.keys(answers)) {
		if (!fieldIds.has(key)) {
			throw new Meteor.Error('error-invalid-submission', `Unexpected field: ${key.slice(0, 64)}`, { method });
		}
	}

	const values = new Map<string, string>();
	for (const field of form.fields) {
		const raw = answers[field.id];

		if (raw === undefined || raw === null || raw === '') {
			if (field.required && field.type !== 'checkbox') {
				throw new Meteor.Error('error-invalid-submission', `Missing required field: ${field.label}`, { method });
			}
			if (field.type === 'checkbox' && field.required) {
				// a required checkbox must be affirmatively checked
				throw new Meteor.Error('error-invalid-submission', `Missing required field: ${field.label}`, { method });
			}
			continue;
		}

		if (field.type === 'checkbox') {
			if (typeof raw !== 'boolean') {
				throw new Meteor.Error('error-invalid-submission', `Invalid value for: ${field.label}`, { method });
			}
			if (field.required && !raw) {
				throw new Meteor.Error('error-invalid-submission', `Missing required field: ${field.label}`, { method });
			}
			values.set(field.id, raw ? 'Yes' : 'No');
			continue;
		}

		if (typeof raw !== 'string') {
			throw new Meteor.Error('error-invalid-submission', `Invalid value for: ${field.label}`, { method });
		}
		const value = sanitizeValue(raw, field.type);
		if (!value) {
			if (field.required) {
				throw new Meteor.Error('error-invalid-submission', `Missing required field: ${field.label}`, { method });
			}
			continue;
		}

		switch (field.type) {
			case 'select':
				if (!(field.options ?? []).includes(value)) {
					throw new Meteor.Error('error-invalid-submission', `Invalid option for: ${field.label}`, { method });
				}
				break;
			case 'email':
				if (!EMAIL_RE.test(value)) {
					throw new Meteor.Error('error-invalid-submission', `Invalid email for: ${field.label}`, { method });
				}
				break;
			case 'phone':
				if (!PHONE_RE.test(value)) {
					throw new Meteor.Error('error-invalid-submission', `Invalid phone for: ${field.label}`, { method });
				}
				break;
			case 'date':
				if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
					throw new Meteor.Error('error-invalid-submission', `Invalid date for: ${field.label}`, { method });
				}
				break;
			default:
				break;
		}
		values.set(field.id, value);
	}

	return values;
}

/** Render the card title from the form's `{{fieldId}}` template (fallback: '<form title> submission'). */
function renderCardTitle(form: IBoardForm, values: Map<string, string>): string {
	const template = form.titleTemplate?.trim();
	let title = '';
	if (template) {
		title = template
			.replace(/\{\{\s*([A-Za-z0-9_-]{1,64})\s*\}\}/g, (_m, id: string) => values.get(id) ?? '')
			.replace(/\s+/g, ' ')
			.trim();
	}
	if (!title) {
		title = `${form.title} submission`;
	}
	return title.slice(0, MAX_TITLE_LEN);
}

/**
 * PUBLIC submit: validate → create a card in the form's target list (as the
 * form's creator, through the normal createCard service path) → bump counters.
 * Returns {ok:true} and nothing else.
 */
export async function submitPublicForm(slug: string, answers: Record<string, unknown>): Promise<{ ok: true }> {
	const form = await resolveActiveForm(slug);
	if (!form) {
		throw new Meteor.Error('error-form-not-found', 'Form not found', { method: 'boards.forms.public.submit' });
	}

	const values = validateAnswers(form, answers);

	const lines = form.fields
		.filter((field) => values.has(field.id))
		.map((field) => `**${field.label}:** ${values.get(field.id)}`);
	const description = [...lines, '', `_Submitted via form "${form.title}"._`].join('\n\n');

	await createCard(form.createdBy, {
		boardId: form.boardId,
		listId: form.targetListId,
		title: renderCardTitle(form, values),
		description,
		cardType: 'task',
	});

	await BoardsForms.recordSubmission(form._id);
	return { ok: true };
}
