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

/**
 * Where a public submission is routed IN ADDITION to the always-created card:
 *  - 'none'           — card only (the default; absent == 'none', byte-identical legacy behavior)
 *  - 'lead'           — also create a board lead via the leads service (which itself
 *                       write-throughs to CasePro when `CasePro_Enabled`)
 *  - 'casepro-direct' — also POST the mapped answers to CasePro's public intake
 *                       capture endpoint (`{CasePro_Intake_Capture_Base}/api/v1/
 *                       intake-questionnaires/capture?org=&source=`), no board lead.
 */
export type BoardFormIntakeRouting = 'none' | 'lead' | 'casepro-direct';

/**
 * Which form fields feed the intake contact/classification — the value of every
 * key is a form FIELD ID (validated to exist on save). Mirrors the shape the leads
 * service derives for its CasePro capture (`deriveCaptureInput`): contact
 * name/email/phone + case type + incident date.
 */
export interface IBoardFormIntakeMapping {
	fullName?: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	phone?: string;
	/** free-text/select case-type NAME (routed to lead.practiceArea / capture caseType — not a CasePro id). */
	caseType?: string;
	incidentDate?: string;
}

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

	/**
	 * Intake routing (absent == 'none'). NEVER exposed on the public surface —
	 * `PublicBoardFormDTO` stays a strict whitelist of title/description/fields.
	 */
	intakeRouting?: BoardFormIntakeRouting;
	/** Field-id mapping feeding the intake contact block; required keys enforced per routing mode. */
	intakeMapping?: IBoardFormIntakeMapping;
	/** CasePro org id for 'casepro-direct' (the capture endpoint's ?org= — validated server-side by CasePro). */
	caseproOrgId?: string;
	/** CasePro marketing-attribution source token for 'casepro-direct' (?source=). Never leaks publicly. */
	caseproSourceToken?: string;

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
