import type { IAutomationAction, IAutomationActionResult, BoardAutomationActionType } from '@rocket.chat/core-typings';

import type { AutomationContext } from '../context';
import type { ActionHandler } from './types';
import {
	handleAddLabel,
	handleRemoveLabel,
	handleMove,
	handleSetField,
	handleAssignMember,
	handleUnassignMember,
	handleSetDue,
	handleCompleteDue,
	handleSetCover,
	handleComment,
	handleCreateCard,
	handleArchiveCard,
	handleAddChecklist,
	handleCreateDeadline,
	handleCreateTask,
} from './card';
import { handleNotify, handleNotifyEmail, handleNotifySms } from './notify';
import { handleEnrollSequence, handleStopSequence } from './sequence';
import { handleCaseproWriteback, handleLitboxRequestFolder } from './integration';
import { handleAiGenerate } from './ai';

/**
 * The action registry (M7 — 05-automation-engine.md §4 "ACTION_REGISTRY"): one handler
 * per {@link BoardAutomationActionType}. The runner looks up the subject action's `type`
 * and invokes its handler. Every arm of the `IAutomationAction` discriminated union is
 * covered — a missing type would surface as a TS error here (the union is exhaustive),
 * and at runtime an unknown type returns an `unsupported` skip.
 */
export const ACTION_REGISTRY: Record<BoardAutomationActionType, ActionHandler<never>> = {
	// card
	addLabel: handleAddLabel as ActionHandler<never>,
	removeLabel: handleRemoveLabel as ActionHandler<never>,
	move: handleMove as ActionHandler<never>,
	setField: handleSetField as ActionHandler<never>,
	assignMember: handleAssignMember as ActionHandler<never>,
	unassignMember: handleUnassignMember as ActionHandler<never>,
	setDue: handleSetDue as ActionHandler<never>,
	completeDue: handleCompleteDue as ActionHandler<never>,
	setCover: handleSetCover as ActionHandler<never>,
	comment: handleComment as ActionHandler<never>,
	createCard: handleCreateCard as ActionHandler<never>,
	archiveCard: handleArchiveCard as ActionHandler<never>,
	addChecklist: handleAddChecklist as ActionHandler<never>,
	// matter depth
	createDeadline: handleCreateDeadline as ActionHandler<never>,
	createTask: handleCreateTask as ActionHandler<never>,
	// notify / communicate
	notify: handleNotify as ActionHandler<never>,
	notifyEmail: handleNotifyEmail as ActionHandler<never>,
	notifySms: handleNotifySms as ActionHandler<never>,
	enrollSequence: handleEnrollSequence as ActionHandler<never>,
	stopSequence: handleStopSequence as ActionHandler<never>,
	// integration (P3, gated)
	caseproWriteback: handleCaseproWriteback as ActionHandler<never>,
	litboxRequestFolder: handleLitboxRequestFolder as ActionHandler<never>,
	aiGenerate: handleAiGenerate as ActionHandler<never>,
};

/**
 * Run a single action through its registry handler. Falls back to an `unsupported` skip
 * for an unknown type (defensive — the union is exhaustive at compile time). Never throws.
 */
export async function runAction(action: IAutomationAction, ctx: AutomationContext, index: number): Promise<IAutomationActionResult> {
	const handler = ACTION_REGISTRY[action.type];
	if (!handler) {
		return { index, type: action.type, ok: false, status: 'skipped', skippedReason: 'unsupported' };
	}
	return handler(action as never, ctx, index);
}

export type { ActionHandler };
