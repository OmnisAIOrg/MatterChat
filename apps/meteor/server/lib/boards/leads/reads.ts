import type { ILead, ICommunication } from '@rocket.chat/core-typings';
import { BoardsLeads, BoardsCommunications } from '@rocket.chat/models';

import { getBoardForUser } from '../permissions';

/**
 * Read helpers for the Leads REST surface. List enforces board visibility (when
 * a boardId is supplied) and supports status/owner/text narrowing; get returns
 * the lead plus its communication timeline.
 */

type Paging = { offset: number; count: number };

export type ListLeadsFilter = { boardId?: string; statusId?: string; ownerId?: string; q?: string };

export async function listLeads(uid: string, filter: ListLeadsFilter, paging: Paging): Promise<{ leads: ILead[]; total: number }> {
	if (filter.boardId) {
		await getBoardForUser(filter.boardId, uid, 'boards.leads.list');
	}

	// pick the narrowest model finder available, then refine in JS
	let cursor;
	if (filter.statusId) {
		cursor = BoardsLeads.findByStatus(filter.statusId);
	} else if (filter.ownerId) {
		cursor = BoardsLeads.findByOwner(filter.ownerId);
	} else if (filter.boardId) {
		cursor = BoardsLeads.findByBoard(filter.boardId);
	} else {
		cursor = BoardsLeads.find({ archived: { $ne: true } });
	}

	let leads = await cursor.toArray();
	if (filter.boardId) {
		leads = leads.filter((l) => l.boardId === filter.boardId);
	}
	if (filter.ownerId) {
		leads = leads.filter((l) => l.ownership?.ownerId === filter.ownerId);
	}
	if (filter.q) {
		const q = filter.q.toLowerCase();
		leads = leads.filter((l) => {
			const c = l.contact ?? {};
			const hay = [c.fullName, c.firstName, c.lastName, c.phone, c.mobile, c.email, String(l.refNo)]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return hay.includes(q);
		});
	}

	const total = leads.length;
	const page = leads.slice(paging.offset, paging.offset + (paging.count || total));
	return { leads: page, total };
}

export async function getLeadInfo(uid: string, leadId: string): Promise<{ lead: ILead; communications: ICommunication[] }> {
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Error('error-lead-not-found');
	}
	if (lead.boardId) {
		await getBoardForUser(lead.boardId, uid, 'boards.leads.get');
	}
	const communications = await BoardsCommunications.findByLead(leadId).toArray();
	return { lead, communications };
}
