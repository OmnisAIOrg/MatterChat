import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

export interface IBoardList extends IRocketChatRecord {
	boardId: string;
	title: string;
	position: number; // fractional rank (LexoRank-style) among lists in the board
	wipLimit?: number;
	subStatuses?: string[]; // ordered sub-status labels (CasePro sub_stage names)
	collapsed?: boolean;
	color?: string; // optional list/column accent color — a raw CSS color string (hex), matching board.background.value / card.cover.value / label.color
	watchers?: IUser['_id'][];
	caseproStageId?: string; // matter_stages.id OR intake_stages.id this column maps to
	archived: boolean;
	rev: number;
}
