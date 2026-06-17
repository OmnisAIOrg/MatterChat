import type { IAutomation, IAutomationRun } from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';
import { type PaginatedRequest } from '../helpers/PaginatedRequest';

/**
 * REST validators + endpoint types for the Boards AUTOMATION ENGINE (M7 — the Butler).
 *
 * `boards.automations.*` — CRUD + run/dry-run over automations (rules, card/board buttons,
 * scheduled automations, drip-sequence definitions), plus the run-log read.
 *
 * Bodies that carry the automation document (create/update) are kept PERMISSIVE: the
 * engine service is the source of truth for the trigger/condition/action shapes (it
 * validates them), so ajv only guards the wire surface against junk + unknown top-level
 * keys — the same approach `boards-leads.ts` / `boards-matters.ts` take for large nested
 * docs. The trigger-event / kind / action enums live in core-typings (`IAutomation.ts`).
 */

// ---------------------------------------------------------------------------
// GET — list / get / runs.list
// ---------------------------------------------------------------------------

type BoardsAutomationsListProps = PaginatedRequest<{ boardId?: string; kind?: string; enabled?: string }>;

const BoardsAutomationsListSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		boardId: { type: 'string', nullable: true },
		kind: { type: 'string', nullable: true },
		enabled: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsAutomationsListProps = ajvQuery.compile<BoardsAutomationsListProps>(BoardsAutomationsListSchema);

type BoardsAutomationsGetProps = { automationId: string };

const BoardsAutomationsGetSchema = {
	type: 'object',
	properties: { automationId: { type: 'string', minLength: 1 } },
	required: ['automationId'],
	additionalProperties: false,
};

export const isBoardsAutomationsGetProps = ajvQuery.compile<BoardsAutomationsGetProps>(BoardsAutomationsGetSchema);

type BoardsAutomationsRunsListProps = PaginatedRequest<{ automationId?: string; boardId?: string; cardId?: string }>;

const BoardsAutomationsRunsListSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		automationId: { type: 'string', nullable: true },
		boardId: { type: 'string', nullable: true },
		cardId: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsAutomationsRunsListProps = ajvQuery.compile<BoardsAutomationsRunsListProps>(BoardsAutomationsRunsListSchema);

// ---------------------------------------------------------------------------
// POST — create / update / archive / run / dryRun
// ---------------------------------------------------------------------------

// Permissive automation body: name + boardId scope are the only hard requirements; the
// engine validates trigger/conditions/actions. `additionalProperties:true` lets the full
// doc through (kind/trigger/schedule/conditions/actions/sequence/icon/enabled/seedKey).
type BoardsAutomationsCreateProps = {
	name: string;
	boardId?: string;
	[key: string]: unknown;
};

const BoardsAutomationsCreateSchema = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1 },
		boardId: { type: 'string', nullable: true },
	},
	required: ['name'],
	additionalProperties: true,
};

export const isBoardsAutomationsCreateProps = ajv.compile<BoardsAutomationsCreateProps>(BoardsAutomationsCreateSchema);

type BoardsAutomationsUpdateProps = {
	automationId: string;
	patch: Record<string, unknown>;
};

const BoardsAutomationsUpdateSchema = {
	type: 'object',
	properties: {
		automationId: { type: 'string', minLength: 1 },
		patch: { type: 'object', additionalProperties: true },
	},
	required: ['automationId', 'patch'],
	additionalProperties: false,
};

export const isBoardsAutomationsUpdateProps = ajv.compile<BoardsAutomationsUpdateProps>(BoardsAutomationsUpdateSchema);

type BoardsAutomationsArchiveProps = { automationId: string };

const BoardsAutomationsArchiveSchema = {
	type: 'object',
	properties: { automationId: { type: 'string', minLength: 1 } },
	required: ['automationId'],
	additionalProperties: false,
};

export const isBoardsAutomationsArchiveProps = ajv.compile<BoardsAutomationsArchiveProps>(BoardsAutomationsArchiveSchema);

type BoardsAutomationsRunProps = { automationId: string; cardId?: string; leadId?: string };

const BoardsAutomationsRunSchema = {
	type: 'object',
	properties: {
		automationId: { type: 'string', minLength: 1 },
		cardId: { type: 'string', nullable: true },
		leadId: { type: 'string', nullable: true },
	},
	required: ['automationId'],
	additionalProperties: false,
};

export const isBoardsAutomationsRunProps = ajv.compile<BoardsAutomationsRunProps>(BoardsAutomationsRunSchema);

// dryRun accepts EITHER a saved automationId OR an inline automation body (editor preview).
type BoardsAutomationsDryRunProps = { automationId?: string; automation?: Record<string, unknown>; cardId?: string; leadId?: string };

const BoardsAutomationsDryRunSchema = {
	type: 'object',
	properties: {
		automationId: { type: 'string', nullable: true },
		automation: { type: 'object', additionalProperties: true, nullable: true },
		cardId: { type: 'string', nullable: true },
		leadId: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsAutomationsDryRunProps = ajv.compile<BoardsAutomationsDryRunProps>(BoardsAutomationsDryRunSchema);

// ---------------------------------------------------------------------------
// GET — templates.list / buttonsForBoard ; POST — templates.install
// ---------------------------------------------------------------------------

// templates.list — read the prebuilt template catalog (no params).
type BoardsAutomationsTemplatesListProps = Record<string, never>;

const BoardsAutomationsTemplatesListSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsAutomationsTemplatesListProps = ajvQuery.compile<BoardsAutomationsTemplatesListProps>(BoardsAutomationsTemplatesListSchema);

// templates.install — clone a catalog template onto a board.
type BoardsAutomationsTemplatesInstallProps = { templateId: string; boardId: string };

const BoardsAutomationsTemplatesInstallSchema = {
	type: 'object',
	properties: {
		templateId: { type: 'string', minLength: 1 },
		boardId: { type: 'string', minLength: 1 },
	},
	required: ['templateId', 'boardId'],
	additionalProperties: false,
};

export const isBoardsAutomationsTemplatesInstallProps = ajv.compile<BoardsAutomationsTemplatesInstallProps>(BoardsAutomationsTemplatesInstallSchema);

// buttonsForBoard — enabled card/board-button automations for a board (run surfaces).
type BoardsAutomationsButtonsForBoardProps = { boardId: string; cardType?: string };

const BoardsAutomationsButtonsForBoardSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		cardType: { type: 'string', nullable: true },
	},
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsAutomationsButtonsForBoardProps = ajvQuery.compile<BoardsAutomationsButtonsForBoardProps>(BoardsAutomationsButtonsForBoardSchema);

// ---------------------------------------------------------------------------
// Endpoint map
// ---------------------------------------------------------------------------

type RunSummary = { runId: string; status: string; actionsRun: unknown[] };

export type BoardsAutomationsEndpoints = {
	'/v1/boards.automations.list': {
		GET: (params: BoardsAutomationsListProps) => { automations: IAutomation[]; count: number; offset: number; total: number };
	};
	'/v1/boards.automations.get': {
		GET: (params: BoardsAutomationsGetProps) => { automation: IAutomation };
	};
	'/v1/boards.automations.create': {
		POST: (params: BoardsAutomationsCreateProps) => { automation: IAutomation };
	};
	'/v1/boards.automations.update': {
		POST: (params: BoardsAutomationsUpdateProps) => { automation: IAutomation };
	};
	'/v1/boards.automations.archive': {
		POST: (params: BoardsAutomationsArchiveProps) => { success: boolean };
	};
	'/v1/boards.automations.run': {
		POST: (params: BoardsAutomationsRunProps) => RunSummary;
	};
	'/v1/boards.automations.dryRun': {
		POST: (params: BoardsAutomationsDryRunProps) => RunSummary;
	};
	'/v1/boards.automations.runs.list': {
		GET: (params: BoardsAutomationsRunsListProps) => { runs: IAutomationRun[]; count: number; offset: number; total: number };
	};
	'/v1/boards.automations.templates.list': {
		GET: (params: BoardsAutomationsTemplatesListProps) => { templates: IAutomation[]; total: number };
	};
	'/v1/boards.automations.templates.install': {
		POST: (params: BoardsAutomationsTemplatesInstallProps) => { automation: IAutomation; alreadyInstalled: boolean; notes: string[] };
	};
	'/v1/boards.automations.buttonsForBoard': {
		GET: (params: BoardsAutomationsButtonsForBoardProps) => { automations: IAutomation[]; count: number; total: number };
	};
};
