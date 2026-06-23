import type {
	IBoard,
	IBoardList,
	IBoardCard,
	IBoardActivity,
	BoardsPipelineType,
	BoardsStatus,
	BoardsCardType,
	IBoardCardLink,
} from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';
import { type PaginatedRequest } from '../helpers/PaginatedRequest';
import { type PaginatedResult } from '../helpers/PaginatedResult';

// ---------------------------------------------------------------------------
// GET params (ajvQuery — coerces URL query strings)
// ---------------------------------------------------------------------------

type BoardsListProps = PaginatedRequest<{ pipelineType?: BoardsPipelineType; starred?: boolean }>;

const BoardsListSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		pipelineType: { type: 'string', enum: ['leads', 'matters', 'general'], nullable: true },
		starred: { type: 'boolean', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsListProps = ajvQuery.compile<BoardsListProps>(BoardsListSchema);

type BoardsInfoProps = { boardId: string };

const BoardsInfoSchema = {
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsInfoProps = ajvQuery.compile<BoardsInfoProps>(BoardsInfoSchema);

type BoardsCardsProps = PaginatedRequest<{ boardId: string; listId?: string }>;

const BoardsCardsSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		boardId: { type: 'string', minLength: 1 },
		listId: { type: 'string', nullable: true },
	},
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsCardsProps = ajvQuery.compile<BoardsCardsProps>(BoardsCardsSchema);

// Public (unauthenticated) iCal feed: resolves the user from a per-user `?token=` secret so
// calendar apps can subscribe to a plain URL. The token is the only param.
type BoardsCardsIcalPublicProps = { token: string };

const BoardsCardsIcalPublicSchema = {
	type: 'object',
	properties: { token: { type: 'string', minLength: 1 } },
	required: ['token'],
	additionalProperties: false,
};

export const isBoardsCardsIcalPublicProps = ajvQuery.compile<BoardsCardsIcalPublicProps>(BoardsCardsIcalPublicSchema);

type BoardsCardProps = { cardId: string };

const BoardsCardSchema = {
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
};

export const isBoardsCardProps = ajvQuery.compile<BoardsCardProps>(BoardsCardSchema);

type BoardsListsProps = { boardId: string };

const BoardsListsSchema = {
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsListsProps = ajvQuery.compile<BoardsListsProps>(BoardsListsSchema);

type BoardsActivitiesProps = PaginatedRequest<{ boardId: string; cardId?: string }>;

const BoardsActivitiesSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		boardId: { type: 'string', minLength: 1 },
		cardId: { type: 'string', nullable: true },
	},
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsActivitiesProps = ajvQuery.compile<BoardsActivitiesProps>(BoardsActivitiesSchema);

// ---------------------------------------------------------------------------
// POST bodies (ajv)
// ---------------------------------------------------------------------------

type BoardsCreateProps = { title: string; pipelineType?: BoardsPipelineType; description?: string; teamId?: string };

const BoardsCreateSchema = {
	type: 'object',
	properties: {
		title: { type: 'string', minLength: 1 },
		pipelineType: { type: 'string', enum: ['leads', 'matters', 'general'], nullable: true },
		description: { type: 'string', nullable: true },
		teamId: { type: 'string', nullable: true },
	},
	required: ['title'],
	additionalProperties: false,
};

export const isBoardsCreateProps = ajv.compile<BoardsCreateProps>(BoardsCreateSchema);

type BoardsUpdateProps = {
	boardId: string;
	patch: {
		title?: string;
		description?: string;
		icon?: string;
		background?: { kind: 'color' | 'image'; value: string };
		visibility?: 'private' | 'team' | 'shared';
	};
};

const BoardsUpdateSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		patch: {
			type: 'object',
			properties: {
				title: { type: 'string', nullable: true },
				description: { type: 'string', nullable: true },
				icon: { type: 'string', nullable: true },
				background: {
					type: 'object',
					nullable: true,
					properties: {
						kind: { type: 'string', enum: ['color', 'image'] },
						value: { type: 'string' },
					},
					required: ['kind', 'value'],
					additionalProperties: false,
				},
				visibility: { type: 'string', enum: ['private', 'team', 'shared'], nullable: true },
			},
			required: [],
			additionalProperties: false,
		},
	},
	required: ['boardId', 'patch'],
	additionalProperties: false,
};

export const isBoardsUpdateProps = ajv.compile<BoardsUpdateProps>(BoardsUpdateSchema);

type BoardsArchiveProps = { boardId: string };

const BoardsArchiveSchema = {
	type: 'object',
	properties: { boardId: { type: 'string', minLength: 1 } },
	required: ['boardId'],
	additionalProperties: false,
};

export const isBoardsArchiveProps = ajv.compile<BoardsArchiveProps>(BoardsArchiveSchema);

type BoardsSetStatusProps = { boardId: string; status: BoardsStatus };

const BoardsSetStatusSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		status: { type: 'string', enum: ['active', 'on_hold', 'completed', 'archived'] },
	},
	required: ['boardId', 'status'],
	additionalProperties: false,
};

export const isBoardsSetStatusProps = ajv.compile<BoardsSetStatusProps>(BoardsSetStatusSchema);

type BoardsListCreateProps = { boardId: string; title: string; position?: number; caseproStageId?: string };

const BoardsListCreateSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		title: { type: 'string', minLength: 1 },
		position: { type: 'number', nullable: true },
		caseproStageId: { type: 'string', nullable: true },
	},
	required: ['boardId', 'title'],
	additionalProperties: false,
};

export const isBoardsListCreateProps = ajv.compile<BoardsListCreateProps>(BoardsListCreateSchema);

type BoardsListUpdateProps = {
	listId: string;
	patch: { title?: string; wipLimit?: number; subStatuses?: string[]; collapsed?: boolean; color?: string };
};

const BoardsListUpdateSchema = {
	type: 'object',
	properties: {
		listId: { type: 'string', minLength: 1 },
		patch: {
			type: 'object',
			properties: {
				title: { type: 'string', nullable: true },
				wipLimit: { type: 'number', nullable: true },
				subStatuses: { type: 'array', items: { type: 'string' }, nullable: true },
				collapsed: { type: 'boolean', nullable: true },
				// list/column accent color — raw CSS color string (hex). MUST be listed here
				// or ajv `additionalProperties:false` silently strips it from the request body.
				color: { type: 'string', nullable: true },
			},
			required: [],
			additionalProperties: false,
		},
	},
	required: ['listId', 'patch'],
	additionalProperties: false,
};

export const isBoardsListUpdateProps = ajv.compile<BoardsListUpdateProps>(BoardsListUpdateSchema);

type BoardsListMoveProps = { listId: string; position: number };

const BoardsListMoveSchema = {
	type: 'object',
	properties: {
		listId: { type: 'string', minLength: 1 },
		position: { type: 'number' },
	},
	required: ['listId', 'position'],
	additionalProperties: false,
};

export const isBoardsListMoveProps = ajv.compile<BoardsListMoveProps>(BoardsListMoveSchema);

// Reorder a board's columns. Two accepted shapes (validated as a combination in the service):
//  - { boardId, listIds }   full ordering: positions are reassigned in array order
//  - { listId, position }   single-list move to an absolute fractional rank (mirrors list.move)
// All four keys live here or ajv `additionalProperties:false` silently strips them from the body.
type BoardsListReorderProps = { boardId?: string; listIds?: string[]; listId?: string; position?: number };

const BoardsListReorderSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1, nullable: true },
		listIds: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, nullable: true },
		listId: { type: 'string', minLength: 1, nullable: true },
		position: { type: 'number', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsListReorderProps = ajv.compile<BoardsListReorderProps>(BoardsListReorderSchema);

type BoardsListArchiveProps = { listId: string };

const BoardsListArchiveSchema = {
	type: 'object',
	properties: { listId: { type: 'string', minLength: 1 } },
	required: ['listId'],
	additionalProperties: false,
};

export const isBoardsListArchiveProps = ajv.compile<BoardsListArchiveProps>(BoardsListArchiveSchema);

type BoardsCardCreateProps = {
	boardId: string;
	listId: string;
	title: string;
	position?: number;
	cardType?: BoardsCardType;
	description?: string;
	link?: IBoardCardLink;
};

const BoardsCardCreateSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		listId: { type: 'string', minLength: 1 },
		title: { type: 'string', minLength: 1 },
		position: { type: 'number', nullable: true },
		cardType: { type: 'string', enum: ['task', 'lead', 'matter', 'document', 'evidence'], nullable: true },
		description: { type: 'string', nullable: true },
		// link is a discriminated union; accept any object here, the service validates shape
		link: { type: 'object', nullable: true },
	},
	required: ['boardId', 'listId', 'title'],
	additionalProperties: false,
};

export const isBoardsCardCreateProps = ajv.compile<BoardsCardCreateProps>(BoardsCardCreateSchema);

type BoardsCardUpdateProps = {
	cardId: string;
	patch: {
		title?: string;
		description?: string;
		startDate?: string;
		dueDate?: string;
		dueComplete?: boolean;
		subStatus?: string;
		assignees?: string[];
		watchers?: string[];
		priority?: 'low' | 'medium' | 'high' | 'urgent';
		cover?: { kind: 'color' | 'image' | 'attachment'; value: string };
	};
};

const BoardsCardUpdateSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		patch: {
			type: 'object',
			properties: {
				title: { type: 'string', nullable: true },
				description: { type: 'string', nullable: true },
				startDate: { type: 'string', nullable: true },
				dueDate: { type: 'string', nullable: true },
				dueComplete: { type: 'boolean', nullable: true },
				subStatus: { type: 'string', nullable: true },
				assignees: { type: 'array', items: { type: 'string' }, nullable: true },
				watchers: { type: 'array', items: { type: 'string' }, nullable: true },
				priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], nullable: true },
				cover: {
					type: 'object',
					nullable: true,
					properties: {
						kind: { type: 'string', enum: ['color', 'image', 'attachment'] },
						value: { type: 'string' },
					},
					required: ['kind', 'value'],
					additionalProperties: false,
				},
			},
			required: [],
			additionalProperties: false,
		},
	},
	required: ['cardId', 'patch'],
	additionalProperties: false,
};

export const isBoardsCardUpdateProps = ajv.compile<BoardsCardUpdateProps>(BoardsCardUpdateSchema);

type BoardsCardMoveProps = { cardId: string; toListId: string; position: number; subStatus?: string };

const BoardsCardMoveSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		toListId: { type: 'string', minLength: 1 },
		position: { type: 'number' },
		subStatus: { type: 'string', nullable: true },
	},
	required: ['cardId', 'toListId', 'position'],
	additionalProperties: false,
};

export const isBoardsCardMoveProps = ajv.compile<BoardsCardMoveProps>(BoardsCardMoveSchema);

type BoardsCardArchiveProps = { cardId: string };

const BoardsCardArchiveSchema = {
	type: 'object',
	properties: { cardId: { type: 'string', minLength: 1 } },
	required: ['cardId'],
	additionalProperties: false,
};

export const isBoardsCardArchiveProps = ajv.compile<BoardsCardArchiveProps>(BoardsCardArchiveSchema);

// Bulk card operations: apply one action to many cards in a single request. The optional action
// params (toListId/position/subStatus for move, completed for complete, priority for setPriority)
// ride alongside; the server validates the combination per-action.
type BoardsCardsBulkProps = {
	cardIds: string[];
	action: 'move' | 'complete' | 'archive' | 'setPriority' | 'delete';
	toListId?: string;
	position?: number;
	subStatus?: string;
	completed?: boolean;
	priority?: 'low' | 'medium' | 'high' | 'urgent';
};

const BoardsCardsBulkSchema = {
	type: 'object',
	properties: {
		cardIds: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
		action: { type: 'string', enum: ['move', 'complete', 'archive', 'setPriority', 'delete'] },
		toListId: { type: 'string', nullable: true },
		position: { type: 'number', nullable: true },
		subStatus: { type: 'string', nullable: true },
		completed: { type: 'boolean', nullable: true },
		priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], nullable: true },
	},
	required: ['cardIds', 'action'],
	additionalProperties: false,
};

export const isBoardsCardsBulkProps = ajv.compile<BoardsCardsBulkProps>(BoardsCardsBulkSchema);

// Card checklists / sub-tasks. Granular item-level mutations on a card's default checklist
// (the service auto-creates one on the first add). Each new field MUST be declared here or
// ajv `additionalProperties:false` silently strips it from the request body.
type BoardsCardChecklistAddProps = { cardId: string; text: string };

const BoardsCardChecklistAddSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		text: { type: 'string', minLength: 1 },
	},
	required: ['cardId', 'text'],
	additionalProperties: false,
};

export const isBoardsCardChecklistAddProps = ajv.compile<BoardsCardChecklistAddProps>(BoardsCardChecklistAddSchema);

// Toggle (or explicitly set) a checklist item's done state. With `done` omitted the item flips.
type BoardsCardChecklistToggleProps = { cardId: string; itemId: string; done?: boolean };

const BoardsCardChecklistToggleSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		itemId: { type: 'string', minLength: 1 },
		done: { type: 'boolean', nullable: true },
	},
	required: ['cardId', 'itemId'],
	additionalProperties: false,
};

export const isBoardsCardChecklistToggleProps = ajv.compile<BoardsCardChecklistToggleProps>(BoardsCardChecklistToggleSchema);

type BoardsCardChecklistRemoveProps = { cardId: string; itemId: string };

const BoardsCardChecklistRemoveSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		itemId: { type: 'string', minLength: 1 },
	},
	required: ['cardId', 'itemId'],
	additionalProperties: false,
};

export const isBoardsCardChecklistRemoveProps = ajv.compile<BoardsCardChecklistRemoveProps>(BoardsCardChecklistRemoveSchema);

// ---------------------------------------------------------------------------
// Labels / tags
//
// Board-level palette (create/update/delete a label def) + per-card assignment
// (replace a card's label-id set). NOTE: every property below MUST be declared
// or ajv `additionalProperties:false` silently strips it from the request body.
// ---------------------------------------------------------------------------

type BoardsLabelCreateProps = { boardId: string; name: string; color: string };

const BoardsLabelCreateSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		name: { type: 'string', minLength: 1 },
		color: { type: 'string', minLength: 1 },
	},
	required: ['boardId', 'name', 'color'],
	additionalProperties: false,
};

export const isBoardsLabelCreateProps = ajv.compile<BoardsLabelCreateProps>(BoardsLabelCreateSchema);

type BoardsLabelUpdateProps = { boardId: string; labelId: string; patch: { name?: string; color?: string } };

const BoardsLabelUpdateSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		labelId: { type: 'string', minLength: 1 },
		patch: {
			type: 'object',
			properties: {
				name: { type: 'string', nullable: true },
				color: { type: 'string', nullable: true },
			},
			required: [],
			additionalProperties: false,
		},
	},
	required: ['boardId', 'labelId', 'patch'],
	additionalProperties: false,
};

export const isBoardsLabelUpdateProps = ajv.compile<BoardsLabelUpdateProps>(BoardsLabelUpdateSchema);

type BoardsLabelDeleteProps = { boardId: string; labelId: string };

const BoardsLabelDeleteSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		labelId: { type: 'string', minLength: 1 },
	},
	required: ['boardId', 'labelId'],
	additionalProperties: false,
};

export const isBoardsLabelDeleteProps = ajv.compile<BoardsLabelDeleteProps>(BoardsLabelDeleteSchema);

// Replace a card's label-id set wholesale (server validates each id against the board palette).
type BoardsCardLabelsSetProps = { cardId: string; labelIds: string[] };

const BoardsCardLabelsSetSchema = {
	type: 'object',
	properties: {
		cardId: { type: 'string', minLength: 1 },
		labelIds: { type: 'array', items: { type: 'string', minLength: 1 } },
	},
	required: ['cardId', 'labelIds'],
	additionalProperties: false,
};

export const isBoardsCardLabelsSetProps = ajv.compile<BoardsCardLabelsSetProps>(BoardsCardLabelsSetSchema);

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type BoardsEndpoints = {
	'/v1/boards.list': {
		GET: (params: BoardsListProps) => PaginatedResult<{ boards: IBoard[] }>;
	};
	'/v1/boards.info': {
		GET: (params: BoardsInfoProps) => { board: IBoard; lists: IBoardList[] };
	};
	'/v1/boards.create': {
		POST: (params: BoardsCreateProps) => { board: IBoard };
	};
	'/v1/boards.update': {
		POST: (params: BoardsUpdateProps) => { board: IBoard };
	};
	'/v1/boards.archive': {
		POST: (params: BoardsArchiveProps) => { success: true };
	};
	'/v1/boards.setStatus': {
		POST: (params: BoardsSetStatusProps) => { board: IBoard };
	};
	'/v1/boards.lists': {
		GET: (params: BoardsListsProps) => { lists: IBoardList[] };
	};
	'/v1/boards.list.create': {
		POST: (params: BoardsListCreateProps) => { list: IBoardList };
	};
	'/v1/boards.list.update': {
		POST: (params: BoardsListUpdateProps) => { list: IBoardList };
	};
	'/v1/boards.list.move': {
		POST: (params: BoardsListMoveProps) => { list: IBoardList };
	};
	'/v1/boards.list.reorder': {
		POST: (params: BoardsListReorderProps) => { lists: IBoardList[] };
	};
	'/v1/boards.list.archive': {
		POST: (params: BoardsListArchiveProps) => { success: true };
	};
	'/v1/boards.cards': {
		GET: (params: BoardsCardsProps) => PaginatedResult<{ cards: IBoardCard[] }>;
	};
	// iCal (.ics) feed of the current user's due cards. Returns a raw RFC-5545
	// `text/calendar` document (a string), NOT the usual JSON envelope.
	'/v1/boards.cards.ical': {
		GET: () => string;
	};
	// Mint (idempotently) + return the caller's per-user secret token for the public iCal feed,
	// so a calendar app can subscribe to `/api/v1/boards.cards.ical.public?token=...`.
	'/v1/boards.cards.ical.token': {
		POST: () => { token: string };
	};
	// Public, UNAUTHENTICATED iCal feed. Resolves the user from `?token=` and returns the same
	// raw RFC-5545 `text/calendar` document as boards.cards.ical (no JSON envelope, no auth headers).
	'/v1/boards.cards.ical.public': {
		GET: (params: { token: string }) => string;
	};
	'/v1/boards.card': {
		GET: (params: BoardsCardProps) => { card: IBoardCard };
	};
	'/v1/boards.card.create': {
		POST: (params: BoardsCardCreateProps) => { card: IBoardCard };
	};
	'/v1/boards.card.update': {
		POST: (params: BoardsCardUpdateProps) => { card: IBoardCard };
	};
	'/v1/boards.card.move': {
		POST: (params: BoardsCardMoveProps) => { card: IBoardCard };
	};
	'/v1/boards.card.archive': {
		POST: (params: BoardsCardArchiveProps) => { success: true };
	};
	'/v1/boards.cards.bulk': {
		POST: (params: BoardsCardsBulkProps) => {
			results: { cardId: string; ok: boolean; error?: string }[];
			updated: number;
			failed: number;
		};
	};
	'/v1/boards.card.checklist.add': {
		POST: (params: BoardsCardChecklistAddProps) => { card: IBoardCard };
	};
	'/v1/boards.card.checklist.toggle': {
		POST: (params: BoardsCardChecklistToggleProps) => { card: IBoardCard };
	};
	'/v1/boards.card.checklist.remove': {
		POST: (params: BoardsCardChecklistRemoveProps) => { card: IBoardCard };
	};
	'/v1/boards.activities': {
		GET: (params: BoardsActivitiesProps) => PaginatedResult<{ activities: IBoardActivity[] }>;
	};
	'/v1/boards.label.create': {
		POST: (params: BoardsLabelCreateProps) => { board: IBoard };
	};
	'/v1/boards.label.update': {
		POST: (params: BoardsLabelUpdateProps) => { board: IBoard };
	};
	'/v1/boards.label.delete': {
		POST: (params: BoardsLabelDeleteProps) => { board: IBoard };
	};
	'/v1/boards.card.labels.set': {
		POST: (params: BoardsCardLabelsSetProps) => { card: IBoardCard };
	};
};
