import type {
	IBoard,
	IBoardList,
	IBoardCard,
	IBoardDeadline,
	IMatterSnapshot,
	IPlaybookTemplate,
	BoardDeadlineKind,
	BoardDeadlineStatus,
} from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';

/**
 * REST validators + endpoint types for the Matters pipeline (M3a server).
 *
 * Two families:
 *  - `boards.matters.*` — board/list/card operations over the matters board
 *    (ensureBoard / bind / refreshSnapshot / seedFromCasePro).
 *  - `boards.casepro.*` — thin read-through wrappers over the parallel CasePro
 *    client (matterSnapshot / listMatters / listStages). The Matters UI calls
 *    `boards.casepro.matterSnapshot` and `boards.matters.ensureBoard`.
 *
 * Return shapes for the CasePro reads mirror the client contract in
 * `apps/meteor/server/lib/boards/matters/caseProClientTypes.ts` (kept in sync by hand;
 * rest-typings cannot import from apps/meteor).
 */

// ---------------------------------------------------------------------------
// boards.matters.* — POST bodies
// ---------------------------------------------------------------------------

type BoardsMattersEnsureBoardProps = Record<string, never>;

const BoardsMattersEnsureBoardSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsMattersEnsureBoardProps = ajv.compile<BoardsMattersEnsureBoardProps>(BoardsMattersEnsureBoardSchema);

type BoardsMattersBindProps = { boardId: string; listId: string; matterId: string };

const BoardsMattersBindSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		listId: { type: 'string', minLength: 1 },
		matterId: { type: 'string', minLength: 1 },
	},
	required: ['boardId', 'listId', 'matterId'],
	additionalProperties: false,
};

export const isBoardsMattersBindProps = ajv.compile<BoardsMattersBindProps>(BoardsMattersBindSchema);

type BoardsMattersRefreshSnapshotProps = { cardId: string };

const BoardsMattersRefreshSnapshotSchema = {
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
};

export const isBoardsMattersRefreshSnapshotProps = ajv.compile<BoardsMattersRefreshSnapshotProps>(
	BoardsMattersRefreshSnapshotSchema,
);

type BoardsMattersLinkChannelProps = { cardId: string };

const BoardsMattersLinkChannelSchema = {
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
};

export const isBoardsMattersLinkChannelProps = ajv.compile<BoardsMattersLinkChannelProps>(BoardsMattersLinkChannelSchema);

type BoardsMattersUnlinkChannelProps = { cardId: string };

const BoardsMattersUnlinkChannelSchema = {
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
};

export const isBoardsMattersUnlinkChannelProps = ajv.compile<BoardsMattersUnlinkChannelProps>(BoardsMattersUnlinkChannelSchema);

type BoardsMattersSeedFromCaseProProps = { boardId: string };

const BoardsMattersSeedFromCaseProSchema = {
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsMattersSeedFromCaseProProps = ajv.compile<BoardsMattersSeedFromCaseProProps>(
	BoardsMattersSeedFromCaseProSchema,
);

// ---------------------------------------------------------------------------
// boards.casepro.* — GET queries (thin wrappers over caseProClient)
// ---------------------------------------------------------------------------

type BoardsCaseProMatterSnapshotProps = { matterId: string };

const BoardsCaseProMatterSnapshotSchema = {
	type: 'object',
	properties: { matterId: { type: 'string', minLength: 1 } },
	required: ['matterId'],
	additionalProperties: false,
};

export const isBoardsCaseProMatterSnapshotProps = ajvQuery.compile<BoardsCaseProMatterSnapshotProps>(
	BoardsCaseProMatterSnapshotSchema,
);

type BoardsCaseProListMattersProps = {
	stageId?: string;
	caseTypeId?: string;
	query?: string;
	limit?: number;
	offset?: number;
};

const BoardsCaseProListMattersSchema = {
	type: 'object',
	properties: {
		stageId: { type: 'string', nullable: true },
		caseTypeId: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		limit: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsCaseProListMattersProps = ajvQuery.compile<BoardsCaseProListMattersProps>(BoardsCaseProListMattersSchema);

type BoardsCaseProListStagesProps = Record<string, never>;

const BoardsCaseProListStagesSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsCaseProListStagesProps = ajvQuery.compile<BoardsCaseProListStagesProps>(BoardsCaseProListStagesSchema);

// boards.casepro.taskSync.set — per-board opt-in for the card→CasePro-task PUSH sync
// (board.caseproSync.taskSyncEnabled; push-only, CasePro emits no task events).

type BoardsCaseProTaskSyncSetProps = { boardId: string; enabled: boolean };

const BoardsCaseProTaskSyncSetSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		enabled: { type: 'boolean' },
	},
	required: ['boardId', 'enabled'],
	additionalProperties: false,
};

export const isBoardsCaseProTaskSyncSetProps = ajv.compile<BoardsCaseProTaskSyncSetProps>(BoardsCaseProTaskSyncSetSchema);

// ---------------------------------------------------------------------------
// boards.matters.playbooks.* (M5)
// ---------------------------------------------------------------------------

type BoardsMattersPlaybooksListProps = Record<string, never>;

const BoardsMattersPlaybooksListSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsMattersPlaybooksListProps = ajvQuery.compile<BoardsMattersPlaybooksListProps>(
	BoardsMattersPlaybooksListSchema,
);

type BoardsMattersPlaybooksSeedProps = Record<string, never>;

const BoardsMattersPlaybooksSeedSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsMattersPlaybooksSeedProps = ajv.compile<BoardsMattersPlaybooksSeedProps>(
	BoardsMattersPlaybooksSeedSchema,
);

type BoardsMattersPlaybooksApplyProps = { cardId: string; playbookId: string };

const BoardsMattersPlaybooksApplySchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		playbookId: { type: 'string', minLength: 1 },
	},
	required: ['cardId', 'playbookId'],
	additionalProperties: false,
};

export const isBoardsMattersPlaybooksApplyProps = ajv.compile<BoardsMattersPlaybooksApplyProps>(
	BoardsMattersPlaybooksApplySchema,
);

// ---------------------------------------------------------------------------
// boards.matters.deadlines.* (M5 — the SOL/deadline engine)
// ---------------------------------------------------------------------------

type BoardsMattersDeadlinesListProps = { cardId?: string; boardId?: string; matterId?: string };

const BoardsMattersDeadlinesListSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', nullable: true },
		boardId: { type: 'string', nullable: true },
		matterId: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsMattersDeadlinesListProps = ajvQuery.compile<BoardsMattersDeadlinesListProps>(
	BoardsMattersDeadlinesListSchema,
);

type BoardsMattersDeadlinesCreateProps = {
	cardId: string;
	kind: BoardDeadlineKind;
	dueDate: string; // ISO date string
	label?: string;
	highRisk?: boolean;
	notes?: string;
};

const BoardsMattersDeadlinesCreateSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		kind: { type: 'string', enum: ['SOL', 'filing', 'discovery', 'mediation', 'response', 'custom'] },
		dueDate: { type: 'string', minLength: 1 },
		label: { type: 'string', nullable: true },
		highRisk: { type: 'boolean', nullable: true },
		notes: { type: 'string', nullable: true },
	},
	required: ['cardId', 'kind', 'dueDate'],
	additionalProperties: false,
};

export const isBoardsMattersDeadlinesCreateProps = ajv.compile<BoardsMattersDeadlinesCreateProps>(
	BoardsMattersDeadlinesCreateSchema,
);

type BoardsMattersDeadlinesAcknowledgeProps = { deadlineId: string };

const BoardsMattersDeadlinesAcknowledgeSchema = {
	type: 'object',
	properties: { deadlineId: { type: 'string', minLength: 1 } },
	required: ['deadlineId'],
	additionalProperties: false,
};

export const isBoardsMattersDeadlinesAcknowledgeProps = ajv.compile<BoardsMattersDeadlinesAcknowledgeProps>(
	BoardsMattersDeadlinesAcknowledgeSchema,
);

type BoardsMattersDeadlinesSetStatusProps = { deadlineId: string; status: BoardDeadlineStatus; waivedReason?: string };

const BoardsMattersDeadlinesSetStatusSchema = {
	type: 'object',
	properties: {
		deadlineId: { type: 'string', minLength: 1 },
		status: { type: 'string', enum: ['open', 'acknowledged', 'satisfied', 'waived', 'missed'] },
		waivedReason: { type: 'string', nullable: true },
	},
	required: ['deadlineId', 'status'],
	additionalProperties: false,
};

export const isBoardsMattersDeadlinesSetStatusProps = ajv.compile<BoardsMattersDeadlinesSetStatusProps>(
	BoardsMattersDeadlinesSetStatusSchema,
);

// ---------------------------------------------------------------------------
// boards.matters.reports.* + boards.matters.caseload (M5)
// ---------------------------------------------------------------------------

type BoardsMattersReportProps = Record<string, never>;

const BoardsMattersReportSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsMattersReportProps = ajvQuery.compile<BoardsMattersReportProps>(BoardsMattersReportSchema);

// ---------------------------------------------------------------------------
// Read-through result shapes (mirror caseProClientTypes.ts)
// ---------------------------------------------------------------------------

export type CaseProStageDTO = { id: string; name: string; orderIndex: number };

export type CaseProMatterListItemDTO = {
	matterId: string;
	matterName?: string;
	matterNumber?: string;
	stageId?: string;
	stageName?: string;
	clientName?: string;
	practiceArea?: string;
};

export type SeedFromCaseProResultDTO = { bound: number; skipped: number; total: number };

// M5 result shapes (mirror apps/meteor/server/lib/boards/matters/{playbooks,reports}.ts)

export type ApplyPlaybookResultDTO = {
	applied: IPlaybookTemplate[];
	checklistItemsAdded: number;
	deadlinesCreated: number;
};

export type SeedPlaybooksResultDTO = { created: number; existing: number; total: number };

export type CaseloadRowDTO = {
	assigneeId: string;
	openMatters: number;
	stageMix: Record<string, number>;
	solAtRisk: number;
	avgDaysInStage: number;
};

export type CaseloadReportDTO = {
	boardId: string;
	totalOpen: number;
	unassigned: number;
	rows: CaseloadRowDTO[];
};

export type AgingStageRowDTO = {
	listId: string;
	stageName: string;
	count: number;
	avgDaysInStage: number;
	p90DaysInStage: number;
	stuck: number;
};

export type StuckMatterDTO = {
	cardId: string;
	matterId: string;
	title: string;
	stageName: string;
	daysInStage: number;
	assignees: string[];
};

export type AgingReportDTO = {
	boardId: string;
	stages: AgingStageRowDTO[];
	stuckMatters: StuckMatterDTO[];
};

export type FinancialReportDTO = {
	boardId: string;
	matterCount: number;
	demandOutstanding: number;
	settledValue: number;
	totalBilled: number;
	totalBalance: number;
	projectedFees: number;
	settledMatters: number;
	feePct: number;
};

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type BoardsMattersEndpoints = {
	'/v1/boards.matters.ensureBoard': {
		POST: (params: BoardsMattersEnsureBoardProps) => { board: IBoard; lists: IBoardList[] };
	};
	'/v1/boards.matters.bind': {
		POST: (params: BoardsMattersBindProps) => { card: IBoardCard };
	};
	'/v1/boards.matters.refreshSnapshot': {
		POST: (params: BoardsMattersRefreshSnapshotProps) => { card: IBoardCard };
	};
	'/v1/boards.matters.linkChannel': {
		POST: (params: BoardsMattersLinkChannelProps) => { card: IBoardCard };
	};
	'/v1/boards.matters.unlinkChannel': {
		POST: (params: BoardsMattersUnlinkChannelProps) => { card: IBoardCard };
	};
	'/v1/boards.matters.seedFromCasePro': {
		POST: (params: BoardsMattersSeedFromCaseProProps) => { result: SeedFromCaseProResultDTO };
	};
	'/v1/boards.casepro.matterSnapshot': {
		GET: (params: BoardsCaseProMatterSnapshotProps) => { snapshot: IMatterSnapshot };
	};
	'/v1/boards.casepro.listMatters': {
		GET: (params: BoardsCaseProListMattersProps) => { matters: CaseProMatterListItemDTO[]; total: number };
	};
	'/v1/boards.casepro.listStages': {
		GET: (params: BoardsCaseProListStagesProps) => { stages: CaseProStageDTO[] };
	};
	'/v1/boards.casepro.taskSync.set': {
		POST: (params: BoardsCaseProTaskSyncSetProps) => { board: IBoard };
	};

	// M5 — Matters depth (playbooks / deadlines / reports / caseload)
	'/v1/boards.matters.playbooks.list': {
		GET: (params: BoardsMattersPlaybooksListProps) => { playbooks: IPlaybookTemplate[] };
	};
	'/v1/boards.matters.playbooks.seed': {
		POST: (params: BoardsMattersPlaybooksSeedProps) => { result: SeedPlaybooksResultDTO };
	};
	'/v1/boards.matters.playbooks.apply': {
		POST: (params: BoardsMattersPlaybooksApplyProps) => { result: ApplyPlaybookResultDTO };
	};
	'/v1/boards.matters.deadlines.list': {
		GET: (params: BoardsMattersDeadlinesListProps) => { deadlines: IBoardDeadline[] };
	};
	'/v1/boards.matters.deadlines.create': {
		POST: (params: BoardsMattersDeadlinesCreateProps) => { deadline: IBoardDeadline };
	};
	'/v1/boards.matters.deadlines.acknowledge': {
		POST: (params: BoardsMattersDeadlinesAcknowledgeProps) => { deadline: IBoardDeadline };
	};
	'/v1/boards.matters.deadlines.setStatus': {
		POST: (params: BoardsMattersDeadlinesSetStatusProps) => { deadline: IBoardDeadline };
	};
	'/v1/boards.matters.reports.aging': {
		GET: (params: BoardsMattersReportProps) => { report: AgingReportDTO };
	};
	'/v1/boards.matters.reports.financial': {
		GET: (params: BoardsMattersReportProps) => { report: FinancialReportDTO };
	};
	'/v1/boards.matters.caseload': {
		GET: (params: BoardsMattersReportProps) => { report: CaseloadReportDTO };
	};
};
