import type { IRocketChatRecord } from './IRocketChatRecord';

/**
 * Sign-up / retainer packet for a lead with an e-sign status state machine
 * (Tier 2, collection `boards_signup_packets`). The `signedDocRef` (executed PDF
 * in LitBox) is carried forward to the matter on convert; a signed packet is one
 * of the two conversion gates (the other being the POA-Received stage).
 *
 * State machine:
 *   draft -> generated -> sent -> viewed -> signed
 *   (sent|viewed) -> declined
 *   (any) -> voided
 */

export type SignUpPacketStatus = 'draft' | 'generated' | 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';

export type EsignProvider = 'manual' | 'docusign' | 'dropbox-sign' | 'omnisproof';

export interface ISignUpPacket extends IRocketChatRecord {
	leadId: string; // -> ILead._id
	docTemplateId: string; // engagement/retainer template
	caseTypeId?: string; // -> CasePro case_types.id
	status: SignUpPacketStatus;
	esignProvider?: EsignProvider;
	generatedDocRef?: string; // unsigned PDF (LitBox)
	sentAt?: Date;
	viewedAt?: Date;
	signedAt?: Date;
	declinedAt?: Date;
	signedDocRef?: string; // executed PDF, carried to matter on convert
	esignEnvelopeId?: string; // provider envelope id
	signerEmail?: string;
}
