import { ajv } from './Ajv';

/**
 * REST validators + endpoint types for the Boards AI surface (M8 — §B "AI").
 *
 * `boards.ai.*` — on-demand AI generation for board cards (the manual counterpart to the
 * `ai.generate` automation action), all gated by `boards-ai-generate`:
 *
 *   POST boards.ai.summarizeMatter — Claude summary of a matter card's cached snapshot
 *   POST boards.ai.draftDemand     — Stowers demand draft (LitDraft) for a matter card
 *   POST boards.ai.generate        — free-form generate({task, context, prompt?})
 *
 * The AI result shape is owned by the provider seam (server/lib/boards/ai); ajv only guards
 * the wire surface (the same permissive `successSchema` approach boards-automations.ts uses
 * for large/nested payloads).
 */

// ---------------------------------------------------------------------------
// boards.ai.summarizeMatter / boards.ai.draftDemand — { cardId }
// ---------------------------------------------------------------------------

type BoardsAiCardProps = { cardId: string };

const BoardsAiCardSchema = {
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
};

export const isBoardsAiSummarizeMatterProps = ajv.compile<BoardsAiCardProps>(BoardsAiCardSchema);
export const isBoardsAiDraftDemandProps = ajv.compile<BoardsAiCardProps>(BoardsAiCardSchema);

// ---------------------------------------------------------------------------
// boards.ai.generate — { task, context, prompt? }
// ---------------------------------------------------------------------------

// `context` is a pre-rendered, human-readable block (the caller assembles it, or passes
// a cardId-derived block); `task` selects the provider routing (demand → LitDraft).
type BoardsAiGenerateProps = {
	task: 'summary' | 'demand' | 'custom';
	context: string;
	prompt?: string;
	/** Optional matter/lead id the provider may use for its own records. */
	subjectId?: string;
	kind?: 'matter' | 'lead' | 'card';
};

const BoardsAiGenerateSchema = {
	type: 'object',
	properties: {
		task: { type: 'string', enum: ['summary', 'demand', 'custom'] },
		context: { type: 'string' },
		prompt: { type: 'string', nullable: true },
		subjectId: { type: 'string', nullable: true },
		kind: { type: 'string', enum: ['matter', 'lead', 'card'], nullable: true },
	},
	required: ['task', 'context'],
	additionalProperties: false,
};

export const isBoardsAiGenerateProps = ajv.compile<BoardsAiGenerateProps>(BoardsAiGenerateSchema);

// ---------------------------------------------------------------------------
// Endpoint map
// ---------------------------------------------------------------------------

// The provider result the endpoints return (mirrors AiGenerateOutput in the lib seam).
type AiResult = {
	generated: boolean;
	text: string;
	provider: 'claude' | 'litdraft' | 'none';
	note?: string;
};

export type BoardsAiEndpoints = {
	'/v1/boards.ai.summarizeMatter': {
		POST: (params: BoardsAiCardProps) => { result: AiResult };
	};
	'/v1/boards.ai.draftDemand': {
		POST: (params: BoardsAiCardProps) => { result: AiResult };
	};
	'/v1/boards.ai.generate': {
		POST: (params: BoardsAiGenerateProps) => { result: AiResult };
	};
};
