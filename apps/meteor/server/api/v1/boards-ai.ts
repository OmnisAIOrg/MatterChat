import {
	ajv,
	isBoardsAiSummarizeMatterProps,
	isBoardsAiDraftDemandProps,
	isBoardsAiGenerateProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';
import { BoardsCards, BoardsLeads } from '@rocket.chat/models';

import {
	generate,
	buildMatterContext,
	buildLeadContext,
	buildCardContext,
	type AiContext,
	type AiTask,
} from '../../lib/boards/ai';
import { caseProClient } from '../../lib/boards/matters';
import { hasPermissionAsync } from '../../lib/authorization/hasPermission';
import { API } from '../api';

/**
 * REST surface for Boards AI (M8 — §B "AI"). The manual counterpart to the `ai.generate`
 * automation action — same provider seam (server/lib/boards/ai), same graceful degrade.
 *
 *   POST boards.ai.summarizeMatter — Claude summary of a matter card (refreshes snapshot first)
 *   POST boards.ai.draftDemand     — Stowers demand draft (LitDraft) for a matter card
 *   POST boards.ai.generate        — free-form generate({task, context, prompt?})
 *
 * ALL gated by `boards-ai-generate` (board-scoped where a card resolves a boardId). Mirrors
 * boards-automations.ts: permissive `successSchema`, explicit hasPermissionAsync gate, and
 * `requireUid`-style auth via `authRequired`. The provider never throws — a degraded result
 * (`generated:false` + `note`) is returned as a 200 success carrying the result object, so
 * the client can show a "not configured / unavailable" state without an error toast.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

/** Load the card, gate `boards-ai-generate` on its board, and build matter/lead/card context. */
async function contextForCard(
	userId: string,
	cardId: string,
	opts: { refreshSnapshot?: boolean } = {},
): Promise<{ context: AiContext } | { error: 'not-found' | 'forbidden' }> {
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		return { error: 'not-found' };
	}
	if (!(await hasPermissionAsync(userId, 'boards-ai-generate', card.boardId))) {
		return { error: 'forbidden' };
	}

	// Matter card: prefer a FRESH snapshot for summaries/demands (best-effort — fall back to
	// the cached snapshot on any CasePro failure; never block generation on a degraded read).
	if (card.link?.kind === 'matter') {
		let snapshot = card.link.snapshot;
		if (opts.refreshSnapshot) {
			try {
				const fresh = await caseProClient.matterSnapshot(card.link.matterId);
				if (fresh) {
					snapshot = fresh;
				}
			} catch {
				/* CasePro unavailable — use the cached snapshot if present */
			}
		}
		if (snapshot) {
			return { context: buildMatterContext(snapshot) };
		}
	}

	// Lead-linked card → the lead.
	const lead = await BoardsLeads.findOneByCardId(card._id);
	if (lead) {
		return { context: buildLeadContext(lead) };
	}

	// Plain card.
	return { context: buildCardContext(card) };
}

API.v1.post(
	'boards.ai.summarizeMatter',
	{
		authRequired: true,
		body: isBoardsAiSummarizeMatterProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const resolved = await contextForCard(userId, this.bodyParams.cardId, { refreshSnapshot: true });
		if ('error' in resolved) {
			return resolved.error === 'forbidden' ? API.v1.unauthorized() : API.v1.failure('Card not found');
		}
		const result = await generate({ task: 'summary', context: resolved.context });
		return API.v1.success({ result });
	},
);

API.v1.post(
	'boards.ai.draftDemand',
	{
		authRequired: true,
		body: isBoardsAiDraftDemandProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const resolved = await contextForCard(userId, this.bodyParams.cardId, { refreshSnapshot: true });
		if ('error' in resolved) {
			return resolved.error === 'forbidden' ? API.v1.unauthorized() : API.v1.failure('Card not found');
		}
		const result = await generate({ task: 'demand', context: resolved.context });
		return API.v1.success({ result });
	},
);

API.v1.post(
	'boards.ai.generate',
	{
		authRequired: true,
		body: isBoardsAiGenerateProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// Free-form generate carries no card, so the gate is org-wide (no board scope).
		if (!(await hasPermissionAsync(userId, 'boards-ai-generate'))) {
			return API.v1.unauthorized();
		}
		const { task, context, prompt, subjectId, kind } = this.bodyParams;
		const aiContext: AiContext = {
			kind: kind ?? 'card',
			...(subjectId ? { subjectId } : {}),
			text: context,
		};
		const result = await generate({ task: task as AiTask, context: aiContext, ...(prompt ? { prompt } : {}) });
		return API.v1.success({ result });
	},
);
