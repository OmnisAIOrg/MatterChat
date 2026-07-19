import type { IBoardTemplate, IBoard, IBoardList } from '@rocket.chat/core-typings';
import { Boards, BoardsLists } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

// Placeholder for BoardTemplates collection — will be added to @rocket.chat/models
// For now, using a simple in-memory store for seeding
const SEED_TEMPLATES: Partial<IBoardTemplate>[] = [
	{
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
			{
				id: Random.id(),
				name: 'Statute of Limitations',
				type: 'date',
				showOnFront: true,
				position: 0,
			},
			{
				id: Random.id(),
				name: 'Case Value',
				type: 'currency',
				showOnFront: true,
				position: 1,
			},
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
	},
	{
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
			{
				id: Random.id(),
				name: 'Document Count',
				type: 'number',
				showOnFront: true,
				position: 0,
			},
			{
				id: Random.id(),
				name: 'Review Deadline',
				type: 'date',
				showOnFront: true,
				position: 1,
			},
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
	},
	{
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
			{
				id: Random.id(),
				name: 'Offer Amount',
				type: 'currency',
				showOnFront: true,
				position: 0,
			},
			{
				id: Random.id(),
				name: 'Settlement Deadline',
				type: 'date',
				showOnFront: true,
				position: 1,
			},
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
	},
];

export async function seedBoardTemplates(): Promise<void> {
	// NOTE: This is a placeholder. In production, BoardTemplates collection
	// would be added to @rocket.chat/models and used here to seed templates.
	// For now, this documents the seeding logic that will run on workspace init.
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
	// Load board & lists for snapshot
	const board = await Boards.findOneById(params.boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found');
	}

	const lists = await BoardsLists.findByBoard(params.boardId).toArray();

	// TODO: Create BoardTemplate document in collection
	// For now, return placeholder
	const templateId = Random.id();
	const uri = `board-template-${templateId}`;

	return { templateId, uri };
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
	// TODO: Load template, clone structure into new board
	// For now, throw placeholder
	throw new Meteor.Error('error-not-implemented', 'Template creation coming soon');
}

export function listBoardTemplates(
	visibility?: 'private' | 'team' | 'firm',
	pipelineType?: string,
): Partial<IBoardTemplate>[] {
	// TODO: Query BoardTemplates collection with filters
	// For now, return seed templates
	return SEED_TEMPLATES.filter((t) => {
		if (pipelineType && t.pipelineType !== pipelineType) return false;
		return true;
	});
}
