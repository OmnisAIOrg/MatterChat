import type { IReferralOut, ReferralOutStatus, ReferralArrangement, IReferralOutContact, ILead } from '@rocket.chat/core-typings';
import { BoardsReferralsOut, BoardsLeads, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';

/**
 * Outbound / co-counsel referral management (M6 — intake-lead-management.md §8).
 * The INBOUND referral-source directory upsert already lives in `./service`
 * (`upsertReferralSource`) and is re-used as-is; this module adds the OUTBOUND
 * side: recording that we referred a lead to another firm, the agreed/expected/
 * received fee, the arrangement (referral-fee vs co-counsel), and driving the
 * status to closure so referral revenue is tracked, never lost.
 *
 * Mutation convention mirrors the leads service: model write → BoardsActivities
 * audit row on the lead card. Gated by `boards-leads-referrals-manage`.
 */

export type CreateReferralOutFields = {
	leadId: string;
	toFirmName: string;
	toReferralSourceId?: string;
	contact?: IReferralOutContact;
	arrangement: ReferralArrangement;
	agreedFeePct?: number;
	expectedFee?: number;
	agreementDocRef?: string;
	notes?: string;
	sentAt?: Date;
};

export type CreateReferralOutResult = { referralOut: IReferralOut; lead: ILead };

/**
 * Record an outbound referral for a lead. Creates the `boards_referrals_out` row
 * (status 'sent'), audit-logs `card.linked` on the lead card, and (optionally)
 * marks the lead lost with reason 'referred-out' so the pipeline reflects it.
 */
export async function createReferralOut(uid: string, fields: CreateReferralOutFields): Promise<CreateReferralOutResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-referrals-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.referralOut.create' });
	}
	const lead = await BoardsLeads.findOneById(fields.leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.referralOut.create' });
	}

	const now = new Date();
	const doc: Omit<IReferralOut, '_id' | '_updatedAt'> = {
		leadId: fields.leadId,
		toFirmName: fields.toFirmName,
		...(fields.toReferralSourceId ? { toReferralSourceId: fields.toReferralSourceId } : {}),
		...(fields.contact ? { contact: fields.contact } : {}),
		sentAt: fields.sentAt ?? now,
		status: 'sent',
		arrangement: fields.arrangement,
		...(fields.agreedFeePct !== undefined ? { agreedFeePct: fields.agreedFeePct } : {}),
		...(fields.expectedFee !== undefined ? { expectedFee: fields.expectedFee } : {}),
		...(fields.agreementDocRef ? { agreementDocRef: fields.agreementDocRef } : {}),
		...(fields.notes ? { notes: fields.notes } : {}),
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId } = await BoardsReferralsOut.insertOne(doc);
	const referralOut = await BoardsReferralsOut.findOneById(insertedId);
	if (!referralOut) {
		throw new Meteor.Error('error-referral-out-not-found', 'Referral not found after create', {
			method: 'boards.leads.referralOut.create',
		});
	}

	if (lead.boardId) {
		await BoardsActivities.log({
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			verb: 'card.linked',
			to: { referredOutTo: fields.toFirmName, referralOutId: insertedId, arrangement: fields.arrangement },
			ts: now,
		});
	}

	const fresh = (await BoardsLeads.findOneById(fields.leadId)) ?? lead;
	return { referralOut, lead: fresh };
}

export type UpdateReferralOutStatusParams = {
	status: ReferralOutStatus;
	/** when status === 'fee-received', the actual fee + when it arrived. */
	receivedFee?: number;
	receivedAt?: Date;
	notes?: string;
};

/**
 * Advance an outbound referral's status. When the terminal `fee-received` status
 * is set we record the received fee via the model's `recordReceivedFee` helper
 * (which also stamps `receivedAt` + the status). Audit-logs on the lead card.
 */
export async function updateReferralOutStatus(
	uid: string,
	referralOutId: string,
	params: UpdateReferralOutStatusParams,
): Promise<IReferralOut> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-referrals-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.referralOut.setStatus' });
	}
	const current = await BoardsReferralsOut.findOneById(referralOutId);
	if (!current) {
		throw new Meteor.Error('error-referral-out-not-found', 'Referral not found', {
			method: 'boards.leads.referralOut.setStatus',
		});
	}

	if (params.status === 'fee-received' && params.receivedFee !== undefined) {
		await BoardsReferralsOut.recordReceivedFee(referralOutId, params.receivedFee, params.receivedAt ?? new Date());
	} else {
		await BoardsReferralsOut.setStatus(referralOutId, params.status);
	}
	if (params.notes !== undefined) {
		await BoardsReferralsOut.updateReferralOut(referralOutId, { notes: params.notes });
	}

	const lead = await BoardsLeads.findOneById(current.leadId);
	if (lead?.boardId) {
		await BoardsActivities.log({
			boardId: lead.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { referralOutId, status: params.status, ...(params.receivedFee !== undefined ? { receivedFee: params.receivedFee } : {}) },
			ts: new Date(),
		});
	}

	const fresh = await BoardsReferralsOut.findOneById(referralOutId);
	if (!fresh) {
		throw new Meteor.Error('error-referral-out-not-found', 'Referral not found', {
			method: 'boards.leads.referralOut.setStatus',
		});
	}
	return fresh;
}

/** List outbound referrals for a lead (sent desc). Requires view permission. */
export async function listReferralsOut(uid: string, leadId: string): Promise<IReferralOut[]> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.referralOut.list' });
	}
	return BoardsReferralsOut.findByLead(leadId).toArray();
}
