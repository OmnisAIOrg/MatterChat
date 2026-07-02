import type { ILead, ICommunication } from '@rocket.chat/core-typings';
import { BoardsLeads, BoardsCommunications } from '@rocket.chat/models';
import type { Filter } from 'mongodb';

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

	// One Mongo query composes every narrowing filter (the model finders' own
	// predicates + the JS refinements this used to do), and the page + total come
	// from findPaginated (skip/limit + countDocuments) — the server never
	// materializes the whole leads collection in memory anymore. The route always
	// resolves offset/count via getPaginationItems, so the historical no-params
	// behavior (a default-sized page) is now enforced by the query's `limit`
	// instead of a post-toArray slice.
	//
	// `q` text match: case-insensitive escaped-regex per contact field (fullName /
	// firstName / lastName / phone / mobile / email) plus the stringified refNo
	// via $expr — the same fields the old JS haystack covered. (The old code
	// joined the fields into one string, so a query could in principle straddle a
	// field boundary; per-field matching drops that accident.)
	const q = (filter.q ?? '').trim();
	const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined;
	const query = {
		archived: { $ne: true },
		...(filter.boardId ? { boardId: filter.boardId } : {}),
		...(filter.statusId ? { statusId: filter.statusId } : {}),
		...(filter.ownerId ? { 'ownership.ownerId': filter.ownerId } : {}),
		...(rx
			? {
					$or: [
						{ 'contact.fullName': rx },
						{ 'contact.firstName': rx },
						{ 'contact.lastName': rx },
						{ 'contact.phone': rx },
						{ 'contact.mobile': rx },
						{ 'contact.email': rx },
						// refNo is a number; match its decimal string form like the old String(l.refNo)
						{ $expr: { $regexMatch: { input: { $toString: { $ifNull: ['$refNo', ''] } }, regex: rx.source, options: 'i' } } },
					],
				}
			: {}),
	} as unknown as Filter<ILead>;

	const { cursor, totalCount } = BoardsLeads.findPaginated(query, {
		// newest-captured first (the explicit sort the statusId finder always had),
		// _id as tie-break so pages never skip/repeat rows
		sort: { capturedAt: -1, _id: -1 },
		skip: paging.offset,
		limit: paging.count || 0,
	});
	const [leads, total] = await Promise.all([cursor.toArray(), totalCount]);
	return { leads, total };
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
