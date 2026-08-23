import type { ILead } from '@rocket.chat/core-typings';
import { BoardsLeads } from '@rocket.chat/models';

import { firmScopedBoardIds } from '../firmScope';
import { normalizeName, nameSimilarity } from './conflict';
import { getMattersSnapshots } from './mattersSnapshotMemo';

/**
 * Duplicate detection (M6 — intake-lead-management.md §5). On capture (or on
 * demand) match the lead's phone / email / normalized name against:
 *   1. existing `boards_leads` (the obvious "same person called twice"),
 *   2. existing CasePro matters (a current client re-contacting about a new event,
 *      or a re-open) — read THROUGH the one matters `caseProClient`.
 *
 * Returns candidate links the UI offers as "merge" or "link" (it never auto-
 * merges). Phone/email are exact (normalized) — that is the P1 high-confidence
 * signal; name is fuzzy (the P2 signal, reusing the conflict matcher). Degrades
 * gracefully: a CasePro read failure simply omits matter candidates.
 */

export type DupMatchField = 'phone' | 'email' | 'name';

export type DupLeadCandidate = {
	kind: 'lead';
	leadId: string;
	refNo: number;
	name?: string;
	status?: string; // open | converted | lost (for the UI)
	matchedOn: DupMatchField[];
	confidence: number; // 0..1
};

export type DupMatterCandidate = {
	kind: 'matter';
	matterId: string;
	matterName?: string;
	clientName?: string;
	matchedOn: DupMatchField[];
	confidence: number;
};

export type CheckDuplicatesResult = {
	hasDuplicates: boolean;
	leadCandidates: DupLeadCandidate[];
	matterCandidates: DupMatterCandidate[];
};

const NAME_THRESHOLD = 0.85;

/** Digits-only phone normalization (last 10 significant digits). */
function normPhone(phone?: string): string | undefined {
	if (!phone) {
		return undefined;
	}
	const digits = phone.replace(/\D/g, '');
	return digits.length >= 10 ? digits.slice(-10) : digits || undefined;
}

function normEmail(email?: string): string | undefined {
	return email?.trim().toLowerCase() || undefined;
}

function leadName(lead: Pick<ILead, 'contact'>): string {
	const c = lead.contact ?? {};
	return c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}

function leadStatusLabel(l: ILead): string {
	if (l.convertedAt || l.convertedMatterId) {
		return 'converted';
	}
	if (l.lostAt) {
		return 'lost';
	}
	return 'open';
}

/**
 * Find possible duplicates / link candidates for a lead. `lead` may be a not-yet-
 * persisted candidate (only contact fields needed) or an existing lead — when it
 * carries an `_id` we exclude it from its own match set.
 */
export async function checkDuplicates(uid: string, lead: Pick<ILead, 'contact'> & Partial<ILead>): Promise<CheckDuplicatesResult> {
	const phone = normPhone(lead.contact?.phone ?? lead.contact?.mobile);
	const email = normEmail(lead.contact?.email);
	const name = leadName(lead);
	const selfId = lead._id;

	// Confine both sweeps below to boards the caller's firm can reach. They used to
	// run across the whole database, so one firm could probe another's client list
	// by phone, email or name and read back the match's name, refNo and status.
	const reachable = new Set(await firmScopedBoardIds(uid, 'boards.leads.checkDuplicates'));
	const outOfScope = (other: Pick<ILead, 'boardId'>): boolean => !other.boardId || !reachable.has(other.boardId);

	// ----- 1. existing boards_leads on phone OR email (exact), then refine by name.
	const leadCandidates: DupLeadCandidate[] = [];
	const seenLeadIds = new Set<string>();

	if (phone || email) {
		const byContact = await BoardsLeads.findByPhoneOrEmail(
			lead.contact?.phone ?? lead.contact?.mobile,
			lead.contact?.email,
		).toArray();
		for (const other of byContact) {
			if (other._id === selfId || seenLeadIds.has(other._id) || outOfScope(other)) {
				continue;
			}
			seenLeadIds.add(other._id);
			const matchedOn: DupMatchField[] = [];
			if (phone && (normPhone(other.contact?.phone) === phone || normPhone(other.contact?.mobile) === phone)) {
				matchedOn.push('phone');
			}
			if (email && normEmail(other.contact?.email) === email) {
				matchedOn.push('email');
			}
			const nameSim = name ? nameSimilarity(name, leadName(other)) : 0;
			if (nameSim >= NAME_THRESHOLD) {
				matchedOn.push('name');
			}
			if (matchedOn.length) {
				leadCandidates.push({
					kind: 'lead',
					leadId: other._id,
					refNo: other.refNo,
					name: leadName(other) || undefined,
					status: leadStatusLabel(other),
					matchedOn,
					confidence: matchedOn.includes('phone') || matchedOn.includes('email') ? 0.95 : nameSim,
				});
			}
		}
	}

	// fuzzy name-only sweep across open leads (catches typo'd / missing contact).
	if (name && normalizeName(name)) {
		const openLeads = await BoardsLeads.find({ archived: { $ne: true }, boardId: { $in: [...reachable] } }).toArray();
		for (const other of openLeads) {
			if (other._id === selfId || seenLeadIds.has(other._id)) {
				continue;
			}
			const sim = nameSimilarity(name, leadName(other));
			if (sim >= NAME_THRESHOLD) {
				seenLeadIds.add(other._id);
				leadCandidates.push({
					kind: 'lead',
					leadId: other._id,
					refNo: other.refNo,
					name: leadName(other) || undefined,
					status: leadStatusLabel(other),
					matchedOn: ['name'],
					confidence: sim,
				});
			}
		}
	}

	// ----- 2. existing CasePro matters by client name (best-effort, name-only).
	const matterCandidates: DupMatterCandidate[] = [];
	if (name && normalizeName(name)) {
		try {
			// shared, short-TTL memo: reuses the conflict check's fan-out on the same card
			// open instead of issuing a second ~200-read sweep against CasePro.
			const snapshots = await getMattersSnapshots();
			for (const snap of snapshots) {
				if (!snap?.clientName) {
					continue;
				}
				const sim = nameSimilarity(name, snap.clientName);
				if (sim >= NAME_THRESHOLD) {
					matterCandidates.push({
						kind: 'matter',
						matterId: snap.matterId,
						...(snap.matterName ? { matterName: snap.matterName } : {}),
						clientName: snap.clientName,
						matchedOn: ['name'],
						confidence: sim,
					});
				}
			}
		} catch {
			// CasePro unreachable — omit matter candidates, keep the lead ones.
		}
	}

	leadCandidates.sort((a, b) => b.confidence - a.confidence);
	matterCandidates.sort((a, b) => b.confidence - a.confidence);

	return {
		hasDuplicates: leadCandidates.length > 0 || matterCandidates.length > 0,
		leadCandidates,
		matterCandidates,
	};
}
