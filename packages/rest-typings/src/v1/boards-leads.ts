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
	ICommTemplate,
	CommTemplateChannel,
	IIntakeTask,
	IReferralSource,
	IReferralOut,
	IReferralOutContact,
	ReferralOutStatus,
	ReferralArrangement,
	ISequence,
	ISequenceEnrollment,
	ISignUpPacket,
	SignUpPacketStatus,
	EsignProvider,
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
// M6 — mark lost (terminal exit: Not a Fit / Lost / Referred Out — §4)
// ---------------------------------------------------------------------------

type BoardsLeadsMarkLostProps = { leadId: string; reason: LeadLostReason };

const BoardsLeadsMarkLostSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		reason: {
			type: 'string',
			enum: ['declined-unqualified', 'declined-lost', 'no-response', 'referred-out', 'duplicate', 'other'],
		},
	},
	required: ['leadId', 'reason'],
	additionalProperties: false,
};

export const isBoardsLeadsMarkLostProps = ajv.compile<BoardsLeadsMarkLostProps>(BoardsLeadsMarkLostSchema);

// ---------------------------------------------------------------------------
// M6 — conflict / dedupe / scoring / SOL (GET-by-leadId reads)
// ---------------------------------------------------------------------------

type BoardsLeadsByLeadIdProps = { leadId: string };

/** Factory: a fresh `{ leadId }` schema object per compile (no shared object refs). */
const leadIdSchema = () => ({
	type: 'object',
	properties: { leadId: { type: 'string', minLength: 1 } },
	required: ['leadId'],
	additionalProperties: false,
});

export const isBoardsLeadsRunConflictCheckProps = ajvQuery.compile<BoardsLeadsByLeadIdProps>(leadIdSchema());
export const isBoardsLeadsCheckDuplicatesProps = ajvQuery.compile<BoardsLeadsByLeadIdProps>(leadIdSchema());
export const isBoardsLeadsComputeScoreProps = ajvQuery.compile<BoardsLeadsByLeadIdProps>(leadIdSchema());
export const isBoardsLeadsComputeSolProps = ajvQuery.compile<BoardsLeadsByLeadIdProps>(leadIdSchema());

type BoardsLeadsTimelineProps = { leadId: string };
export const isBoardsLeadsTimelineProps = ajvQuery.compile<BoardsLeadsTimelineProps>(leadIdSchema());

// ---------------------------------------------------------------------------
// M6 — comm templates
// ---------------------------------------------------------------------------

type BoardsLeadsTemplateListProps = { channel?: CommTemplateChannel };

const BoardsLeadsTemplateListSchema = {
	type: 'object',
	properties: { channel: { type: 'string', enum: ['email', 'sms'], nullable: true } },
	required: [],
	additionalProperties: false,
};

export const isBoardsLeadsTemplateListProps = ajvQuery.compile<BoardsLeadsTemplateListProps>(BoardsLeadsTemplateListSchema);

type BoardsLeadsTemplateUpsertProps = {
	templateId?: string;
	fields: {
		name: string;
		channel: CommTemplateChannel;
		subject?: string;
		body: string;
		variables?: string[];
		practiceArea?: string;
		isSystem?: boolean;
	};
};

const BoardsLeadsTemplateUpsertSchema = {
	type: 'object',
	properties: {
		templateId: { type: 'string', nullable: true },
		fields: {
			type: 'object',
			properties: {
				name: { type: 'string', minLength: 1 },
				channel: { type: 'string', enum: ['email', 'sms'] },
				subject: { type: 'string', nullable: true },
				body: { type: 'string', minLength: 1 },
				variables: { type: 'array', items: { type: 'string' }, nullable: true },
				practiceArea: { type: 'string', nullable: true },
				isSystem: { type: 'boolean', nullable: true },
			},
			required: ['name', 'channel', 'body'],
			additionalProperties: false,
		},
	},
	required: ['fields'],
	additionalProperties: false,
};

export const isBoardsLeadsTemplateUpsertProps = ajv.compile<BoardsLeadsTemplateUpsertProps>(BoardsLeadsTemplateUpsertSchema);

type BoardsLeadsTemplateSendProps = { leadId: string; templateId: string; vars?: Record<string, string> };

const BoardsLeadsTemplateSendSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		templateId: { type: 'string', minLength: 1 },
		vars: { type: 'object', additionalProperties: { type: 'string' }, nullable: true },
	},
	required: ['leadId', 'templateId'],
	additionalProperties: false,
};

export const isBoardsLeadsTemplateSendProps = ajv.compile<BoardsLeadsTemplateSendProps>(BoardsLeadsTemplateSendSchema);

// ---------------------------------------------------------------------------
// M6 — intake tasks
// ---------------------------------------------------------------------------

type BoardsLeadsCreateTaskProps = {
	leadId: string;
	title: string;
	description?: string;
	dueAt?: string;
	assigneeId?: string;
};

const BoardsLeadsCreateTaskSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		title: { type: 'string', minLength: 1 },
		description: { type: 'string', nullable: true },
		dueAt: { type: 'string', nullable: true },
		assigneeId: { type: 'string', nullable: true },
	},
	required: ['leadId', 'title'],
	additionalProperties: false,
};

export const isBoardsLeadsCreateTaskProps = ajv.compile<BoardsLeadsCreateTaskProps>(BoardsLeadsCreateTaskSchema);

type BoardsLeadsTasksListProps = { leadId: string };
export const isBoardsLeadsTasksListProps = ajvQuery.compile<BoardsLeadsTasksListProps>(leadIdSchema());

type BoardsLeadsTaskCompleteProps = { taskId: string };

const BoardsLeadsTaskCompleteSchema = {
	type: 'object',
	properties: { taskId: { type: 'string', minLength: 1 } },
	required: ['taskId'],
	additionalProperties: false,
};

export const isBoardsLeadsTaskCompleteProps = ajv.compile<BoardsLeadsTaskCompleteProps>(BoardsLeadsTaskCompleteSchema);

// ---------------------------------------------------------------------------
// M6 — sequences (drip)
// ---------------------------------------------------------------------------

type BoardsLeadsSequencesListProps = Record<string, never>;

const BoardsLeadsSequencesListSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };

export const isBoardsLeadsSequencesListProps = ajvQuery.compile<BoardsLeadsSequencesListProps>(BoardsLeadsSequencesListSchema);

type BoardsLeadsSequencesEnrollProps = { sequenceId: string; leadId: string };

const BoardsLeadsSequencesEnrollSchema = {
	type: 'object',
	properties: {
		sequenceId: { type: 'string', minLength: 1 },
		leadId: { type: 'string', minLength: 1 },
	},
	required: ['sequenceId', 'leadId'],
	additionalProperties: false,
};

export const isBoardsLeadsSequencesEnrollProps = ajv.compile<BoardsLeadsSequencesEnrollProps>(BoardsLeadsSequencesEnrollSchema);

type BoardsLeadsSequencesAdvanceProps = { enrollmentId: string };

const BoardsLeadsSequencesAdvanceSchema = {
	type: 'object',
	properties: { enrollmentId: { type: 'string', minLength: 1 } },
	required: ['enrollmentId'],
	additionalProperties: false,
};

export const isBoardsLeadsSequencesAdvanceProps = ajv.compile<BoardsLeadsSequencesAdvanceProps>(BoardsLeadsSequencesAdvanceSchema);

// ---------------------------------------------------------------------------
// M6 — referrals out
// ---------------------------------------------------------------------------

type BoardsLeadsReferralOutUpsertProps = {
	/** when set, updates that outbound referral in place instead of inserting a new one. */
	referralOutId?: string;
	leadId: string;
	toFirmName: string;
	toReferralSourceId?: string;
	contact?: IReferralOutContact;
	arrangement: ReferralArrangement;
	agreedFeePct?: number;
	expectedFee?: number;
	agreementDocRef?: string;
	notes?: string;
	sentAt?: string;
};

const ReferralOutContactSchema = {
	type: 'object',
	nullable: true,
	properties: {
		name: { type: 'string', nullable: true },
		phone: { type: 'string', nullable: true },
		email: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

const BoardsLeadsReferralOutUpsertSchema = {
	type: 'object',
	properties: {
		referralOutId: { type: 'string', nullable: true },
		leadId: { type: 'string', minLength: 1 },
		toFirmName: { type: 'string', minLength: 1 },
		toReferralSourceId: { type: 'string', nullable: true },
		contact: ReferralOutContactSchema,
		arrangement: { type: 'string', enum: ['referral-fee', 'co-counsel'] },
		agreedFeePct: { type: 'number', nullable: true },
		expectedFee: { type: 'number', nullable: true },
		agreementDocRef: { type: 'string', nullable: true },
		notes: { type: 'string', nullable: true },
		sentAt: { type: 'string', nullable: true },
	},
	required: ['leadId', 'toFirmName', 'arrangement'],
	additionalProperties: false,
};

export const isBoardsLeadsReferralOutUpsertProps = ajv.compile<BoardsLeadsReferralOutUpsertProps>(BoardsLeadsReferralOutUpsertSchema);

type BoardsLeadsReferralOutSetStatusProps = {
	referralOutId: string;
	status: ReferralOutStatus;
	receivedFee?: number;
	receivedAt?: string;
	notes?: string;
};

const BoardsLeadsReferralOutSetStatusSchema = {
	type: 'object',
	properties: {
		referralOutId: { type: 'string', minLength: 1 },
		status: { type: 'string', enum: ['sent', 'accepted', 'declined', 'signed', 'fee-received', 'closed'] },
		receivedFee: { type: 'number', nullable: true },
		receivedAt: { type: 'string', nullable: true },
		notes: { type: 'string', nullable: true },
	},
	required: ['referralOutId', 'status'],
	additionalProperties: false,
};

export const isBoardsLeadsReferralOutSetStatusProps = ajv.compile<BoardsLeadsReferralOutSetStatusProps>(
	BoardsLeadsReferralOutSetStatusSchema,
);

type BoardsLeadsReferralsOutListProps = { leadId: string };
export const isBoardsLeadsReferralsOutListProps = ajvQuery.compile<BoardsLeadsReferralsOutListProps>(leadIdSchema());

// ---------------------------------------------------------------------------
// M6 — marketing ROI
// ---------------------------------------------------------------------------

type BoardsLeadsMarketingSourceRoiProps = { from?: string; to?: string };

const BoardsLeadsMarketingSourceRoiSchema = {
	type: 'object',
	properties: {
		from: { type: 'string', nullable: true },
		to: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsLeadsMarketingSourceRoiProps = ajvQuery.compile<BoardsLeadsMarketingSourceRoiProps>(
	BoardsLeadsMarketingSourceRoiSchema,
);

// ---------------------------------------------------------------------------
// M6 — signup packets
// ---------------------------------------------------------------------------

type BoardsLeadsSignupPacketGenerateProps = {
	leadId: string;
	docTemplateId: string;
	esignProvider?: EsignProvider;
	generatedDocRef?: string;
	signerEmail?: string;
};

const BoardsLeadsSignupPacketGenerateSchema = {
	type: 'object',
	properties: {
		leadId: { type: 'string', minLength: 1 },
		docTemplateId: { type: 'string', minLength: 1 },
		esignProvider: { type: 'string', enum: ['manual', 'docusign', 'dropbox-sign', 'omnisproof'], nullable: true },
		generatedDocRef: { type: 'string', nullable: true },
		signerEmail: { type: 'string', nullable: true },
	},
	required: ['leadId', 'docTemplateId'],
	additionalProperties: false,
};

export const isBoardsLeadsSignupPacketGenerateProps = ajv.compile<BoardsLeadsSignupPacketGenerateProps>(
	BoardsLeadsSignupPacketGenerateSchema,
);

type BoardsLeadsSignupPacketSetStatusProps = {
	packetId: string;
	status: SignUpPacketStatus;
	signedDocRef?: string;
	at?: string;
};

const BoardsLeadsSignupPacketSetStatusSchema = {
	type: 'object',
	properties: {
		packetId: { type: 'string', minLength: 1 },
		status: { type: 'string', enum: ['draft', 'generated', 'sent', 'viewed', 'signed', 'declined', 'voided'] },
		signedDocRef: { type: 'string', nullable: true },
		at: { type: 'string', nullable: true },
	},
	required: ['packetId', 'status'],
	additionalProperties: false,
};

export const isBoardsLeadsSignupPacketSetStatusProps = ajv.compile<BoardsLeadsSignupPacketSetStatusProps>(
	BoardsLeadsSignupPacketSetStatusSchema,
);

type BoardsLeadsSignupPacketGetProps = { leadId: string };
export const isBoardsLeadsSignupPacketGetProps = ajvQuery.compile<BoardsLeadsSignupPacketGetProps>(leadIdSchema());

type BoardsLeadsSignupPacketSendProps = { packetId: string; provider?: EsignProvider; subject?: string };

const BoardsLeadsSignupPacketSendSchema = {
	type: 'object',
	properties: {
		packetId: { type: 'string', minLength: 1 },
		provider: { type: 'string', enum: ['manual', 'docusign', 'dropbox-sign', 'omnisproof'], nullable: true },
		subject: { type: 'string', nullable: true },
	},
	required: ['packetId'],
	additionalProperties: false,
};

export const isBoardsLeadsSignupPacketSendProps = ajv.compile<BoardsLeadsSignupPacketSendProps>(
	BoardsLeadsSignupPacketSendSchema,
);

// ---------------------------------------------------------------------------
// M6 — reports
// ---------------------------------------------------------------------------

type BoardsLeadsReportFunnelProps = { boardId?: string };

/** Factory: a fresh `{ boardId? }` report-scope schema per compile. */
const reportScopeSchema = () => ({
	type: 'object',
	properties: { boardId: { type: 'string', nullable: true } },
	required: [],
	additionalProperties: false,
});

export const isBoardsLeadsReportFunnelProps = ajvQuery.compile<BoardsLeadsReportFunnelProps>(reportScopeSchema());
export const isBoardsLeadsReportScoreboardProps = ajvQuery.compile<BoardsLeadsReportFunnelProps>(reportScopeSchema());

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
	'/v1/boards.leads.markLost': {
		POST: (params: BoardsLeadsMarkLostProps) => { lead: ILead };
	};

	// ----- M6: conflict / dedupe / scoring / SOL -----
	'/v1/boards.leads.runConflictCheck': {
		GET: (params: BoardsLeadsByLeadIdProps) => {
			verdict: 'clear' | 'review' | 'conflict' | 'unknown';
			banner: string;
			matches: {
				queryName: string;
				querySide: 'client' | 'adverse';
				matchedName: string;
				matterId?: string;
				matterName?: string;
				similarity: number;
			}[];
			scanned: number;
			reason?: string;
		};
	};
	'/v1/boards.leads.checkDuplicates': {
		GET: (params: BoardsLeadsByLeadIdProps) => {
			hasDuplicates: boolean;
			leadCandidates: {
				kind: 'lead';
				leadId: string;
				refNo: number;
				name?: string;
				status?: string;
				matchedOn: ('phone' | 'email' | 'name')[];
				confidence: number;
			}[];
			matterCandidates: {
				kind: 'matter';
				matterId: string;
				matterName?: string;
				clientName?: string;
				matchedOn: ('phone' | 'email' | 'name')[];
				confidence: number;
			}[];
		};
	};
	'/v1/boards.leads.computeScore': {
		GET: (params: BoardsLeadsByLeadIdProps) => {
			score: number;
			factors: { ruleId: string; label: string; points: number }[];
			qualification: ILeadQualification;
		};
	};
	'/v1/boards.leads.computeSol': {
		GET: (params: BoardsLeadsByLeadIdProps) => {
			solDate?: string;
			computedFrom: 'casepro' | 'rules-engine' | 'manual';
			years?: number;
			claimType?: string;
			atRisk?: boolean;
			reason?: string;
		};
	};

	// ----- M6: communications timeline -----
	'/v1/boards.leads.timeline': {
		GET: (params: BoardsLeadsTimelineProps) => { communications: ICommunication[] };
	};

	// ----- M6: comm templates -----
	'/v1/boards.leads.template.list': {
		GET: (params: BoardsLeadsTemplateListProps) => { templates: ICommTemplate[] };
	};
	'/v1/boards.leads.template.upsert': {
		POST: (params: BoardsLeadsTemplateUpsertProps) => { template: ICommTemplate; created: boolean };
	};
	'/v1/boards.leads.template.send': {
		POST: (params: BoardsLeadsTemplateSendProps) => {
			commId: string;
			communication: ICommunication;
			rendered: { subject?: string; body: string };
		};
	};

	// ----- M6: intake tasks -----
	'/v1/boards.leads.createTask': {
		POST: (params: BoardsLeadsCreateTaskProps) => { task: IIntakeTask };
	};
	'/v1/boards.leads.tasks.list': {
		GET: (params: BoardsLeadsTasksListProps) => { tasks: IIntakeTask[] };
	};
	'/v1/boards.leads.tasks.complete': {
		POST: (params: BoardsLeadsTaskCompleteProps) => { task: IIntakeTask };
	};

	// ----- M6: sequences (drip) -----
	'/v1/boards.leads.sequences.list': {
		GET: (params: BoardsLeadsSequencesListProps) => { sequences: ISequence[] };
	};
	'/v1/boards.leads.sequences.enroll': {
		POST: (params: BoardsLeadsSequencesEnrollProps) => { enrollment: ISequenceEnrollment; alreadyEnrolled: boolean };
	};
	'/v1/boards.leads.sequences.advance': {
		POST: (params: BoardsLeadsSequencesAdvanceProps) => {
			enrollment: ISequenceEnrollment;
			action: 'ran-step' | 'completed' | 'stopped' | 'skipped';
			ranStep?: number;
			stoppedReason?: string;
		};
	};

	// ----- M6: referrals out -----
	'/v1/boards.leads.referralOut.upsert': {
		POST: (params: BoardsLeadsReferralOutUpsertProps) => { referralOut: IReferralOut; lead: ILead; created: boolean };
	};
	'/v1/boards.leads.referralOut.setStatus': {
		POST: (params: BoardsLeadsReferralOutSetStatusProps) => { referralOut: IReferralOut };
	};
	'/v1/boards.leads.referralsOut.list': {
		GET: (params: BoardsLeadsReferralsOutListProps) => { referralsOut: IReferralOut[] };
	};

	// ----- M6: marketing ROI -----
	'/v1/boards.leads.marketing.sourceRoi': {
		GET: (params: BoardsLeadsMarketingSourceRoiProps) => {
			rows: unknown[];
			totals: { leads: number; signed: number; spend: number; revenue: number; conversionPct: number; roas: number };
			window?: { from?: string; to?: string };
			revenueResolved: boolean;
		};
	};

	// ----- M6: signup packets -----
	'/v1/boards.leads.signupPacket.generate': {
		POST: (params: BoardsLeadsSignupPacketGenerateProps) => { packet: ISignUpPacket };
	};
	'/v1/boards.leads.signupPacket.setStatus': {
		POST: (params: BoardsLeadsSignupPacketSetStatusProps) => { packet: ISignUpPacket; conversionArmed: boolean };
	};
	'/v1/boards.leads.signupPacket.get': {
		GET: (params: BoardsLeadsSignupPacketGetProps) => { packet: ISignUpPacket | null };
	};
	'/v1/boards.leads.signupPacket.send': {
		POST: (params: BoardsLeadsSignupPacketSendProps) => { packet: ISignUpPacket; envelopeId: string; signUrl?: string };
	};

	// ----- M6: reports -----
	'/v1/boards.leads.reports.funnel': {
		GET: (params: BoardsLeadsReportFunnelProps) => {
			totalLeads: number;
			gates: { gate: string; count: number; conversionPct: number }[];
			overallConversionPct: number;
			avgHoursToContact: number;
			avgHoursToSigned: number;
			avgTimeInStageHours: { stage: string; avgHours: number; count: number }[];
		};
	};
	'/v1/boards.leads.reports.scoreboard': {
		GET: (params: BoardsLeadsReportFunnelProps) => {
			rows: {
				ownerId: string;
				handled: number;
				contacted: number;
				signed: number;
				conversionPct: number;
				avgFirstContactMinutes: number;
				slaAdherencePct: number;
			}[];
			unassigned: number;
		};
	};
};

export type { LeadLostReason };
