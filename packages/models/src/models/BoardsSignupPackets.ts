import type { ISignUpPacket, SignUpPacketStatus, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsSignupPacketsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

/** Maps a status transition to the timestamp field it stamps. */
const STATUS_TIMESTAMP: Partial<Record<SignUpPacketStatus, keyof ISignUpPacket>> = {
	sent: 'sentAt',
	viewed: 'viewedAt',
	signed: 'signedAt',
	declined: 'declinedAt',
};

export class BoardsSignupPacketsRaw extends BaseRaw<ISignUpPacket> implements IBoardsSignupPacketsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<ISignUpPacket>>) {
		super(db, 'boards_signup_packets', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { leadId: 1 } },
			{ key: { status: 1 } },
			{ key: { esignEnvelopeId: 1 }, unique: true, sparse: true },
		];
	}

	public findByLead(leadId: string, options?: FindOptions<ISignUpPacket>): FindCursor<ISignUpPacket> {
		return this.find({ leadId }, { sort: { _updatedAt: -1 }, ...options });
	}

	public findByStatus(status: SignUpPacketStatus, options?: FindOptions<ISignUpPacket>): FindCursor<ISignUpPacket> {
		return this.find({ status }, options);
	}

	public findLatestByLead(leadId: string): Promise<ISignUpPacket | null> {
		return this.findOne({ leadId, status: { $ne: 'voided' } }, { sort: { _updatedAt: -1 } });
	}

	public findOneByEnvelopeId(esignEnvelopeId: string): Promise<ISignUpPacket | null> {
		return this.findOne({ esignEnvelopeId });
	}

	public setStatus(packetId: string, status: SignUpPacketStatus, at: Date = new Date()): Promise<UpdateResult> {
		const tsField = STATUS_TIMESTAMP[status];
		return this.updateOne(
			{ _id: packetId },
			{ $set: { status, ...(tsField ? { [tsField]: at } : {}) } },
		);
	}

	public recordSigned(packetId: string, signedDocRef: string, at: Date): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: packetId },
			{ $set: { status: 'signed', signedDocRef, signedAt: at } },
		);
	}

	public updatePacket(packetId: string, patch: Partial<ISignUpPacket>): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<ISignUpPacket> & { _id?: string };
		return this.updateOne({ _id: packetId }, { $set: rest });
	}

	public removePacket(packetId: string): Promise<DeleteResult> {
		return this.removeById(packetId);
	}
}
