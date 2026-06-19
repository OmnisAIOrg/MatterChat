import type {
	IActionAddLabel,
	IActionRemoveLabel,
	IActionMove,
	IActionSetField,
	IActionAssignMember,
	IActionUnassignMember,
	IActionSetDue,
	IActionCompleteDue,
	IActionSetCover,
	IActionComment,
	IActionCreateCard,
	IActionArchiveCard,
	IActionAddChecklist,
	IActionCreateDeadline,
	IActionCreateTask,
	IBoardCard,
	ICardComment,
	IChecklist,
	IChecklistItem,
} from '@rocket.chat/core-typings';
import { Boards, BoardsCards, BoardsLeads } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';

import { moveCard, updateCard, createCard, archiveCard } from '../../../lib/boards/service';
import { createDeadline } from '../../../lib/boards/matters/deadlines';
import { applyPlaybookToCard } from '../../../lib/boards/matters/playbooks';
import { createTask as createIntakeTask } from '../../../lib/boards/leads/intakeTasks';
import type { AutomationContext } from '../context';
import { resolveDateValue } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * Card-mutating action handlers (M7 — §5.3 "Actions — Card"). Each reuses the M1 card
 * service / M5 deadline + playbook / M6 intake-task functions so the write goes through
 * the canonical gate → model write → audit → re-emit path (actions are NOT a second
 * write path). The acting user is `ctx.actor`; system/cascade actors fall back to the
 * card creator so the M1 board-role assert still passes for engine-driven mutations.
 *
 * Position math is borrowed from the M1 service convention (append to the list end).
 */

const POSITION_STEP = 1024;

/** Resolve the user id a board-role-gated mutation should run as. */
function actingUid(ctx: AutomationContext, card?: IBoardCard): string {
	if (ctx.actor && ctx.actor !== 'system' && !ctx.actor.startsWith('automation:')) {
		return ctx.actor;
	}
	// engine/cron actor: run as the card creator (a board member) so assertBoardRole passes.
	return card?.createdBy ?? ctx.actor;
}

/** The subject card or a thrown not-found (callers turn it into an error result). */
function requireCard(ctx: AutomationContext): IBoardCard {
	const card = ctx.subject.card;
	if (!card) {
		throw new Error('action requires a subject card');
	}
	return card;
}

export async function handleAddLabel(action: IActionAddLabel, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `add label ${action.labelId}`);
		}
		await BoardsCards.addLabel(card._id, action.labelId);
		return ok(index, action.type, `added label ${action.labelId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleRemoveLabel(action: IActionRemoveLabel, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `remove label ${action.labelId}`);
		}
		await BoardsCards.removeLabel(card._id, action.labelId);
		return ok(index, action.type, `removed label ${action.labelId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleMove(action: IActionMove, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `move to list ${action.toListId}`);
		}
		const position =
			action.position === 'top'
				? (await BoardsCards.minPosition(action.toListId)) - POSITION_STEP
				: (await BoardsCards.maxPosition(action.toListId)) + POSITION_STEP;
		await moveCard(actingUid(ctx, card), card._id, action.toListId, position, action.subStatus);
		return ok(index, action.type, `moved to ${action.toListId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleSetField(action: IActionSetField, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `set field ${action.fieldId} = ${String(action.value)}`);
		}
		await BoardsCards.setFieldValue(card._id, action.fieldId, action.value);
		return ok(index, action.type, `set field ${action.fieldId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleAssignMember(action: IActionAssignMember, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		let userId = action.userId;
		if (!userId && action.roundRobin) {
			userId = await pickRoundRobinAssignee(card);
		}
		if (!userId) {
			return skipped(index, action.type, 'unsupported', 'no assignee resolved (no userId, empty round-robin pool)');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `assign ${userId}`);
		}
		const next = Array.from(new Set([...(card.assignees ?? []), userId]));
		await updateCard(actingUid(ctx, card), card._id, { assignees: next });
		return ok(index, action.type, `assigned ${userId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleUnassignMember(action: IActionUnassignMember, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `unassign ${action.userId}`);
		}
		const next = (card.assignees ?? []).filter((u) => u !== action.userId);
		await updateCard(actingUid(ctx, card), card._id, { assignees: next });
		return ok(index, action.type, `unassigned ${action.userId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleSetDue(action: IActionSetDue, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		const due = resolveDateValue(action.due, ctx);
		if (!due) {
			return skipped(index, action.type, 'unsupported', `unparseable due "${action.due}"`);
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `set due ${due.toISOString().slice(0, 10)}`);
		}
		await updateCard(actingUid(ctx, card), card._id, { dueDate: due, dueComplete: false });
		return ok(index, action.type, `set due ${due.toISOString().slice(0, 10)}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleCompleteDue(action: IActionCompleteDue, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, 'mark due complete');
		}
		await updateCard(actingUid(ctx, card), card._id, { dueComplete: true });
		return ok(index, action.type, 'marked due complete');
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleSetCover(action: IActionSetCover, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `set cover ${action.cover.kind}`);
		}
		await updateCard(actingUid(ctx, card), card._id, { cover: action.cover });
		return ok(index, action.type, `set cover ${action.cover.kind}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleComment(action: IActionComment, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `comment "${action.body.slice(0, 40)}"`);
		}
		const comment: ICardComment = {
			id: Random.id(),
			author: ctx.actor,
			body: action.body,
			mentions: [],
			ts: new Date(),
		};
		await BoardsCards.updateOne({ _id: card._id }, { $push: { comments: comment }, $inc: { rev: 1 } });
		// TODO(M8): when alsoPostToRoom and the matter card carries a channel-per-matter
		// room, fan the comment out to that room too.
		return ok(index, action.type, 'posted comment');
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleCreateCard(action: IActionCreateCard, ctx: AutomationContext, index: number) {
	try {
		if (ctx.dryRun) {
			return planned(index, action.type, `create card "${action.title}" in ${action.listId}`);
		}
		const card = await createCard(actingUid(ctx, ctx.subject.card), {
			boardId: ctx.boardId,
			listId: action.listId,
			title: action.title,
			...(action.description ? { description: action.description } : {}),
			...(action.cardType ? { cardType: action.cardType } : {}),
		});
		// fieldValues (best-effort, post-create).
		if (action.fieldValues) {
			for (const [fieldId, value] of Object.entries(action.fieldValues)) {
				// eslint-disable-next-line no-await-in-loop
				await BoardsCards.setFieldValue(card._id, fieldId, value).catch(() => undefined);
			}
		}
		return ok(index, action.type, `created card ${card._id}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleArchiveCard(action: IActionArchiveCard, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, 'archive card');
		}
		await archiveCard(actingUid(ctx, card), card._id);
		return ok(index, action.type, 'archived card');
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleAddChecklist(action: IActionAddChecklist, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, action.playbookId ? `apply playbook ${action.playbookId}` : `add checklist "${action.title ?? ''}"`);
		}
		// Playbook-backed: reuse the M5 materializer (idempotent, also stamps deadlines).
		if (action.playbookId) {
			const res = await applyPlaybookToCard(actingUid(ctx, card), card._id, action.playbookId);
			return ok(index, action.type, `applied playbook (+${res.checklistItemsAdded} items, +${res.deadlinesCreated} deadlines)`);
		}
		// Inline checklist.
		const items: IChecklistItem[] = (action.items ?? []).map((text, i) => ({
			id: Random.id(),
			text,
			done: false,
			position: i,
		}));
		const checklist: IChecklist = {
			id: Random.id(),
			title: action.title ?? 'Checklist',
			position: card.checklists?.length ?? 0,
			items,
		};
		await BoardsCards.updateOne({ _id: card._id }, { $push: { checklists: checklist }, $inc: { rev: 1 } });
		return ok(index, action.type, `added checklist (+${items.length} items)`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleCreateDeadline(action: IActionCreateDeadline, ctx: AutomationContext, index: number) {
	try {
		const card = requireCard(ctx);
		const due = resolveDateValue(action.due, ctx);
		if (!due) {
			return skipped(index, action.type, 'unsupported', `unparseable deadline due "${action.due}"`);
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `create ${action.kind} deadline ${due.toISOString().slice(0, 10)}`);
		}
		const deadline = await createDeadline(actingUid(ctx, card), {
			cardId: card._id,
			kind: action.kind,
			dueDate: due,
			...(action.label ? { label: action.label } : {}),
			...(action.highRisk !== undefined ? { highRisk: action.highRisk } : {}),
		});
		return ok(index, action.type, `created ${action.kind} deadline ${deadline._id}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleCreateTask(action: IActionCreateTask, ctx: AutomationContext, index: number) {
	try {
		// createTask is a LEAD-domain follow-up (intake worklist). Resolve the lead from
		// the subject (lead directly, or via the card's lead link).
		const lead = ctx.subject.lead ?? (ctx.subject.card ? await BoardsLeads.findOneByCardId(ctx.subject.card._id) : null);
		if (!lead) {
			return skipped(index, action.type, 'unsupported', 'createTask requires a lead subject');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `create task "${action.title}"`);
		}
		const dueAt = action.dueOffsetDays ? new Date(Date.now() + action.dueOffsetDays * 24 * 60 * 60 * 1000) : undefined;
		await createIntakeTask(ctx.actor, {
			leadId: lead._id,
			title: action.title,
			...(dueAt ? { dueAt } : {}),
			autoCreatedBy: 'sequence', // engine-created follow-up (origin marker; not the SLA/cold sweep)
		});
		return ok(index, action.type, `created task "${action.title}"`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

/**
 * Round-robin assignee across the card's board members (admins/members, not observers),
 * cursor-advanced on the board doc. Mirrors the leads-service round-robin intent without
 * coupling to its private cursor helper. Returns undefined when no eligible member.
 */
async function pickRoundRobinAssignee(card: IBoardCard): Promise<string | undefined> {
	const board = await Boards.findOneById(card.boardId);
	if (!board) {
		return undefined;
	}
	const pool = (board.members ?? []).filter((m) => m.role !== 'observer').map((m) => m.userId);
	if (pool.length === 0) {
		return undefined;
	}
	const cursorField = 'automationRoundRobinCursor';
	const cursor = (board as unknown as Record<string, number>)[cursorField] ?? 0;
	const pick = pool[cursor % pool.length];
	await Boards.updateOne({ _id: board._id }, { $set: { [cursorField]: (cursor + 1) % pool.length } }).catch(() => undefined);
	return pick;
}
