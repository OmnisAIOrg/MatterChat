import type { IBoardCard, IUser } from '@rocket.chat/core-typings';
import { BoardsCards, BoardsActivities } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

import { assertBoardRole } from './permissions';
import { emitBoardEvent } from './events';

/**
 * Subtask management service functions (Subtasks v2 feature).
 * Supports 3-level nesting: root → subtask → sub-subtask.
 * A subtask is a first-class card with its own assignee, due date, description, comments, and attachments.
 */

/**
 * Create a subtask as a child of a parent card.
 * Validates nesting depth (max 3 levels) and updates the parent card's relations.
 */
export async function createSubtask(
	uid: string,
	boardId: string,
	parentCardId: string,
	params: {
		title: string;
		description?: string;
		assignees?: IUser['_id'][];
		dueDate?: Date;
	},
): Promise<IBoardCard> {
	// Fetch parent card
	const parentCard = await BoardsCards.findOneById(parentCardId);
	if (!parentCard || parentCard.boardId !== boardId) {
		throw new Meteor.Error('error-parent-card-not-found', 'Parent card not found', { method: 'boards.createSubtask' });
	}

	// Validate nesting depth: count ancestors to ensure we don't exceed 3 levels
	let depth = 1;
	let ancestor = parentCard;
	while (ancestor.parentCardId && depth < 3) {
		const ancestorCard = await BoardsCards.findOneById(ancestor.parentCardId);
		if (!ancestorCard || ancestorCard.boardId !== boardId) break;
		ancestor = ancestorCard;
		depth++;
	}
	if (depth >= 3) {
		throw new Meteor.Error('error-max-nesting-depth', 'Maximum subtask nesting level (3) reached', { method: 'boards.createSubtask' });
	}

	// Check permission on board
	await assertBoardRole(boardId, uid, 'member', 'boards.createSubtask');

	const title = params.title?.trim();
	if (!title) {
		throw new Meteor.Error('error-invalid-subtask-title', 'Subtask title is required', { method: 'boards.createSubtask' });
	}

	// Create the subtask card (it lives in the same list as the parent for now, but positioned as a child)
	const now = new Date();
	const subtaskCardNumber = await BoardsCards.countDocuments({ boardId }) + 1;

	const subtaskDoc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId,
		listId: parentCard.listId,
		title,
		description: params.description,
		position: parentCard.position + 0.5, // Slightly after parent (refinement: better positioning logic later)
		cardType: 'task',
		labels: [],
		assignees: params.assignees || [],
		watchers: [],
		checklists: [],
		attachments: [],
		comments: [],
		cardNumber: subtaskCardNumber,
		parentCardId, // Mark as child of parent
		relations: [], // Will add child edge to parent's relations below
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
		...(params.dueDate ? { dueDate: params.dueDate } : {}),
	};

	const { insertedId: subtaskCardId } = await BoardsCards.insertOne(subtaskDoc);

	// Update parent card's relations to include the new child
	const parentRelations = parentCard.relations || [];
	if (!parentRelations.find((r) => r.type === 'child' && r.cardId === subtaskCardId)) {
		parentRelations.push({ type: 'child', cardId: subtaskCardId });
		await BoardsCards.updateOne({ _id: parentCardId }, { $set: { relations: parentRelations, rev: parentCard.rev + 1 } });
	}

	// Log activity
	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'subtask.created',
		to: { cardId: subtaskCardId, title },
		details: { parentCardId },
		ts: now,
	});

	emitBoardEvent('subtask.created', { boardId, cardId: subtaskCardId, parentCardId, actor: uid });

	const subtask = await BoardsCards.findOneById(subtaskCardId);
	if (!subtask) {
		throw new Meteor.Error('error-subtask-creation-failed', 'Failed to create subtask', { method: 'boards.createSubtask' });
	}

	return subtask;
}

/**
 * Convert a checklist item to a subtask.
 * Creates a new card (subtask) and removes the checklist item from the parent card.
 */
export async function convertChecklistItemToSubtask(
	uid: string,
	boardId: string,
	cardId: string,
	checklistId: string,
	itemId: string,
): Promise<IBoardCard> {
	const parentCard = await BoardsCards.findOneById(cardId);
	if (!parentCard || parentCard.boardId !== boardId) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.convertChecklistItemToSubtask' });
	}

	// Check permission
	await assertBoardRole(boardId, uid, 'member', 'boards.convertChecklistItemToSubtask');

	// Find the checklist and item
	const checklist = parentCard.checklists?.find((c) => c.id === checklistId);
	if (!checklist) {
		throw new Meteor.Error('error-checklist-not-found', 'Checklist not found', { method: 'boards.convertChecklistItemToSubtask' });
	}

	const item = checklist.items.find((i) => i.id === itemId);
	if (!item) {
		throw new Meteor.Error('error-checklist-item-not-found', 'Checklist item not found', { method: 'boards.convertChecklistItemToSubtask' });
	}

	// Create subtask with the item's text as the title
	const subtask = await createSubtask(uid, boardId, cardId, {
		title: item.text,
		assignees: item.assignee ? [item.assignee] : [],
		dueDate: item.dueDate,
	});

	// Remove the checklist item
	const updatedChecklists = checklist.items.filter((i) => i.id !== itemId);
	const updatedChecklistsArray = parentCard.checklists?.map((c) => {
		if (c.id === checklistId) {
			return { ...c, items: updatedChecklists };
		}
		return c;
	}) || [];

	await BoardsCards.updateOne({ _id: cardId }, { $set: { checklists: updatedChecklistsArray, rev: parentCard.rev + 1 } });

	const now = new Date();
	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'subtask.converted_from_checklist',
		to: { cardId: subtask._id, title: subtask.title },
		details: { fromChecklistItem: item.text },
		ts: now,
	});

	emitBoardEvent('subtask.converted', { boardId, cardId: subtask._id, parentCardId: cardId, actor: uid });

	return subtask;
}

/**
 * Get all subtasks (children) of a card, recursively to support nested subtasks.
 */
export async function getSubtasks(boardId: string, cardId: string): Promise<IBoardCard[]> {
	const directChildren = await BoardsCards.find({ boardId, parentCardId: cardId }).toArray();

	// Recursively get sub-subtasks
	const allChildren = [...directChildren];
	for (const child of directChildren) {
		const grandchildren = await getSubtasks(boardId, child._id);
		allChildren.push(...grandchildren);
	}

	return allChildren;
}

/**
 * Get subtasks at a specific depth (1 = immediate children, 2 = grandchildren, etc.)
 */
export async function getSubtasksAtDepth(boardId: string, cardId: string, depth: number): Promise<IBoardCard[]> {
	if (depth <= 0) return [];

	const directChildren = await BoardsCards.find({ boardId, parentCardId: cardId }).toArray();

	if (depth === 1) {
		return directChildren;
	}

	// Recursively get deeper levels
	const deeper: IBoardCard[] = [];
	for (const child of directChildren) {
		const nextLevel = await getSubtasksAtDepth(boardId, child._id, depth - 1);
		deeper.push(...nextLevel);
	}

	return deeper;
}

/**
 * Delete a subtask and optionally move its children to its parent.
 */
export async function deleteSubtask(
	uid: string,
	boardId: string,
	subtaskCardId: string,
	opts?: { promoteChildren?: boolean },
): Promise<void> {
	const subtask = await BoardsCards.findOneById(subtaskCardId);
	if (!subtask || subtask.boardId !== boardId) {
		throw new Meteor.Error('error-subtask-not-found', 'Subtask not found', { method: 'boards.deleteSubtask' });
	}

	// Check permission
	await assertBoardRole(boardId, uid, 'member', 'boards.deleteSubtask');

	// Archive the subtask (soft delete)
	const now = new Date();
	await BoardsCards.updateOne({ _id: subtaskCardId }, { $set: { archived: true, rev: subtask.rev + 1 } });

	// If promoteChildren is true and the subtask has a parent, move children to grandparent
	if (opts?.promoteChildren && subtask.parentCardId) {
		const children = await getSubtasksAtDepth(boardId, subtaskCardId, 1);
		for (const child of children) {
			await BoardsCards.updateOne({ _id: child._id }, { $set: { parentCardId: subtask.parentCardId, rev: child.rev + 1 } });
		}
	}

	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'subtask.deleted',
		to: { cardId: subtaskCardId, title: subtask.title },
		ts: now,
	});

	emitBoardEvent('subtask.deleted', { boardId, cardId: subtaskCardId, actor: uid });
}

/**
 * Update a subtask (e.g., change assignees, due date, description)
 */
export async function updateSubtask(
	uid: string,
	boardId: string,
	subtaskCardId: string,
	patch: Partial<Pick<IBoardCard, 'title' | 'description' | 'assignees' | 'dueDate' | 'completed'>>,
): Promise<IBoardCard> {
	const subtask = await BoardsCards.findOneById(subtaskCardId);
	if (!subtask || subtask.boardId !== boardId) {
		throw new Meteor.Error('error-subtask-not-found', 'Subtask not found', { method: 'boards.updateSubtask' });
	}

	// Check permission
	await assertBoardRole(boardId, uid, 'member', 'boards.updateSubtask');

	const set: Partial<IBoardCard> = {};
	if (typeof patch.title === 'string' && patch.title.trim()) {
		set.title = patch.title.trim();
	}
	if (typeof patch.description === 'string') {
		set.description = patch.description;
	}
	if (Array.isArray(patch.assignees)) {
		set.assignees = patch.assignees;
	}
	if (patch.dueDate instanceof Date) {
		set.dueDate = patch.dueDate;
	}
	if (typeof patch.completed === 'boolean') {
		set.completed = patch.completed;
		if (patch.completed) {
			set.completedAt = new Date();
			set.completedBy = uid;
		}
	}

	set.rev = subtask.rev + 1;

	await BoardsCards.updateOne({ _id: subtaskCardId }, { $set: set });

	const now = new Date();
	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'subtask.updated',
		to: { cardId: subtaskCardId, title: subtask.title },
		ts: now,
	});

	emitBoardEvent('subtask.updated', { boardId, cardId: subtaskCardId, actor: uid });

	const updated = await BoardsCards.findOneById(subtaskCardId);
	if (!updated) {
		throw new Meteor.Error('error-subtask-update-failed', 'Failed to update subtask', { method: 'boards.updateSubtask' });
	}

	return updated;
}
