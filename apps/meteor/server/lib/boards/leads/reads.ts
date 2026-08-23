import type { ILead, ICommunication } from '@rocket.chat/core-typings';
import { BoardsLeads, BoardsCommunications } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { firmScopedLeadFilter } from '../firmScope';
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
	} else if (!(await hasPermissionAsync(uid, 'boards-leads-view'))) {
		// A board-less list ran with NO permission check at all and no scope, so any
		// authenticated user could read every firm's leads. Gate it like the rest of
		// the leads surface, then scope it below.
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.list' });
	}

	// `boardId` lists are already confined by getBoardForUser; a board-less list is
	// confined to the boards the caller's firm can reach. In a single-firm workspace
	// that is every board, so the result set is unchanged.
	const scope = filter.boardId ? { boardId: filter.boardId } : await firmScopedLeadFilter(uid, 'boards.leads.list');

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
		...scope,
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
	if (!lead.boardId) {
		// No board means nothing attributes this lead to a firm, and the board check
		// below used to be skipped entirely — handing the lead to any authenticated
		// caller. Refuse instead; every lead createLead writes carries a boardId.
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.get' });
	}
	await getBoardForUser(lead.boardId, uid, 'boards.leads.get');
	const communications = await BoardsCommunications.findByLead(leadId).toArray();
	return { lead, communications };
}
