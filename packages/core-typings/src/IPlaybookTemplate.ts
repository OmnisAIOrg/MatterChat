import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Stage playbook: a per-stage checklist/task template (Tier 2, collection
 * `boards_playbooks`). When a card enters the matching stage column (matters) or
 * status column (leads), the automation engine applies this template's items as
 * checklist entries and/or auto-created tasks on the card.
 *
 * Targeting is by `pipelineType` + EITHER `stageKey` (a stable CasePro stage key,
 * e.g. matter_stages.id / intake_stages.id) OR `listName` (case-insensitive
 * column-name match) — listName is the firm-portable fallback when stage ids
 * differ between firms. See matters-case-management.md §4 and §10.
 */

export type PlaybookPipelineType = 'matters' | 'leads';

export type PlaybookItemKind = 'checklist' | 'task';

/** One templated item applied when a card enters the playbook's stage. */
export interface IPlaybookItem {
	id: string; // template-local id (nanoid), stable across edits
	kind: PlaybookItemKind;
	title: string;
	description?: string;
	/** Default assignee role to resolve at apply-time (attorney/paralegal/case-manager/owner). */
	assigneeRole?: 'attorney' | 'paralegal' | 'case-manager' | 'owner' | 'intake';
	/** Days after entering the stage that the derived task/checklist item is due. */
	dueOffsetDays?: number;
	/** If this item should also create a deadline, the kind to stamp (see IBoardDeadline). */
	createsDeadlineKind?: 'SOL' | 'filing' | 'discovery' | 'mediation' | 'response' | 'custom';
	required?: boolean; // blocks stage advance / shown as mandatory
	order: number;
}

export interface IPlaybookTemplate extends IRocketChatRecord {
	name: string;
	description?: string;
	pipelineType: PlaybookPipelineType;

	// targeting (one or both; stageKey preferred, listName is the portable fallback)
	stageKey?: string; // -> matter_stages.id | intake_stages.id (stable stage key)
	listName?: string; // case-insensitive column-name match fallback

	// scoping
	caseTypeId?: string; // -> CasePro case_types.id (practice-area-specific playbook)
	boardId?: string; // optional board scoping; unset = applies on the canonical board

	items: IPlaybookItem[];

	enabled: boolean; // toggled off without deleting
	isSystem?: boolean; // seeded default vs. firm-authored
	appliesOnEnter: boolean; // apply when a card enters the stage (vs. manual apply only)

	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
	updatedBy?: IUser['_id'];
	updatedAt: Date;
}
