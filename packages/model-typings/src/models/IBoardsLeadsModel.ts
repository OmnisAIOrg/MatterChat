import type { ICommunication, ILead, ILeadQualification, LeadLostReason } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsLeadsModel extends IBaseModel<ILead> {
	/** The 1:1 card link finder (unique-sparse on cardId). */
	findOneByCardId(cardId: string, options?: FindOptions<ILead>): Promise<ILead | null>;

	/** The CasePro intake sync-key finder (unique-sparse on caseproIntakeId). */
	findOneByCaseproIntakeId(caseproIntakeId: string, options?: FindOptions<ILead>): Promise<ILead | null>;

	findByBoard(boardId: string, options?: FindOptions<ILead>): FindCursor<ILead>;
	findByStatus(statusId: string, options?: FindOptions<ILead>): FindCursor<ILead>;
	findByOwner(ownerId: string, options?: FindOptions<ILead>): FindCursor<ILead>;

	/** Duplicate detection (P1): exact phone OR email match on open leads. */
	findByPhoneOrEmail(phone?: string, email?: string, options?: FindOptions<ILead>): FindCursor<ILead>;

	/** SLA scan: slaDueAt <= now, not yet breached, still open. */
	findSlaBreaches(now: Date, options?: FindOptions<ILead>): FindCursor<ILead>;

	setStatus(leadId: string, statusId: string, subStatus?: string): Promise<UpdateResult>;
	setQualification(leadId: string, qualification: ILeadQualification): Promise<UpdateResult>;
	setOwner(leadId: string, ownerId: string, slaDueAt?: Date, assignedBy?: string): Promise<UpdateResult>;

	markConverted(leadId: string, conversion: { matterId?: string; matterCardId?: string; byUserId?: string }): Promise<UpdateResult>;
	markLost(leadId: string, reason: LeadLostReason, byUserId?: string): Promise<UpdateResult>;

	/**
	 * $set lastContactedAt/lastActivityAt (+ slaFirstContactAt once), clear coldSince.
	 * When `direction === 'in'` also stamps `lastInboundAt` — the genuine "lead
	 * responded" signal the drip self-stop keys off (an outbound send must NOT set it).
	 */
	recordContact(leadId: string, at: Date, direction?: ICommunication['direction']): Promise<UpdateResult>;

	archive(leadId: string): Promise<UpdateResult>;
}
