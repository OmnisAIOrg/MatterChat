import type { BoardFormFieldType, BoardFormIntakeRouting, IBoardForm, IBoardFormField, IBoardFormIntakeMapping } from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';

/**
 * REST validators + endpoint types for Boards FORMS (parity P0.7 — the generic
 * form builder: intake → card, public link, field mapping).
 *
 * Authenticated (board-member gated in the service):
 * `boards.forms.create` / `boards.forms.update` / `boards.forms.delete` / `boards.forms.list`
 *
 * PUBLIC (authRequired:false, keyed by the unguessable `slug`):
 * `boards.forms.public.get`    — the render payload: title/description/fields ONLY.
 * `boards.forms.public.submit` — validates answers against the field schema and
 *                                creates a card in the form's target list.
 *
 * The `answers` body is typed-but-open here (`{ type: 'object' }`): the service
 * validates it STRICTLY against the form's own field definitions (unknown keys
 * rejected), mirroring the additionalProperties:false discipline where the schema
 * is data-driven rather than static.
 */

const FIELD_TYPES: BoardFormFieldType[] = ['text', 'textarea', 'select', 'date', 'checkbox', 'email', 'phone'];

const INTAKE_ROUTINGS: BoardFormIntakeRouting[] = ['none', 'lead', 'casepro-direct'];

// every value is a form FIELD ID; the service validates existence against the form's own fields
const intakeMappingSchema = {
	type: 'object',
	nullable: true,
	properties: {
		fullName: { type: 'string', nullable: true, maxLength: 64 },
		firstName: { type: 'string', nullable: true, maxLength: 64 },
		lastName: { type: 'string', nullable: true, maxLength: 64 },
		email: { type: 'string', nullable: true, maxLength: 64 },
		phone: { type: 'string', nullable: true, maxLength: 64 },
		caseType: { type: 'string', nullable: true, maxLength: 64 },
		incidentDate: { type: 'string', nullable: true, maxLength: 64 },
	},
	additionalProperties: false,
} as const;

// shared by create + update (all optional; service enforces per-mode requirements)
const intakeRoutingProps = {
	intakeRouting: { type: 'string', enum: INTAKE_ROUTINGS, nullable: true },
	intakeMapping: intakeMappingSchema,
	caseproOrgId: { type: 'string', nullable: true, maxLength: 128 },
	caseproSourceToken: { type: 'string', nullable: true, maxLength: 256 },
} as const;

const fieldSchema = {
	type: 'object',
	properties: {
		id: { type: 'string', nullable: true, maxLength: 64 },
		label: { type: 'string', minLength: 1, maxLength: 200 },
		type: { type: 'string', enum: FIELD_TYPES },
		required: { type: 'boolean', nullable: true },
		options: { type: 'array', nullable: true, maxItems: 50, items: { type: 'string', maxLength: 200 } },
		placeholder: { type: 'string', nullable: true, maxLength: 200 },
	},
	required: ['label', 'type'],
	additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------

export type BoardsFormsCreateProps = {
	boardId: string;
	targetListId: string;
	title: string;
	description?: string;
	fields: (Omit<IBoardFormField, 'id'> & { id?: string })[];
	titleTemplate?: string;
	enabled?: boolean;
	intakeRouting?: BoardFormIntakeRouting;
	intakeMapping?: IBoardFormIntakeMapping;
	caseproOrgId?: string;
	caseproSourceToken?: string;
};

const BoardsFormsCreateSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		targetListId: { type: 'string', minLength: 1 },
		title: { type: 'string', minLength: 1, maxLength: 200 },
		description: { type: 'string', nullable: true, maxLength: 4000 },
		fields: { type: 'array', minItems: 1, maxItems: 50, items: fieldSchema },
		titleTemplate: { type: 'string', nullable: true, maxLength: 300 },
		enabled: { type: 'boolean', nullable: true },
		...intakeRoutingProps,
	},
	required: ['boardId', 'targetListId', 'title', 'fields'],
	additionalProperties: false,
};

export const isBoardsFormsCreateProps = ajv.compile<BoardsFormsCreateProps>(BoardsFormsCreateSchema);

// ---------------------------------------------------------------------------
// POST — update (patch subset; boardId/slug are immutable)
// ---------------------------------------------------------------------------

export type BoardsFormsUpdateProps = {
	formId: string;
	targetListId?: string;
	title?: string;
	description?: string;
	fields?: BoardsFormsCreateProps['fields'];
	titleTemplate?: string;
	enabled?: boolean;
	intakeRouting?: BoardFormIntakeRouting;
	intakeMapping?: IBoardFormIntakeMapping;
	caseproOrgId?: string;
	caseproSourceToken?: string;
};

const BoardsFormsUpdateSchema = {
	type: 'object',
	properties: {
		formId: { type: 'string', minLength: 1 },
		targetListId: { type: 'string', nullable: true, minLength: 1 },
		title: { type: 'string', nullable: true, minLength: 1, maxLength: 200 },
		description: { type: 'string', nullable: true, maxLength: 4000 },
		fields: { type: 'array', nullable: true, minItems: 1, maxItems: 50, items: fieldSchema },
		titleTemplate: { type: 'string', nullable: true, maxLength: 300 },
		enabled: { type: 'boolean', nullable: true },
		...intakeRoutingProps,
	},
	required: ['formId'],
	additionalProperties: false,
};

export const isBoardsFormsUpdateProps = ajv.compile<BoardsFormsUpdateProps>(BoardsFormsUpdateSchema);

// ---------------------------------------------------------------------------
// GET — list / POST — delete
// ---------------------------------------------------------------------------

type BoardsFormsListProps = { boardId: string };

export const isBoardsFormsListProps = ajvQuery.compile<BoardsFormsListProps>({
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
});

type BoardsFormsDeleteProps = { formId: string };

export const isBoardsFormsDeleteProps = ajv.compile<BoardsFormsDeleteProps>({
	type: 'object',
	properties: { formId: { type: 'string', minLength: 1 } },
	required: ['formId'],
	additionalProperties: false,
});

// ---------------------------------------------------------------------------
// PUBLIC — get (render payload) / submit
// ---------------------------------------------------------------------------

type BoardsFormsPublicGetProps = { slug: string };

export const isBoardsFormsPublicGetProps = ajvQuery.compile<BoardsFormsPublicGetProps>({
	type: 'object',
	properties: { slug: { type: 'string', minLength: 20, maxLength: 128 } },
	required: ['slug'],
	additionalProperties: false,
});

export type BoardsFormsPublicSubmitProps = { slug: string; answers: Record<string, unknown> };

export const isBoardsFormsPublicSubmitProps = ajv.compile<BoardsFormsPublicSubmitProps>({
	type: 'object',
	properties: {
		slug: { type: 'string', minLength: 20, maxLength: 128 },
		// data-driven: validated strictly against the form's field defs in the service
		answers: { type: 'object' },
	},
	required: ['slug', 'answers'],
	additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * Everything a public (unauthenticated) caller may learn about a form. Never add
 * board/list/user identifiers or counters here — the slug must not leak workspace
 * metadata beyond what is required to render the form.
 */
export type PublicBoardFormDTO = {
	title: string;
	description?: string;
	fields: IBoardFormField[];
};

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type BoardsFormsEndpoints = {
	'/v1/boards.forms.create': {
		POST: (params: BoardsFormsCreateProps) => { form: IBoardForm };
	};
	'/v1/boards.forms.update': {
		POST: (params: BoardsFormsUpdateProps) => { form: IBoardForm };
	};
	'/v1/boards.forms.delete': {
		POST: (params: BoardsFormsDeleteProps) => { ok: true };
	};
	'/v1/boards.forms.list': {
		GET: (params: BoardsFormsListProps) => { forms: IBoardForm[] };
	};
	'/v1/boards.forms.public.get': {
		GET: (params: BoardsFormsPublicGetProps) => { form: PublicBoardFormDTO };
	};
	'/v1/boards.forms.public.submit': {
		POST: (params: BoardsFormsPublicSubmitProps) => { ok: true };
	};
};
