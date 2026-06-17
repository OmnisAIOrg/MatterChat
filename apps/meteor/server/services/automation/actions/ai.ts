import type { IActionAiGenerate } from '@rocket.chat/core-typings';
import { BoardsActivities, BoardsCards, BoardsLeads } from '@rocket.chat/models';

import { generate, buildMatterContext, buildLeadContext, buildCardContext, type AiTask, type AiContext } from '../../../lib/boards/ai';
import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * AI action handler (M7 §5.3 "ai.generate" — wired to a REAL provider in M8 §B).
 *
 * `aiGenerate` produces a Stowers demand draft (routed to LitDraft) or a matter/lead
 * summary/description (Claude) and writes it to a target field, or attaches it to the
 * card description when no `targetFieldId` is set. The provider seam + transport +
 * graceful-degrade live in server/lib/boards/ai; this handler only:
 *   1. resolves the subject context (matter snapshot / lead / plain card),
 *   2. interpolates any prompt override,
 *   3. calls generate(), and
 *   4. records the outcome (write field/description on success, audit note on degrade).
 *
 * dry-run: describe only — NEVER calls the provider (no API/LitDraft request on a dry run).
 * On a degraded result (no key / no URL / provider 'none' / transport error) the action is
 * `skipped` with the provider's note; it never throws and never fabricates content.
 */

/** Map the action's `kind` to the provider task. `description` is a summary into a field. */
function taskForKind(kind: IActionAiGenerate['kind']): AiTask {
	switch (kind) {
		case 'demand':
			return 'demand';
		case 'summary':
		case 'description':
			return 'summary';
		default:
			return 'custom';
	}
}

/**
 * Build the AI context for the run subject:
 *  - matter-linked card → its cached matter snapshot (no live CasePro read here),
 *  - lead subject (direct, or the card's lead link) → the lead,
 *  - otherwise → the plain card (title + description).
 * Returns null when there's nothing to summarize.
 */
async function resolveContext(ctx: AutomationContext): Promise<AiContext | null> {
	const card = ctx.subject.card;

	// Prefer a matter snapshot (the demand/summary domain) when the card is matter-linked.
	const snapshot = ctx.subject.snapshot ?? (card?.link?.kind === 'matter' ? card.link.snapshot : undefined);
	if (snapshot) {
		return buildMatterContext(snapshot);
	}

	// Lead domain: direct lead subject, or the card's lead link.
	const lead = ctx.subject.lead ?? (card ? await BoardsLeads.findOneByCardId(card._id) : null);
	if (lead) {
		return buildLeadContext(lead);
	}

	// Fall back to the plain card.
	if (card) {
		return buildCardContext(card);
	}
	return null;
}

export async function handleAiGenerate(action: IActionAiGenerate, ctx: AutomationContext, index: number) {
	try {
		const card = ctx.subject.card;
		if (!card) {
			return skipped(index, action.type, 'unsupported', 'aiGenerate requires a subject card');
		}

		const task = taskForKind(action.kind);

		// dry-run: describe the planned generation, never hit the provider.
		if (ctx.dryRun) {
			return planned(index, action.type, `ai ${action.kind}${action.targetFieldId ? ` -> field ${action.targetFieldId}` : ''}`);
		}

		const context = await resolveContext(ctx);
		if (!context) {
			return skipped(index, action.type, 'unsupported', 'aiGenerate found no matter/lead/card context');
		}

		const prompt = action.prompt ? interpolateString(action.prompt, ctx).value : undefined;

		const result = await generate({ task, context, ...(prompt ? { prompt } : {}) });

		if (!result.generated) {
			// Degraded (no key/url, provider 'none', refusal, or transport error). Record the
			// pending request as a clean audit seam; do NOT fabricate content, do NOT throw.
			await BoardsActivities.log({
				boardId: ctx.boardId,
				listId: card.listId,
				cardId: card._id,
				actor: `automation:${ctx.automation._id}`,
				verb: 'automation.ran',
				to: {
					aiGenerate: action.kind,
					provider: result.provider,
					generated: false,
					note: result.note,
					...(action.targetFieldId ? { targetFieldId: action.targetFieldId } : {}),
				},
				ts: new Date(),
			});
			return skipped(index, action.type, 'unsupported', result.note ?? `AI not available for "${action.kind}"`);
		}

		// Real text produced — write to the target field, else attach to the card description.
		if (action.targetFieldId) {
			await BoardsCards.setFieldValue(card._id, action.targetFieldId, result.text);
		} else {
			await BoardsCards.updateOne({ _id: card._id }, { $set: { description: result.text }, $inc: { rev: 1 } });
		}

		await BoardsActivities.log({
			boardId: ctx.boardId,
			listId: card.listId,
			cardId: card._id,
			actor: `automation:${ctx.automation._id}`,
			verb: 'automation.ran',
			to: {
				aiGenerate: action.kind,
				provider: result.provider,
				generated: true,
				chars: result.text.length,
				...(action.targetFieldId ? { targetFieldId: action.targetFieldId } : {}),
			},
			ts: new Date(),
		});

		return ok(index, action.type, `generated ${action.kind} via ${result.provider} (${result.text.length} chars)`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}
