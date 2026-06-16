import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * A tracked deadline on a card (Tier 2, collection `boards_deadlines`). The
 * safety-critical SOL/deadline engine (differentiators.md §4): every deadline is
 * its own doc so it can be surfaced on Calendar/Timeline regardless of card
 * stage, escalated in tiers, and require mandatory acknowledgement on high-risk
 * kinds (SOL/filing). Multiple deadlines per card are normal (SOL + filing +
 * discovery + mediation, etc.).
 *
 * `computedFrom` records how `dueDate` was derived so a lawyer can review/override:
 *   - 'casepro'      : read from matters.statute_of_limitations (or other CasePro date)
 *   - 'rules-engine' : incident_date + jurisdiction SOL rules table (default TX PI 2y)
 *   - 'manual'       : entered/overridden by a user
 *   - 'playbook'     : stamped by a stage playbook item (createsDeadlineKind)
 *   - 'sequence'     : created by a drip/response timer
 */

export type BoardDeadlineKind = 'SOL' | 'filing' | 'discovery' | 'mediation' | 'response' | 'custom';

export type BoardDeadlineComputedFrom = 'casepro' | 'rules-engine' | 'manual' | 'playbook' | 'sequence';

export type BoardDeadlineStatus = 'open' | 'acknowledged' | 'satisfied' | 'waived' | 'missed';

export interface IBoardDeadline extends IRocketChatRecord {
	cardId: string; // -> boards_cards._id
	boardId: string; // -> boards_boards._id (denormalized for board-wide deadline scans)
	leadId?: string; // -> boards_leads._id (when on a lead card)
	matterId?: string; // -> CasePro matters.id (when on a matter card)

	kind: BoardDeadlineKind;
	label?: string; // free label, esp. for kind:'custom'
	dueDate: Date;

	computedFrom: BoardDeadlineComputedFrom;
	computedRuleId?: string; // -> the SOL rules-table row used (auditability)
	jurisdiction?: string; // state/claim-type used by the rules engine
	baseDate?: Date; // the incident/trigger date the dueDate was computed from

	status: BoardDeadlineStatus;
	escalationLevel: number; // 0 = none; bumped by the tickler as the date nears/passes
	highRisk?: boolean; // SOL/filing default true -> mandatory acknowledgement

	acknowledged: boolean; // mandatory-ack satisfied
	acknowledgedAt?: Date;
	acknowledgedBy?: IUser['_id'];
	lastNotifiedAt?: Date; // dedupe reminder fan-out
	nextReminderAt?: Date; // when the tickler should next fire

	satisfiedAt?: Date;
	waivedReason?: string;
	notes?: string;

	rev: number;
	createdBy?: IUser['_id'] | 'system';
	createdAt: Date;
}
