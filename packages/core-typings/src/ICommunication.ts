import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Call / SMS / email / note / system log entry on a lead (Tier 2, collection
 * `boards_communications`). Feeds the lead timeline (sorted ts desc). Some kinds
 * carry a transcript (calls) or are template/sequence-driven.
 */

export type CommunicationKind = 'call' | 'sms' | 'email' | 'note' | 'task-note' | 'system';

export type CommunicationDirection = 'in' | 'out' | 'internal';

export type CallDisposition = 'connected' | 'no-answer' | 'voicemail' | 'busy' | 'wrong-number';

export type CommunicationDeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced';

export interface ICommunication extends IRocketChatRecord {
	leadId: string; // -> ILead._id
	kind: CommunicationKind;
	direction: CommunicationDirection;
	subject?: string;
	body?: string; // template-rendered or free text
	transcript?: string; // call transcription (P3)
	templateId?: string; // -> ICommTemplate._id
	sequenceId?: string; // -> automation sequence (if part of a drip)
	callDisposition?: CallDisposition;
	callDurationSec?: number;
	recordingRef?: string;
	ts: Date;
	byUserId?: IUser['_id']; // null for automated
	channelMessageId?: string; // if mirrored into the lead's MatterChat channel
	deliveryStatus?: CommunicationDeliveryStatus;
}
