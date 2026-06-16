import type { IBoard, IBoardList, IBoardCard, IMatterSnapshot } from '@rocket.chat/core-typings';

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
};
