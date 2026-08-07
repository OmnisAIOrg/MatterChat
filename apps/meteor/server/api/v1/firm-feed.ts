import type { IFirmFeedEntry } from '@rocket.chat/core-typings';
import {
	ajv,
	isFirmFeedListProps,
	isFirmFeedCreateProps,
	isFirmFeedUpdateProps,
	isFirmFeedDeleteProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';
import { Meteor } from 'meteor/meteor';

import { FirmFeed } from '../../models/FirmFeed';
// MATTERCHAT: self-serve firms — scope the bulletin to the caller's firm.
import { getFirmScopeExtraQuery } from '../../lib/firms/firmsService';
import { hasPermissionAsync } from '../../lib/authorization/hasPermission';
import { API } from '../api';

/**
 * REST surface for the MatterChat Firm Feed — the admin-managed My Day bulletin.
 *
 *  GET  firm-feed.list    — any authenticated user; active entries, pinned/newest first,
 *                           birthdays ordered by upcoming anniversary.
 *  POST firm-feed.create  — gated by `firm-feed-manage`.
 *  POST firm-feed.update  — gated by `firm-feed-manage`.
 *  POST firm-feed.delete  — gated by `firm-feed-manage` (soft-delete).
 *
 * Mirrors the Boards REST idioms exactly: `this.userId` (not requireUid — Meteor.userId()
 * is unavailable in this REST context), inline ajv success schemas, permission checks on
 * the SERVER (the client only hides the controls). Manage-permission is enforced here so
 * the endpoints are safe even if the UI gate is bypassed.
 */

const MANAGE_PERMISSION = 'firm-feed-manage';

/**
 * MATTERCHAT: the caller's firm cohort for feed scoping.
 *  - `undefined` → no scoping at all (self-serve firms off, scoping off, or caller is an
 *                  admin): the full workspace feed, i.e. stock behaviour.
 *  - `string`    → that firm's entries plus workspace-wide ones.
 *  - `null`      → unstamped cohort: workspace-wide entries only.
 */
const getCallerFirmId = async (userId: string | null): Promise<string | null | undefined> => {
	const scope = await getFirmScopeExtraQuery(userId);
	if (!scope) {
		return undefined;
	}
	const cond = (scope as Record<string, unknown>)['customFields.firmId'];
	return typeof cond === 'string' ? cond : null;
};

const PERMISSIVE_SUCCESS = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

const parseEventDate = (raw?: string): Date | undefined => {
	if (!raw) {
		return undefined;
	}
	const d = new Date(raw);
	return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Days until the next occurrence of an event's month/day (birthday-style, year-agnostic). */
const daysUntilAnniversary = (eventDate?: Date): number => {
	if (!eventDate) {
		return Number.POSITIVE_INFINITY;
	}
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	let next = new Date(now.getFullYear(), eventDate.getMonth(), eventDate.getDate());
	if (next.getTime() < today.getTime()) {
		next = new Date(now.getFullYear() + 1, eventDate.getMonth(), eventDate.getDate());
	}
	return Math.round((next.getTime() - today.getTime()) / 86400000);
};

/**
 * Order the feed: birthdays by upcoming anniversary (soonest first), everything else
 * pinned-then-newest (the model already sorts pinned desc / createdAt desc). The client
 * buckets by `kind`, so this only needs to be sane within each kind.
 */
const orderEntries = (entries: IFirmFeedEntry[]): IFirmFeedEntry[] => {
	const birthdays = entries
		.filter((e) => e.kind === 'birthday')
		.sort((a, b) => daysUntilAnniversary(a.eventDate) - daysUntilAnniversary(b.eventDate));
	const others = entries.filter((e) => e.kind !== 'birthday');
	return [...others, ...birthdays];
};

API.v1.get(
	'firm-feed.list',
	{
		authRequired: true,
		query: isFirmFeedListProps,
		response: {
			200: PERMISSIVE_SUCCESS,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		// Any authenticated user may read the feed — no manage permission required.
		// MATTERCHAT: self-serve firms — the feed is workspace-global by default, which would
		// show one firm's birthdays, shout-outs and announcements to every other firm. Scope
		// it to the caller's own firm plus workspace-wide (unstamped) entries. Admins and the
		// feature-off case fall through to the unscoped listing.
		const firmId = await getCallerFirmId(this.userId);
		const entries = await (firmId === undefined ? FirmFeed.findActive() : FirmFeed.findActiveForFirm(firmId)).toArray();
		return API.v1.success({ entries: orderEntries(entries) });
	},
);

API.v1.post(
	'firm-feed.create',
	{
		authRequired: true,
		body: isFirmFeedCreateProps,
		response: {
			200: PERMISSIVE_SUCCESS,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId; // authRequired guarantees presence
		if (!(await hasPermissionAsync(uid, MANAGE_PERMISSION))) {
			return API.v1.unauthorized();
		}

		const { kind, title, body, eventDate, pinned } = this.bodyParams;
		// MATTERCHAT: stamp the author's firm so the entry stays inside it. A workspace admin
		// (no firm cohort → undefined) posts workspace-wide, which is the intended behaviour.
		const authorFirmId = await getCallerFirmId(uid);
		const entry = await FirmFeed.create({
			kind,
			title: title.trim(),
			...(body !== undefined ? { body } : {}),
			...(parseEventDate(eventDate) ? { eventDate: parseEventDate(eventDate) } : {}),
			...(pinned !== undefined ? { pinned } : {}),
			createdBy: { _id: uid, username: this.user.username, name: this.user.name },
			...(authorFirmId ? { firmId: authorFirmId } : {}),
		});

		return API.v1.success({ entry });
	},
);

API.v1.post(
	'firm-feed.update',
	{
		authRequired: true,
		body: isFirmFeedUpdateProps,
		response: {
			200: PERMISSIVE_SUCCESS,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, MANAGE_PERMISSION))) {
			return API.v1.unauthorized();
		}

		const { entryId, kind, title, body, eventDate, pinned } = this.bodyParams;

		const existing = await FirmFeed.findOneById(entryId);
		if (!existing || existing.active === false) {
			throw new Meteor.Error('error-firm-feed-entry-not-found', 'Firm feed entry not found');
		}

		const entry = await FirmFeed.updateById(entryId, {
			...(kind !== undefined ? { kind } : {}),
			...(title !== undefined ? { title: title.trim() } : {}),
			...(body !== undefined ? { body } : {}),
			// An empty eventDate string clears the date; a present value sets it.
			...(eventDate !== undefined ? { eventDate: eventDate === '' ? null : (parseEventDate(eventDate) ?? null) } : {}),
			...(pinned !== undefined ? { pinned } : {}),
		});

		return API.v1.success({ entry });
	},
);

API.v1.post(
	'firm-feed.delete',
	{
		authRequired: true,
		body: isFirmFeedDeleteProps,
		response: {
			200: PERMISSIVE_SUCCESS,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId;
		if (!(await hasPermissionAsync(uid, MANAGE_PERMISSION))) {
			return API.v1.unauthorized();
		}

		const { entryId } = this.bodyParams;
		const ok = await FirmFeed.softDeleteById(entryId);
		if (!ok) {
			throw new Meteor.Error('error-firm-feed-entry-not-found', 'Firm feed entry not found');
		}

		return API.v1.success({ success: true });
	},
);
