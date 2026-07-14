import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

export type BoardsCardType = 'task' | 'lead' | 'matter' | 'document' | 'evidence';

export type BoardsFieldValue = string | number | boolean | null;

export interface IChecklistItem {
	id: string;
	text: string;
	done: boolean;
	position: number;
	assignee?: IUser['_id'];
	dueDate?: Date;
	convertedCardId?: string;
}

export interface IChecklist {
	id: string;
	title: string;
	position: number;
	items: IChecklistItem[];
}

export interface IAttachment {
	id: string;
	source: 'litbox' | 'local' | 'url';
	ref: string; // litbox file/path id, RC upload _id, or url
	name: string;
	mimeType?: string;
	isCover?: boolean;
	addedBy: IUser['_id'];
	addedAt: Date;
}

export interface ICardComment {
	id: string;
	author: IUser['_id'];
	body: string;
	mentions: IUser['_id'][];
	reactions?: Record<string, IUser['_id'][]>; // emoji -> userIds
	ts: Date;
	editedAt?: Date;
}

/**
 * A logged-time entry (time tracking). Flat sub-document on the card, mirroring
 * ICardComment's id + IUser ref + Date timestamps. `minutes` is the logged
 * duration; `spentAt` is when the work happened (defaults to now on create).
 */
export interface ITimeEntry {
	id: string;
	userId: IUser['_id'];
	minutes: number;
	note?: string;
	spentAt: Date;
	createdAt: Date;
}

export interface ICardCover {
	kind: 'color' | 'image' | 'attachment';
	value: string;
}

/**
 * Denormalized CasePro matter render cache. The shape is OWNED by the CasePro
 * integration subsystem (M2) which is the only writer; declared here so a
 * `matter`-linked card is fully typed in M1. Real CasePro columns are cited
 * inline. Never the source of truth — always a read-through snapshot.
 */
export interface IMatterSnapshot {
	matterId: string; // CasePro matters.id
	matterName?: string;
	matterNumber?: string; // matters.matter_number
	causeNumber?: string;
	clientName?: string; // parties via matters.client_id
	practiceArea?: string; // case_types.name via matters.case_type
	stageId?: string; // matters.stage_id -> matter_stages
	stageName?: string;
	subStageId?: string; // matters.sub_stage -> matter_sub_stages
	subStageName?: string;
	incidentDate?: Date; // matters.incident_date (DOI)
	solDate?: Date; // matters.statute_of_limitations
	liabilityStatus?: string;
	providerCount?: number; // count medical_providers where matter_id
	totalBilled?: number; // Σ bills.total_amount (query-then-sum in JS)
	totalBalance?: number; // Σ bills.amount_due
	lastDemandAmount?: number; // negotiations row type LIKE '%Demand%'
	lastOfferAmount?: number; // negotiations row type LIKE '%Offer%'
	demandExpiration?: Date; // negotiations.expiration_date
	settlementAmount?: number; // resolutions.settlement_amount
	litboxWorkspaceId?: string; // matters.litbox_workspace_id
	medchronMatterId?: string; // matters.medchron_matter_id
	team?: { role: string; name: string }[]; // matter team-role string fields (display names)
	fetchedAt: Date;
	stale?: boolean;
}

/**
 * Typed payload — the polymorphic-card hybrid mechanism. One discriminated
 * union arm per cardType. `task` cards carry no link. The `matter` arm caches
 * an optional snapshot (written by M2); `lead`/`document`/`evidence` arms are
 * reserved for later milestones but typed now.
 */
export type IBoardCardLink =
	| { kind: 'lead'; leadId: string } // -> boards_leads._id
	| { kind: 'matter'; matterId: string; roomId?: string; snapshot?: IMatterSnapshot; snapshotAt?: Date } // CasePro matters.id; roomId = bound RC channel
	| { kind: 'document'; litboxRef: string } // LitBox path/id
	| { kind: 'evidence'; evidenceId: string };

export interface IBoardCard extends IRocketChatRecord {
	boardId: string;
	listId: string;
	title: string;
	description?: string; // markdown
	position: number; // fractional rank within the list
	cardType: BoardsCardType;
	subStatus?: string; // one of list.subStatuses

	labels: string[]; // -> board.labelDefs[].id
	assignees: IUser['_id'][];
	watchers: IUser['_id'][];

	startDate?: Date;
	dueDate?: Date;
	dueComplete?: boolean;
	completed?: boolean; // Asana-style task-level "done" (independent of dueComplete and of archive)
	completedAt?: Date;
	completedBy?: IUser['_id'];
	priority?: 'low' | 'medium' | 'high' | 'urgent';
	isMilestone?: boolean; // Asana-style milestone marker (a key dated checkpoint; rendered as a diamond)
	approval?: {
		status: 'pending' | 'approved' | 'changes' | 'rejected';
		approvers?: IUser['_id'][];
		requestedBy?: IUser['_id'];
		decidedBy?: IUser['_id'];
		decidedAt?: Date;
	};
	cover?: ICardCover;

	fieldValues: Record<string, BoardsFieldValue>; // fieldDef.id -> value
	link?: IBoardCardLink; // typed payload

	checklists: IChecklist[];
	attachments: IAttachment[];
	comments: ICardComment[];
	timeEstimateMinutes?: number; // time-tracking estimate (minutes)
	timeEntries?: ITimeEntry[]; // logged-time entries

	cardNumber: number; // per-board sequential shortlink number
	relations?: { type: 'relates' | 'blocks' | 'blocked-by' | 'duplicate' | 'parent' | 'child'; cardId: string }[];
	mirrorOf?: string; // source card _id if this is a mirror

	// Recurring "routine" tasks. When a card carrying a recurrence rule is completed (dueComplete
	// flips true), the service materializes the next occurrence — a clone with the due date advanced
	// and checklists reset — and moves the rule onto that new card. The completed card becomes a plain
	// record. (A daily/weekly/monthly cadence is the personal-PM "routine" pillar.)
	recurrence?: {
		freq: 'daily' | 'weekly' | 'monthly';
		interval: number; // every N periods (>= 1)
		basis?: 'completion' | 'dueDate'; // anchor for the next due date (default 'completion')
		count?: number; // stop after N total occurrences (omitted = indefinitely)
		occurrencesDone?: number; // how many occurrences have been completed so far
	};

	archived: boolean;
	rev: number;
	createdBy: IUser['_id'];
	createdAt: Date;
}

/**
 * Filter struct used by the search endpoint / Table view. Server translates it
 * to a Mongo filter (text index for `text`, `$in` for labels/assignees/listIds,
 * computed date windows for `due`, dotted `fieldValues.<id>` for fieldFilters).
 */
export interface OmnisCardQuery {
	text?: string;
	labels?: string[];
	assignees?: string[]; // any-of, or 'me'
	cardType?: BoardsCardType[];
	due?: 'overdue' | 'today' | 'week' | 'none' | 'complete' | 'incomplete';
	listIds?: string[];
	fieldFilters?: { fieldId: string; op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'set' | 'unset'; value?: BoardsFieldValue }[];
	isOpen?: boolean; // archived:false
}
