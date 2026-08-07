import type { IReferralOut, ReferralOutStatus, ReferralArrangement, IReferralOutContact, ILead } from '@rocket.chat/core-typings';
import { BoardsReferralsOut, BoardsLeads, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../authorization/hasPermission';

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
	/**
	 * When set, UPDATE the existing outbound referral instead of inserting a new
	 * one — so re-saving an edited referral from the UI doesn't silently create a
	 * duplicate row (the upsert was previously create-only). When omitted we insert.
	 */
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
	sentAt?: Date;
};

export type CreateReferralOutResult = { referralOut: IReferralOut; lead: ILead; created: boolean };

/**
 * Upsert an outbound referral for a lead. With no `referralOutId` we INSERT the
 * `boards_referrals_out` row (status 'sent') and audit-log `card.linked`; with a
 * `referralOutId` we UPDATE that existing row's editable fields in place (no dup)
 * and audit-log `field.changed`. The `status` is owned by `updateReferralOutStatus`
 * — an update here never resets it.
 */
export async function createReferralOut(uid: string, fields: CreateReferralOutFields): Promise<CreateReferralOutResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-referrals-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.referralOut.upsert' });
	}
	const lead = await BoardsLeads.findOneById(fields.leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.referralOut.upsert' });
	}

	const now = new Date();

	// UPDATE path: patch the existing referral's editable fields (status untouched).
	if (fields.referralOutId) {
		const existing = await BoardsReferralsOut.findOneById(fields.referralOutId);
		if (!existing || existing.leadId !== fields.leadId) {
			throw new Meteor.Error('error-referral-out-not-found', 'Referral not found', {
				method: 'boards.leads.referralOut.upsert',
			});
		}
		await BoardsReferralsOut.updateReferralOut(fields.referralOutId, {
			toFirmName: fields.toFirmName,
			arrangement: fields.arrangement,
			...(fields.toReferralSourceId !== undefined ? { toReferralSourceId: fields.toReferralSourceId } : {}),
			...(fields.contact !== undefined ? { contact: fields.contact } : {}),
			...(fields.agreedFeePct !== undefined ? { agreedFeePct: fields.agreedFeePct } : {}),
			...(fields.expectedFee !== undefined ? { expectedFee: fields.expectedFee } : {}),
			...(fields.agreementDocRef !== undefined ? { agreementDocRef: fields.agreementDocRef } : {}),
			...(fields.notes !== undefined ? { notes: fields.notes } : {}),
			...(fields.sentAt !== undefined ? { sentAt: fields.sentAt } : {}),
		});

		if (lead.boardId) {
			await BoardsActivities.log({
				boardId: lead.boardId,
				...(lead.cardId ? { cardId: lead.cardId } : {}),
				actor: uid,
				verb: 'field.changed',
				to: { referralOutId: fields.referralOutId, toFirmName: fields.toFirmName, arrangement: fields.arrangement },
				ts: now,
			});
		}

		const updated = await BoardsReferralsOut.findOneById(fields.referralOutId);
		if (!updated) {
			throw new Meteor.Error('error-referral-out-not-found', 'Referral not found after update', {
				method: 'boards.leads.referralOut.upsert',
			});
		}
		const freshLead = (await BoardsLeads.findOneById(fields.leadId)) ?? lead;
		return { referralOut: updated, lead: freshLead, created: false };
	}

	// INSERT path.
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
			method: 'boards.leads.referralOut.upsert',
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
	return { referralOut, lead: fresh, created: true };
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
