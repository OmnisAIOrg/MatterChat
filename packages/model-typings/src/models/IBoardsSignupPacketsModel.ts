import type { ISignUpPacket, SignUpPacketStatus } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsSignupPacketsModel extends IBaseModel<ISignUpPacket> {
	findByLead(leadId: string, options?: FindOptions<ISignUpPacket>): FindCursor<ISignUpPacket>;
	findByStatus(status: SignUpPacketStatus, options?: FindOptions<ISignUpPacket>): FindCursor<ISignUpPacket>;

	/** The lead's most recent non-voided packet (the active sign-up gate). */
	findLatestByLead(leadId: string): Promise<ISignUpPacket | null>;

	/** Lookup by e-sign provider envelope id (webhook reconciliation). */
	findOneByEnvelopeId(esignEnvelopeId: string): Promise<ISignUpPacket | null>;

	/** Advance the e-sign state machine and stamp the matching timestamp. */
	setStatus(packetId: string, status: SignUpPacketStatus, at?: Date): Promise<UpdateResult>;
	recordSigned(packetId: string, signedDocRef: string, at: Date): Promise<UpdateResult>;
	updatePacket(packetId: string, patch: Partial<ISignUpPacket>): Promise<UpdateResult>;
	removePacket(packetId: string): Promise<DeleteResult>;
}
