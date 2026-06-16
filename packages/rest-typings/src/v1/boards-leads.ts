import type {
	IBoard,
	IBoardList,
	IBoardCard,
	ILead,
	ILeadContact,
	ILeadIncident,
	ILeadQualification,
	ILeadAttribution,
	ICommunication,
	IReferralSource,
	LeadCapturedChannel,
	LeadLostReason,
	PreferredContact,
} from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';
import { type PaginatedRequest } from '../helpers/PaginatedRequest';
import { type PaginatedResult } from '../helpers/PaginatedResult';

// ---------------------------------------------------------------------------
// Shared sub-schemas (lead blocks). Kept permissive — the service is the source
// of truth for shape; ajv guards the wire surface against junk and unknown keys.
// ---------------------------------------------------------------------------

const ContactSchema = {
	type: 'object',
	nullable: true,
	properties: {
		firstName: { type: 'string', nullable: true },
		lastName: { type: 'string', nullable: true },
		fullName: { type: 'string', nullable: true },
		phone: { type: 'string', nullable: true },
		mobile: { type: 'string', nullable: true },
		email: { type: 'string', nullable: true },
		address: { type: 'string', nullable: true },
		street: { type: 'string', nullable: true },
		city: { type: 'string', nullable: true },
		state: { type: 'string', nullable: true },
		zip: { type: 'string', nullable: true },
		dateOfBirth: { type: 'string', nullable: true },
		language: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

const IncidentSchema = {
	type: 'object',
	nullable: true,
	properties: {
		incidentType: { type: 'string', nullable: true },
		incidentDate: { type: 'string', nullable: true },
		incidentTime: { type: 'string', nullable: true },
		incidentDescription: { type: 'string', nullable: true },
		injuries: { type: 'array', items: { type: 'string' }, nullable: true },
		jurisdictionState: { type: 'string', nullable: true },
		incidentCity: { type: 'string', nullable: true },
		incidentZip: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

const QualificationSchema = {
	type: 'object',
	nullable: true,
	properties: {
		score: { type: 'number', nullable: true },
		scoreBreakdown: {
			type: 'array',
			nullable: true,
			items: {
				type: 'object',
				properties: {
					ruleId: { type: 'string' },
					label: { type: 'string' },
					points: { type: 'number' },
				},
				required: ['ruleId', 'label', 'points'],
				additionalProperties: false,
			},
		},
		qualified: { type: 'boolean', nullable: true },
		disqualifyReason: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

const AttributionSchema = {
	type: 'object',
	nullable: true,
	properties: {
		source: { type: 'string', nullable: true },
		marketingSourceId: { type: 'string', nullable: true },
		campaignId: { type: 'string', nullable: true },
		utm: {
			type: 'object',
			nullable: true,
			properties: {
				source: { type: 'string', nullable: true },
				medium: { type: 'string', nullable: true },
				campaign: { type: 'string', nullable: true },
				term: { type: 'string', nullable: true },
				content: { type: 'string', nullable: true },
			},
			required: [],
			additionalProperties: false,
		},
		referralSourceId: { type: 'string', nullable: true },
		referredByName: { type: 'string', nullable: true },
		spend: { type: 'number', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

// ---------------------------------------------------------------------------
// GET params (ajvQuery — coerces URL query strings)
// ---------------------------------------------------------------------------

type BoardsLeadsListProps = PaginatedRequest<{ boardId?: string; statusId?: string; ownerId?: string; q?: string }>;

const BoardsLeadsListSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		boardId: { type: 'string', nullable: true },
		statusId: { type: 'string', nullable: true },
		ownerId: { type: 'string', nullable: true },
		q: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsLeadsListProps = ajvQuery.compile<BoardsLeadsListProps>(BoardsLeadsListSchema);

type BoardsLeadsGetProps = { leadId: string };

const BoardsLeadsGetSchema = {
	type: 'object',
	properties: { leadId: { type: 'string', minLength: 1 } },
	required: ['leadId'],
	additionalProperties: false,
};

export const isBoardsLeadsGetProps = ajvQuery.compile<BoardsLeadsGetProps>(BoardsLeadsGetSchema);

// ---------------------------------------------------------------------------
// POST bodies (ajv)
// ---------------------------------------------------------------------------

type BoardsLeadsEnsureBoardProps = Record<string, never>;

const BoardsLeadsEnsureBoardSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsLeadsEnsureBoardProps = ajv.compile<BoardsLeadsEnsureBoardProps>(BoardsLeadsEnsureBoardSchema);

type BoardsLeadsCreateProps = {
	contact: ILeadContact;
	caseTypeId?: string;
	practiceArea?: string;
	preferredContact?: PreferredContact;
	incident?: ILeadIncident;
	qualification?: ILeadQualification;
	attribution?: ILeadAttribution;
	solDate?: string;
	solComputedFrom?: 'casepro' | 'rules-engine' | 'manual';
	capturedChannel?: LeadCapturedChannel;
	questionnaireId?: string;
	litboxWorkspaceId?: string;
	tags?: string[];
	allowDuplicate?: boolean;
};

const BoardsLeadsCreateSchema = {
	type: 'object',
	properties: {
		contact: ContactSchema,
		caseTypeId: { type: 'string', nullable: true },
		practiceArea: { type: 'string', nullable: true },
		preferredContact: { type: 'string', enum: ['phone', 'email', 'sms', 'any'], nullable: true },
		incident: IncidentSchema,
		qualification: QualificationSchema,
		attribution: AttributionSchema,
		solDate: { type: 'string', nullable: true },
		solComputedFrom: { type: 'string', enum: ['casepro', 'rules-engine', 'manual'], nullable: true },
		capturedChannel: {
			type: 'string',
			enum: ['manual', 'web-form', 'csv-import', 'call', 'sms', 'email-parse', 'api'],
			nullable: true,
		},
		questionnaireId: { type: 'string', nullable: true },
		litboxWorkspaceId: { type: 'string', nullable: true },
		tags: { type: 'array', items: { type: 'string' }, nullable: true },
		allowDuplicate: { type: 'boolean', nullable: true },
	},
	required: ['contact'],
	additionalProperties: false,
};

export const isBoardsLeadsCreateProps = ajv.compile<BoardsLeadsCreateProps>(BoardsLeadsCreateSchema);

type BoardsLeadsUpdateProps = {
	leadId: string;
	patch: {
		contact?: ILeadContact;
		preferredContact?: PreferredContact;
		caseTypeId?: string;
		practiceArea?: string;
		incident?: ILeadIncident;
		attribution?: ILeadAttribution;
		solDate?: string;
		solComputedFrom?: 'casepro' | 'rules-engine' | 'manual';
		solAtRisk?: boolean;
		statusId?: string;
		subStatus?: string;
		tags?: string[];
		litboxWorkspaceId?: string;
		channelRoomId?: string;
	};
};

const BoardsLeadsUpdateSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		patch: {
			type: 'object',
			properties: {
				contact: ContactSchema,
				preferredContact: { type: 'string', enum: ['phone', 'email', 'sms', 'any'], nullable: true },
				caseTypeId: { type: 'string', nullable: true },
				practiceArea: { type: 'string', nullable: true },
				incident: IncidentSchema,
				attribution: AttributionSchema,
				solDate: { type: 'string', nullable: true },
				solComputedFrom: { type: 'string', enum: ['casepro', 'rules-engine', 'manual'], nullable: true },
				solAtRisk: { type: 'boolean', nullable: true },
				statusId: { type: 'string', nullable: true },
				subStatus: { type: 'string', nullable: true },
				tags: { type: 'array', items: { type: 'string' }, nullable: true },
				litboxWorkspaceId: { type: 'string', nullable: true },
				channelRoomId: { type: 'string', nullable: true },
			},
			required: [],
			additionalProperties: false,
		},
	},
	required: ['leadId', 'patch'],
	additionalProperties: false,
};

export const isBoardsLeadsUpdateProps = ajv.compile<BoardsLeadsUpdateProps>(BoardsLeadsUpdateSchema);

type BoardsLeadsQualifyProps = { leadId: string; qualification: ILeadQualification };

const BoardsLeadsQualifySchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		qualification: { ...QualificationSchema, nullable: false },
	},
	required: ['leadId', 'qualification'],
	additionalProperties: false,
};

export const isBoardsLeadsQualifyProps = ajv.compile<BoardsLeadsQualifyProps>(BoardsLeadsQualifySchema);

type BoardsLeadsAssignProps = { leadId: string; ownerId?: string; slaDueAt?: string; pool?: string[] };

const BoardsLeadsAssignSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		ownerId: { type: 'string', nullable: true },
		slaDueAt: { type: 'string', nullable: true },
		pool: { type: 'array', items: { type: 'string' }, nullable: true },
	},
	required: ['leadId'],
	additionalProperties: false,
};

export const isBoardsLeadsAssignProps = ajv.compile<BoardsLeadsAssignProps>(BoardsLeadsAssignSchema);

type BoardsLeadsLogCommProps = {
	leadId: string;
	kind: ICommunication['kind'];
	direction: ICommunication['direction'];
	subject?: string;
	body?: string;
	transcript?: string;
	templateId?: string;
	sequenceId?: string;
	callDisposition?: ICommunication['callDisposition'];
	callDurationSec?: number;
	recordingRef?: string;
	channelMessageId?: string;
	deliveryStatus?: ICommunication['deliveryStatus'];
	ts?: string;
};

const BoardsLeadsLogCommSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		kind: { type: 'string', enum: ['call', 'sms', 'email', 'note', 'task-note', 'system'] },
		direction: { type: 'string', enum: ['in', 'out', 'internal'] },
		subject: { type: 'string', nullable: true },
		body: { type: 'string', nullable: true },
		transcript: { type: 'string', nullable: true },
		templateId: { type: 'string', nullable: true },
		sequenceId: { type: 'string', nullable: true },
		callDisposition: {
			type: 'string',
			enum: ['connected', 'no-answer', 'voicemail', 'busy', 'wrong-number'],
			nullable: true,
		},
		callDurationSec: { type: 'number', nullable: true },
		recordingRef: { type: 'string', nullable: true },
		channelMessageId: { type: 'string', nullable: true },
		deliveryStatus: { type: 'string', enum: ['queued', 'sent', 'delivered', 'failed', 'bounced'], nullable: true },
		ts: { type: 'string', nullable: true },
	},
	required: ['leadId', 'kind', 'direction'],
	additionalProperties: false,
};

export const isBoardsLeadsLogCommProps = ajv.compile<BoardsLeadsLogCommProps>(BoardsLeadsLogCommSchema);

type BoardsLeadsReferralSourceUpsertProps = {
	sourceId?: string;
	fields: {
		name: string;
		type: IReferralSource['type'];
		kind?: IReferralSource['kind'];
		contact?: IReferralSource['contact'];
		defaultFeePct?: number;
		channel?: IReferralSource['channel'];
		utmSource?: string;
		monthlySpend?: IReferralSource['monthlySpend'];
		campaigns?: IReferralSource['campaigns'];
		caseproPartyId?: string;
		notes?: string;
		active?: boolean;
	};
};

const ReferralSourceFieldsSchema = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1 },
		type: { type: 'string', enum: ['person', 'firm', 'campaign', 'internal'] },
		kind: { type: 'string', enum: ['referral', 'marketing', 'both'], nullable: true },
		contact: {
			type: 'object',
			nullable: true,
			properties: {
				phone: { type: 'string', nullable: true },
				email: { type: 'string', nullable: true },
				address: { type: 'string', nullable: true },
				website: { type: 'string', nullable: true },
			},
			required: [],
			additionalProperties: false,
		},
		defaultFeePct: { type: 'number', nullable: true },
		channel: {
			type: 'string',
			enum: ['paid-search', 'lsa', 'social', 'tv', 'radio', 'organic', 'referral', 'other'],
			nullable: true,
		},
		utmSource: { type: 'string', nullable: true },
		monthlySpend: {
			type: 'array',
			nullable: true,
			items: {
				type: 'object',
				properties: { month: { type: 'string' }, amount: { type: 'number' } },
				required: ['month', 'amount'],
				additionalProperties: false,
			},
		},
		campaigns: {
			type: 'array',
			nullable: true,
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					name: { type: 'string' },
					utmCampaign: { type: 'string', nullable: true },
					startDate: { type: 'string', nullable: true },
					endDate: { type: 'string', nullable: true },
					budget: { type: 'number', nullable: true },
					spendByMonth: {
						type: 'array',
						nullable: true,
						items: {
							type: 'object',
							properties: { month: { type: 'string' }, amount: { type: 'number' } },
							required: ['month', 'amount'],
							additionalProperties: false,
						},
					},
					active: { type: 'boolean' },
				},
				required: ['id', 'name', 'active'],
				additionalProperties: false,
			},
		},
		caseproPartyId: { type: 'string', nullable: true },
		notes: { type: 'string', nullable: true },
		active: { type: 'boolean', nullable: true },
	},
	required: ['name', 'type'],
	additionalProperties: false,
};

const BoardsLeadsReferralSourceUpsertSchema = {
	type: 'object',
	properties: {
		sourceId: { type: 'string', nullable: true },
		fields: ReferralSourceFieldsSchema,
	},
	required: ['fields'],
	additionalProperties: false,
};

export const isBoardsLeadsReferralSourceUpsertProps = ajv.compile<BoardsLeadsReferralSourceUpsertProps>(
	BoardsLeadsReferralSourceUpsertSchema,
);

// ---------------------------------------------------------------------------
// CasePro intake sync + conversion (M3 sync service)
// ---------------------------------------------------------------------------

type BoardsLeadsSyncFromCaseProProps = Record<string, never>;

const BoardsLeadsSyncFromCaseProSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsLeadsSyncFromCaseProProps = ajv.compile<BoardsLeadsSyncFromCaseProProps>(
	BoardsLeadsSyncFromCaseProSchema,
);

type BoardsLeadsConvertToMatterProps = { leadId: string };

const BoardsLeadsConvertToMatterSchema = {
	type: 'object',
	properties: { leadId: { type: 'string', minLength: 1 } },
	required: ['leadId'],
	additionalProperties: false,
};

export const isBoardsLeadsConvertToMatterProps = ajv.compile<BoardsLeadsConvertToMatterProps>(
	BoardsLeadsConvertToMatterSchema,
);

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type BoardsLeadsEndpoints = {
	'/v1/boards.leads.list': {
		GET: (params: BoardsLeadsListProps) => PaginatedResult<{ leads: ILead[] }>;
	};
	'/v1/boards.leads.get': {
		GET: (params: BoardsLeadsGetProps) => { lead: ILead; communications: ICommunication[] };
	};
	'/v1/boards.leads.ensureBoard': {
		POST: (params: BoardsLeadsEnsureBoardProps) => { board: IBoard; lists: IBoardList[]; created: boolean };
	};
	'/v1/boards.leads.create': {
		POST: (params: BoardsLeadsCreateProps) => { lead: ILead; card: IBoardCard; refNo: number; duplicateOf?: ILead };
	};
	'/v1/boards.leads.update': {
		POST: (params: BoardsLeadsUpdateProps) => { lead: ILead };
	};
	'/v1/boards.leads.qualify': {
		POST: (params: BoardsLeadsQualifyProps) => { lead: ILead };
	};
	'/v1/boards.leads.assign': {
		POST: (params: BoardsLeadsAssignProps) => { lead: ILead; ownerId: string; slaDueAt?: Date };
	};
	'/v1/boards.leads.logComm': {
		POST: (params: BoardsLeadsLogCommProps) => { commId: string; communication: ICommunication };
	};
	'/v1/boards.leads.referralSource.upsert': {
		POST: (params: BoardsLeadsReferralSourceUpsertProps) => { source: IReferralSource; created: boolean };
	};
	'/v1/boards.leads.syncFromCasePro': {
		POST: (params: BoardsLeadsSyncFromCaseProProps) => {
			total: number;
			created: number;
			updated: number;
			skipped: number;
			boardId: string;
		};
	};
	'/v1/boards.leads.convertToMatter': {
		POST: (params: BoardsLeadsConvertToMatterProps) => {
			lead: ILead;
			matterId: string;
			matterCard: IBoardCard;
			mattersBoardId: string;
		};
	};
};

export type { LeadLostReason };
