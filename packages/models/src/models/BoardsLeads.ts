import type { ILead, ILeadQualification, LeadLostReason, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsLeadsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, Filter, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsLeadsRaw extends BaseRaw<ILead> implements IBoardsLeadsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<ILead>>) {
		super(db, 'boards_leads', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { cardId: 1 }, unique: true, sparse: true },
			{ key: { statusId: 1, archived: 1 } },
			{ key: { boardId: 1, archived: 1 } },
			{ key: { 'contact.phone': 1 }, sparse: true },
			{ key: { 'contact.email': 1 }, sparse: true },
			{ key: { 'ownership.ownerId': 1, 'ownership.slaDueAt': 1 } },
			{ key: { refNo: 1 }, unique: true },
		];
	}

	public findOneByCardId(cardId: string, options?: FindOptions<ILead>): Promise<ILead | null> {
		return this.findOne({ cardId }, options);
	}

	public findByBoard(boardId: string, options?: FindOptions<ILead>): FindCursor<ILead> {
		return this.find({ boardId, archived: { $ne: true } }, options);
	}

	public findByStatus(statusId: string, options?: FindOptions<ILead>): FindCursor<ILead> {
		return this.find({ statusId, archived: { $ne: true } }, { sort: { capturedAt: -1 }, ...options });
	}

	public findByOwner(ownerId: string, options?: FindOptions<ILead>): FindCursor<ILead> {
		return this.find({ 'ownership.ownerId': ownerId, 'archived': { $ne: true } }, options);
	}

	public findByPhoneOrEmail(phone?: string, email?: string, options?: FindOptions<ILead>): FindCursor<ILead> {
		const or: Filter<ILead>[] = [];
		if (phone) {
			or.push({ 'contact.phone': phone }, { 'contact.mobile': phone });
		}
		if (email) {
			or.push({ 'contact.email': email });
		}
		// when nothing to match on, return an impossible filter so the cursor is empty
		const filter: Filter<ILead> = or.length ? { $or: or, archived: { $ne: true } } : { _id: { $exists: false } };
		return this.find(filter, options);
	}

	public findSlaBreaches(now: Date, options?: FindOptions<ILead>): FindCursor<ILead> {
		return this.find(
			{
				'ownership.slaDueAt': { $lte: now },
				'ownership.slaBreached': { $ne: true },
				'archived': { $ne: true },
				'convertedAt': { $exists: false },
				'lostAt': { $exists: false },
			},
			options,
		);
	}

	public setStatus(leadId: string, statusId: string, subStatus?: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: leadId },
			{
				$set: {
					statusId,
					...(subStatus !== undefined ? { subStatus } : {}),
					lastActivityAt: new Date(),
				},
				$inc: { rev: 1 },
			},
		);
	}

	public setQualification(leadId: string, qualification: ILeadQualification): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: leadId },
			{ $set: { qualification, lastActivityAt: new Date() }, $inc: { rev: 1 } },
		);
	}

	public setOwner(leadId: string, ownerId: string, slaDueAt?: Date, assignedBy?: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: leadId },
			{
				$set: {
					'ownership.ownerId': ownerId,
					'ownership.assignedAt': new Date(),
					...(assignedBy !== undefined ? { 'ownership.assignedBy': assignedBy } : {}),
					...(slaDueAt !== undefined ? { 'ownership.slaDueAt': slaDueAt } : {}),
					'ownership.slaBreached': false,
					'lastActivityAt': new Date(),
				},
				$inc: { rev: 1 },
			},
		);
	}

	public markConverted(
		leadId: string,
		conversion: { matterId?: string; matterCardId?: string; byUserId?: string },
	): Promise<UpdateResult> {
		const now = new Date();
		return this.updateOne(
			{ _id: leadId },
			{
				$set: {
					...(conversion.matterId !== undefined ? { convertedMatterId: conversion.matterId } : {}),
					...(conversion.matterCardId !== undefined ? { convertedMatterCardId: conversion.matterCardId } : {}),
					...(conversion.byUserId !== undefined ? { convertedBy: conversion.byUserId } : {}),
					convertedAt: now,
					lastActivityAt: now,
				},
				$inc: { rev: 1 },
			},
		);
	}

	public markLost(leadId: string, reason: LeadLostReason, byUserId?: string): Promise<UpdateResult> {
		const now = new Date();
		return this.updateOne(
			{ _id: leadId },
			{
				$set: {
					lostReason: reason,
					...(byUserId !== undefined ? { convertedBy: byUserId } : {}),
					lostAt: now,
					lastActivityAt: now,
				},
				$inc: { rev: 1 },
			},
		);
	}

	public recordContact(leadId: string, at: Date): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: leadId },
			{
				$set: { lastContactedAt: at, lastActivityAt: at },
				$min: { 'ownership.slaFirstContactAt': at },
				$unset: { coldSince: '' },
				$inc: { rev: 1 },
			},
		);
	}

	public archive(leadId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: leadId }, { $set: { archived: true }, $inc: { rev: 1 } });
	}
}
