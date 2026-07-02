import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * A per-board intake FORM (collection `boards_forms`) — the generic Trello/Asana-style
 * form builder: a board member designs an ordered set of fields, shares an unguessable
 * public link, and every submission becomes a card in the form's target list. Fully
 * standalone (works on a plain general/task board); no CasePro dependency.
 *
 * `slug` is the security boundary of the public URL: a 43-char `Random.secret()`
 * (~256 bits), the same generator the public iCal feed token uses (`ical-token.ts`).
 * Knowing the slug grants exactly two capabilities: read the form definition
 * (title/description/fields — never board metadata) and submit one response.
 * Rotation = delete + recreate.
 */

export type BoardFormFieldType = 'text' | 'textarea' | 'select' | 'date' | 'checkbox' | 'email' | 'phone';

export interface IBoardFormField {
	/** Stable field key (Random.id()); answers are keyed by it and `titleTemplate` may reference it as `{{id}}`. */
	id: string;
	label: string;
	type: BoardFormFieldType;
	required?: boolean;
	/** Allowed values for `type: 'select'` (a submission must match one exactly). */
	options?: string[];
	placeholder?: string;
}

export interface IBoardForm extends IRocketChatRecord {
	boardId: string; // -> boards_boards._id
	/** List new submission cards land in (must belong to `boardId`). */
	targetListId: string; // -> boards_lists._id

	title: string;
	description?: string;
	/** Ordered — rendered on the public page and written into the card description in this order. */
	fields: IBoardFormField[];

	/**
	 * Card-title template with `{{<fieldId>}}` placeholders (e.g. `Intake — {{name}}`).
	 * Unset/blank renders as `<form title> submission`.
	 */
	titleTemplate?: string;

	/** Master switch: a disabled form 404s on both public routes (indistinguishable from unknown). */
	enabled: boolean;
	/** Unguessable public URL token (43-char Random.secret()). */
	slug: string;

	submissionCount: number;
	lastSubmissionAt?: Date;

	archived: boolean;
	rev: number;
	createdBy: IUser['_id'];
	createdAt: Date;
}
