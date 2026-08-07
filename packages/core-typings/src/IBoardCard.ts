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
	incidentDescription?: string; // matters.description — read-only CasePro incident narrative (distinct from the editable board-card `description`)
	solDate?: Date; // matters.statute_of_limitations
	liabilityStatus?: string;
	providerCount?: number; // count medical_providers where matter_id
	providers?: { name: string; type?: string }[]; // medical_providers → related party.party_name + party.provider_type (backs the "Medical treatment" section)
	totalBilled?: number; // Σ bills.total_amount (query-then-sum in JS)
	totalBalance?: number; // Σ bills.amount_due
	expensesTotal?: number; // Σ expenses.amount (case costs advanced)
	lastDemandAmount?: number; // negotiations row type LIKE '%Demand%'
	lastOfferAmount?: number; // negotiations row type LIKE '%Offer%'
	demandExpiration?: Date; // negotiations.expiration_date
	settlementAmount?: number; // resolutions.settlement_amount
	litboxWorkspaceId?: string; // matters.litbox_workspace_id
	medchronMatterId?: string; // matters.medchron_matter_id
	team?: { role: string; name: string }[]; // matter team-role string fields (display names)
	fetchedAt: Date;
	stale?: boolean;
	/**
	 * Whether this snapshot reflects a real CasePro read. `true` (or absent, for
	 * back-compat with pre-existing snapshots) = the matter was resolved from CasePro.
	 * `false` = a PENDING placeholder: the channel/card is soft-linked to the matter id
	 * but CasePro was disabled, unreachable, or the matter did not resolve at bind time,
	 * so no details could be loaded. A later successful refresh (manual or on re-bind)
	 * fills it in and flips this to `true`. The card UI uses this to say "linked, but
	 * couldn't load matter details" instead of hard-failing the bind (standalone-first).
	 */
	resolved?: boolean;
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

	// Subtask hierarchy support (wave3 Subtasks v2). When a card is created as a subtask of another,
	// parentCardId points to its parent. A card can have multiple children (via relations child[]), but only
	// one parent. Supports 3-level nesting: root → subtask → sub-subtask. A subtask has its own assignee,
	// dueDate, description, comments, attachments, and completion state — it is a first-class card, not a
	// checklist item. Sub-subtasks are queries against relations; no separate collection.
	// When a parent is completed, all active subtasks cascade (optional auto-complete per automation settings).
	parentCardId?: string; // parent card _id (omitted for root cards)

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

	// Two-way calendar sync (Phase 3). When a user with a connected Google/Outlook calendar has a card
	// with a due date, the outbound sync creates a mirror event in their calendar and records the
	// correlation here (mirrors the connector `bridgedChannels.subscriptionId` / tasksync external_ref
	// pattern). One entry per (card, connection): a card assigned to two people who each connected a
	// calendar can carry two mirrors. Inbound reconcile reads `externalEventId` to update the same event
	// and reads `externalEtag`/`externalUpdatedAt` to detect a calendar-side change to reflect back onto
	// the card's due date. Absent = the card is not mirrored anywhere.
	calendarSync?: ICardCalendarSync[];

	archived: boolean;
	rev: number;
	createdBy: IUser['_id'];
	createdAt: Date;
}

/**
 * One card↔calendar-event correlation, stored on the card by the outbound sync. Keeps the external
 * event id (for update/delete) plus the provider's change markers so inbound reconcile can tell
 * whether the calendar side moved. Never carries a token — credentials live only on the connection.
 */
export interface ICardCalendarSync {
	/** The board-calendar connection (per-user) this mirror belongs to. -> boards_calendar_connections._id */
	connectionId: string;
	/** The MatterChat user who owns the connection the mirror lives in (denormalized for cheap scans). */
	userId: IUser['_id'];
	/** Provider-native event id, used to update/delete the mirror event (Google: event id; Graph: id). */
	externalEventId: string;
	/** Provider-native calendar id the event lives in ('primary' for Google, the Graph calendar id). */
	externalCalendarId: string;
	/** Provider ETag / changeKey captured at last write — inbound reconcile compares to detect edits. */
	externalEtag?: string;
	/** The event's last-modified time reported by the provider at last sync (inbound change detection). */
	externalUpdatedAt?: Date;
	/** The card `dueDate` value we last pushed — so we only re-push when the card side actually changes. */
	lastPushedDueDate?: Date;
	/** When this mirror was last written/reconciled. */
	syncedAt: Date;
}

/**
 * Filter struct used by the search endpoint / Table view. Server translates it
 * to a Mongo filter (text index for `text`, `$in` for labels/assignees/listIds,
 * computed date windows for `due`, dotted `fieldValues.<id>` for fieldFilters).
 */
export interface IOmnisCardQuery {
	text?: string;
	labels?: string[];
	assignees?: string[]; // any-of, or 'me'
	cardType?: BoardsCardType[];
	due?: 'overdue' | 'today' | 'week' | 'none' | 'complete' | 'incomplete';
	listIds?: string[];
	fieldFilters?: { fieldId: string; op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'set' | 'unset'; value?: BoardsFieldValue }[];
	isOpen?: boolean; // archived:false
}
