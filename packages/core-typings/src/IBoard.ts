import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

export type BoardsPipelineType = 'leads' | 'matters' | 'general';

/**
 * Lifecycle status of a board. `archived` mirrors the boolean `archived` flag
 * (kept for back-compat); the others are non-archived working states.
 */
export type BoardsStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export type BoardsFieldType =
	| 'text'
	| 'number'
	| 'date'
	| 'checkbox'
	| 'dropdown'
	| 'member'
	| 'currency'
	| 'phone'
	| 'email'
	| 'url';

export interface IBoardMember {
	userId: IUser['_id'];
	role: 'admin' | 'member' | 'observer';
}

export interface IBoardLabelDef {
	id: string; // board-local id (nanoid)
	name: string;
	color: string;
}

export interface IBoardFieldDef {
	id: string; // board-local id (nanoid)
	name: string;
	type: BoardsFieldType;
	options?: { id: string; label: string; color?: string }[]; // dropdown only
	showOnFront: boolean;
	position: number;
}

export interface IBoardBackground {
	kind: 'color' | 'image';
	value: string;
}

/**
 * CasePro pipeline binding. When set, lists were generated from a CasePro
 * pipeline and each carries a `caseproStageId`. Owned/populated by the CasePro
 * integration subsystem (M2); declared here so the board doc is fully typed now.
 */
export interface IBoardCaseProSync {
	matterStageMap?: Record<string, string>; // listId -> matter_stages.id
	intakeStageMap?: Record<string, string>; // listId -> intake_stages.id
	/**
	 * Opt-in per-board card→CasePro-task PUSH sync (default off). When true,
	 * card create/retitle/due-date/complete on this board upserts a CasePro
	 * `tasks` row (source:'MatterChat', external_ref = card _id). Push-only:
	 * CasePro emits no task events, so there is no pull direction.
	 */
	taskSyncEnabled?: boolean;
}

export interface IBoard extends IRocketChatRecord {
	title: string;
	pipelineType: BoardsPipelineType;
	description?: string;

	teamId?: string; // Rocket.Chat Team _id (workspace)
	rid?: string; // bound Rocket.Chat channel _id

	background?: IBoardBackground;
	icon?: string; // fuselage icon name e.g. 'kanban' | 'briefcase'

	members: IBoardMember[];
	labelDefs: IBoardLabelDef[];
	fieldDefs: IBoardFieldDef[];

	starredBy?: IUser['_id'][];
	visibility: 'private' | 'team' | 'shared';

	caseproSync?: IBoardCaseProSync;

	/**
	 * OPT-IN email-to-task intake (Phase 3, default absent = off). When set, an email delivered to this
	 * board's intake address becomes a card on `targetListId`, created AS `ownerUserId` (a board member,
	 * so ACL/activity/numbering behave as if they created it — the forms public-submit precedent). The
	 * `token` is a high-entropy secret (43-char Random.secret, iCal-token precedent) embedded in the
	 * plus-addressed intake address (`boards+<token>@…`), so the address is an unguessable capability;
	 * an unknown token resolves to nothing (non-probeable). Never carries a mail password — the mail
	 * provider forwards to the HMAC-signed webhook, this just routes the resolved email to a board.
	 */
	emailIntake?: {
		token: string;
		ownerUserId: IUser['_id'];
		targetListId: string;
		enabled: boolean;
	};

	// monotonic per-board counter backing card shortlink numbers (see nextCardNumber)
	cardCounter: number;

	schemaVersion: number;
	archived: boolean;
	// Lifecycle status. Optional for back-compat: absent ⇒ treat as 'active'
	// (or 'archived' when the boolean `archived` flag is set).
	status?: BoardsStatus;
	rev: number;
	createdBy: IUser['_id'];
	createdAt: Date;
}
