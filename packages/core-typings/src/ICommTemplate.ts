import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Reusable email / SMS template (Tier 2, collection `boards_comm_templates`).
 * Powers the lead communication tooling (intake-lead-management.md §7): a
 * template carries a channel, an optional subject (email only), a body with
 * `{lead.*}` / `{firm.*}` interpolation tokens, and the declared `variables[]`
 * the UI offers when authoring. Drip-sequence steps (`ISequenceStep.templateId`)
 * reference these by id.
 *
 * `isSystem` marks the seeded firm-portable defaults (not user-deletable);
 * `practiceArea` optionally scopes a template to a CasePro case-type by name.
 */

export type CommTemplateChannel = 'email' | 'sms';

export interface ICommTemplate extends IRocketChatRecord {
	name: string;
	channel: CommTemplateChannel;
	subject?: string; // email only; ignored for sms
	body: string; // interpolation tokens: {lead.firstName}, {firm.name}, …
	variables?: string[]; // declared token names offered in the authoring UI
	practiceArea?: string; // optional case-type-name scoping (display/filter)
	isSystem?: boolean; // seeded default (firm-portable, undeletable)

	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
	updatedBy?: IUser['_id'];
	updatedAt?: Date;
}
