import type { IBoardTemplate, IBoard } from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';
import { ObjectId } from 'mongodb';

import { assertBoardRole } from './permissions';
import { createBoard } from './service';

// Board Templates - seed templates for common workflows
const SEED_TEMPLATES: Partial<IBoardTemplate>[] = [
	{
		_id: new ObjectId(),
		name: 'PI Intake Checklist',
		description: 'Standard personal injury intake workflow with discovery checklists',
		pipelineType: 'matters',
		lists: [
			{ id: 'intake', name: 'Intake', order: 0 },
			{ id: 'investigation', name: 'Investigation', order: 1024 },
			{ id: 'discovery', name: 'Discovery', order: 2048 },
			{ id: 'settlement', name: 'Settlement', order: 3072 },
		],
		fieldDefs: [
			{ id: Random.id(), name: 'Statute of Limitations', type: 'date', showOnFront: true, position: 0 },
			{ id: Random.id(), name: 'Case Value', type: 'currency', showOnFront: true, position: 1 },
		],
		labelDefs: [
			{ id: Random.id(), name: 'Urgent', color: '#cf4438' },
			{ id: Random.id(), name: 'Follow-up', color: '#f9ab00' },
			{ id: Random.id(), name: 'High Priority', color: '#d33b27' },
		],
		visibility: 'firm',
		deprecated: false,
		usageCount: 0,
		schemaVersion: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		createdBy: 'system',
	},
	{
		_id: new ObjectId(),
		name: 'Discovery Phase Tasks',
		description: 'Organized discovery document review and production tracking',
		pipelineType: 'matters',
		lists: [
			{ id: 'pending', name: 'Pending Review', order: 0 },
			{ id: 'reviewing', name: 'Under Review', order: 1024 },
			{ id: 'produced', name: 'Produced', order: 2048 },
			{ id: 'privileged', name: 'Privileged/Redacted', order: 3072 },
		],
		fieldDefs: [
			{ id: Random.id(), name: 'Document Count', type: 'number', showOnFront: true, position: 0 },
			{ id: Random.id(), name: 'Review Deadline', type: 'date', showOnFront: true, position: 1 },
		],
		labelDefs: [
			{ id: Random.id(), name: 'Confidential', color: '#ea4435' },
			{ id: Random.id(), name: 'Work Product', color: '#4f37d5' },
			{ id: Random.id(), name: 'Produced', color: '#00a651' },
		],
		visibility: 'firm',
		deprecated: false,
		usageCount: 0,
		schemaVersion: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		createdBy: 'system',
	},
	{
		_id: new ObjectId(),
		name: 'Settlement Negotiations',
		description: 'Track settlement offers, counteroffers, and resolution status',
		pipelineType: 'matters',
		lists: [
			{ id: 'pending', name: 'Pending Offer', order: 0 },
			{ id: 'offered', name: 'Offer Received', order: 1024 },
			{ id: 'negotiating', name: 'Negotiating', order: 2048 },
			{ id: 'resolved', name: 'Resolved', order: 3072 },
		],
		fieldDefs: [
			{ id: Random.id(), name: 'Offer Amount', type: 'currency', showOnFront: true, position: 0 },
			{ id: Random.id(), name: 'Settlement Deadline', type: 'date', showOnFront: true, position: 1 },
			{
				id: Random.id(),
				name: 'Status',
				type: 'dropdown',
				options: [
					{ id: '1', label: 'Pending' },
					{ id: '2', label: 'Accepted' },
					{ id: '3', label: 'Rejected' },
				],
				showOnFront: true,
				position: 2,
			},
		],
		labelDefs: [
			{ id: Random.id(), name: 'Counteroffer', color: '#f59e0b' },
			{ id: Random.id(), name: 'Final Offer', color: '#10b981' },
		],
		visibility: 'firm',
		deprecated: false,
		usageCount: 0,
		schemaVersion: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		createdBy: 'system',
	},
];

export async function seedBoardTemplates(): Promise<void> {
	// Placeholder: In production, this would seed templates to BoardTemplates collection
}

export type SaveBoardAsTemplateParams = {
	boardId: string;
	name: string;
	description?: string;
	visibility: 'private' | 'team' | 'firm';
	teamId?: string;
};

export async function saveBoardAsTemplate(
	uid: string,
	params: SaveBoardAsTemplateParams,
): Promise<{ templateId: string; uri: string }> {
	await assertBoardRole(params.boardId, uid, 'admin', 'boards.templates.save');

	const board = await Boards.findOneById(params.boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found');
	}

	const lists = await BoardsLists.findByBoard(params.boardId).toArray();
	const templateId = Random.id();

	// In production: create BoardTemplate document in collection
	// For now, return template info for frontend confirmation
	return { templateId, uri: `board-template-${templateId}` };
}

export type CreateBoardFromTemplateParams = {
	templateId: string;
	name: string;
	teamId?: string;
};

export async function createBoardFromTemplate(
	uid: string,
	params: CreateBoardFromTemplateParams,
): Promise<IBoard> {
	const template = SEED_TEMPLATES.find((t) => t._id?.toString() === params.templateId);
	if (!template) {
		throw new Meteor.Error('error-template-not-found', 'Template not found');
	}

	const board = await createBoard(uid, {
		title: params.name,
		pipelineType: template.pipelineType,
		teamId: params.teamId,
	});

	if (template.lists) {
		for (const templateList of template.lists) {
			await BoardsLists.insertOne({
				_id: new ObjectId(),
				boardId: board._id,
				title: templateList.name,
				position: templateList.order,
				caseproStageId: (templateList as any).defaultStageId,
				archived: false,
				createdAt: new Date(),
			} as any);
		}
	}

	if (template.fieldDefs || template.labelDefs) {
		await Boards.updateOne(
			{ _id: board._id },
			{
				$set: {
					fieldDefs: template.fieldDefs || [],
					labelDefs: template.labelDefs || [],
				},
			},
		);
	}

	return board;
}

export function listBoardTemplates(
	visibility?: 'private' | 'team' | 'firm',
	pipelineType?: string,
): Partial<IBoardTemplate>[] {
	return SEED_TEMPLATES.filter((t) => {
		if (pipelineType && t.pipelineType !== pipelineType) return false;
		if (visibility && t.visibility !== visibility) return false;
		if (t.deprecated) return false;
		return true;
	});
}
