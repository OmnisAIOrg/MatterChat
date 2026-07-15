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

import { FirmFeed } from '../../../../server/models/FirmFeed';
import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
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
		const entries = await FirmFeed.findActive().toArray();
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
		const entry = await FirmFeed.create({
			kind,
			title: title.trim(),
			...(body !== undefined ? { body } : {}),
			...(parseEventDate(eventDate) ? { eventDate: parseEventDate(eventDate) } : {}),
			...(pinned !== undefined ? { pinned } : {}),
			createdBy: { _id: uid, username: this.user.username, name: this.user.name },
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
