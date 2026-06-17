import type { IActionAiGenerate } from '@rocket.chat/core-typings';
import { BoardsActivities, BoardsCards } from '@rocket.chat/models';

import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * AI action handler (M7 — §5.3 "ai.generate", deferred). `aiGenerate` produces a Stowers
 * demand draft (via LitDraft) or a summary/description (via Claude) and writes it to a
 * target field or attaches it to the card.
 *
 * This phase ships a CLEAN PROVIDER SEAM ({@link IAiProvider}) with a stub default that
 * requires no live API key — it records the request and returns a placeholder so the
 * action chain never blocks. TODO: register a concrete provider (LitDraft demand endpoint /
 * Claude summarizer) via {@link setAiProvider} when the AI subsystem lands.
 */

export interface AiGenerateRequest {
	kind: 'demand' | 'summary' | 'description';
	prompt?: string;
	cardId?: string;
	boardId: string;
}

export interface AiGenerateResult {
	/** the generated text (empty from the stub provider). */
	text: string;
	/** whether a real provider produced this (false for the stub). */
	generated: boolean;
}

/** The pluggable AI backend. Default is a no-op stub; the AI subsystem registers the real one. */
export interface IAiProvider {
	generate(req: AiGenerateRequest): Promise<AiGenerateResult>;
}

/** Stub provider: no external call, no key — records intent and returns empty text. */
const stubAiProvider: IAiProvider = {
	async generate(): Promise<AiGenerateResult> {
		return { text: '', generated: false };
	},
};

let aiProvider: IAiProvider = stubAiProvider;

/** Register a concrete AI provider (called by the AI subsystem at startup). */
export function setAiProvider(provider: IAiProvider): void {
	aiProvider = provider;
}

export async function handleAiGenerate(action: IActionAiGenerate, ctx: AutomationContext, index: number) {
	try {
		const card = ctx.subject.card;
		if (!card) {
			return skipped(index, action.type, 'unsupported', 'aiGenerate requires a subject card');
		}
		const prompt = action.prompt ? interpolateString(action.prompt, ctx).value : undefined;
		if (ctx.dryRun) {
			return planned(index, action.type, `ai ${action.kind}${action.targetFieldId ? ` -> field ${action.targetFieldId}` : ''}`);
		}

		const result = await aiProvider.generate({
			kind: action.kind,
			...(prompt ? { prompt } : {}),
			cardId: card._id,
			boardId: ctx.boardId,
		});

		if (!result.generated) {
			// stub provider — record the request as a clean seam, do not fabricate content.
			await BoardsActivities.log({
				boardId: ctx.boardId,
				cardId: card._id,
				actor: `automation:${ctx.automation._id}`,
				verb: 'field.changed',
				to: { aiGenerate: action.kind, pending: true, targetFieldId: action.targetFieldId },
				ts: new Date(),
			});
			return skipped(index, action.type, 'unsupported', `no AI provider registered for "${action.kind}" (TODO: wire LitDraft/Claude)`);
		}

		// Real provider produced text — write to the target field, else attach as a comment-like note.
		if (action.targetFieldId) {
			await BoardsCards.setFieldValue(card._id, action.targetFieldId, result.text);
		} else {
			await BoardsCards.updateOne(
				{ _id: card._id },
				{ $set: { description: result.text }, $inc: { rev: 1 } },
			);
		}
		return ok(index, action.type, `generated ${action.kind} (${result.text.length} chars)`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}
