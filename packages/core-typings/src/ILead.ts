import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Boards-native lead record (Tier 2, collection `boards_leads`). 1:1 with a
 * `cardType:'lead'` card on the canonical Leads board — the card is the kanban
 * face (column = `boards_lists` whose `caseproStageId` is an `intake_stages.id`),
 * this doc is the full intake record. The intake STATUS is a column id, not its
 * own collection (per 00-MASTER-PLAN: doc 01's `omnis_intake_stages` is dropped;
 * stages live as `boards_lists` rows). Leads are MatterChat-owned until convert —
 * CasePro has no pre-conversion lead entity.
 */

export type LeadStatusId = string; // -> boards_lists._id (the intake-stage column)

export type PreferredContact = 'phone' | 'email' | 'sms' | 'any';

export type LeadCapturedChannel = 'manual' | 'web-form' | 'csv-import' | 'call' | 'sms' | 'email-parse' | 'api';

export type LeadLostReason = 'declined-unqualified' | 'declined-lost' | 'no-response' | 'referred-out' | 'duplicate' | 'other';

/** Emergent-role contact captured at intake (the prospective client). */
export interface ILeadContact {
	firstName?: string;
	lastName?: string;
	fullName?: string;
	phone?: string;
	mobile?: string;
	email?: string;
	address?: string;
	street?: string;
	city?: string;
	state?: string;
	zip?: string;
	dateOfBirth?: Date;
	language?: string;
}

/** The incident block — drives SOL rules and the future matter's DOI. */
export interface ILeadIncident {
	incidentType?: string;
	incidentDate?: Date; // DOI
	incidentTime?: string;
	incidentDescription?: string;
	injuries?: string[];
	jurisdictionState?: string; // drives SOL rules
	incidentCity?: string;
	incidentZip?: string;
}

/** Qualification / scoring block. */
export interface ILeadQualification {
	score?: number; // 0..100 computed
	scoreBreakdown?: { ruleId: string; label: string; points: number }[];
	qualified?: boolean;
	disqualifyReason?: string;
}

export interface IUtm {
	source?: string;
	medium?: string;
	campaign?: string;
	term?: string;
	content?: string;
}

/** Marketing / referral attribution block. */
export interface ILeadAttribution {
	source?: string; // marketing-source name (denormalized for display/ROI)
	marketingSourceId?: string; // -> boards_referrals._id (typed source/campaign registry)
	campaignId?: string; // embedded campaign id within a referral source
	utm?: IUtm;
	referralSourceId?: string; // -> IReferralSource._id (inbound referrer)
	referredByName?: string; // denormalized referrer display name
	spend?: number; // attributed spend for CPL/ROI (query-then-sum at report time)
}

/** Ownership + speed-to-lead SLA block. */
export interface ILeadOwnership {
	ownerId?: IUser['_id']; // assigned intake specialist (MatterChat user)
	assignedAt?: Date;
	assignedBy?: IUser['_id'] | 'system';
	slaDueAt?: Date; // speed-to-lead target
	slaBreached?: boolean;
	slaFirstContactAt?: Date; // when first outbound comm logged
}

export interface ILead extends IRocketChatRecord {
	// identity / linkage
	refNo: number; // human ref, monotonic (boards_counters: leadRefNo)
	cardId?: string; // -> boards_cards._id (the cardType:'lead' card; 1:1 link)
	boardId?: string; // -> boards_boards._id (the canonical Leads board)

	// CasePro intake sync (M3): CasePro is SoR, this doc is the synced working view.
	caseproIntakeId?: string; // -> CasePro intake_questionnaires.id (the 1:1 sync key)
	caseproIntakeNumber?: string; // -> CasePro intake_questionnaires.intake_id (human ref)

	// classification
	caseTypeId?: string; // -> CasePro case_types.id (practice area)
	practiceArea?: string; // denormalized practice-area name for display
	statusId: LeadStatusId; // intake stage column (-> boards_lists._id)
	subStatus?: string; // free-ish refinement (No Answer 1, Left VM, …)

	// contact (the prospective client)
	contact: ILeadContact;
	preferredContact?: PreferredContact;

	// incident
	incident?: ILeadIncident;

	// qualification
	qualification?: ILeadQualification;

	// SOL guardrail
	solDate?: Date;
	solComputedFrom?: 'casepro' | 'rules-engine' | 'manual';
	solAtRisk?: boolean; // derived (solDate within window)

	// attribution
	attribution?: ILeadAttribution;

	// ownership / workflow
	ownership?: ILeadOwnership;
	coldSince?: Date; // derived from lastContactedAt aging

	// lifecycle timestamps
	capturedAt: Date;
	capturedChannel: LeadCapturedChannel;
	capturedByUserId?: IUser['_id']; // null for public web-form
	lastContactedAt?: Date; // any logged comm (in OR out) — drives cold-lead aging
	lastInboundAt?: Date; // last INBOUND comm only — the genuine "lead responded" signal
	lastActivityAt?: Date;

	// conversion / exit
	convertedMatterId?: string; // CasePro matters.id
	convertedMatterCardId?: string; // Matters board card _id
	convertedAt?: Date;
	convertedBy?: IUser['_id'];
	lostAt?: Date;
	lostReason?: LeadLostReason;

	// links / extras
	questionnaireId?: string; // -> boards_questionnaires._id
	channelRoomId?: string; // optional channel-per-lead (createRoom)
	litboxWorkspaceId?: string; // carried to matter on convert
	tags?: string[];

	archived: boolean;
	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
}
