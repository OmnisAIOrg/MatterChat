import type { BoardsPipelineType, IBoardFieldDef, IBoardLabelDef } from './IBoard';
import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

export interface IBoardTemplate extends IRocketChatRecord {
	name: string;
	description?: string;
	pipelineType: BoardsPipelineType;

	// Snapshot of structure (no card data)
	lists: Array<{
		id: string;
		name: string;
		order: number;
		defaultStageId?: string; // for CasePro sync binding
	}>;

	fieldDefs: IBoardFieldDef[];
	labelDefs: IBoardLabelDef[];

	// Access control
	visibility: 'private' | 'team' | 'firm';
	teamId?: string; // for team-scoped templates

	createdBy: IUser['_id'];

	// Governance
	deprecated?: boolean;
	usageCount?: number;

	schemaVersion: number;
	createdAt: Date;
	updatedAt: Date;
}
