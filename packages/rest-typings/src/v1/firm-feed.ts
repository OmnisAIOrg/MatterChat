import type { IFirmFeedEntry, FirmFeedKind } from '@rocket.chat/core-typings';

import { ajv, ajvQuery } from './Ajv';

/**
 * REST validators + endpoint types for the MatterChat Firm Feed — the admin-managed
 * My Day bulletin (announcements / birthdays / shout-outs).
 *
 * `firm-feed.list`   — any authenticated user; read-only feed.
 * `firm-feed.create` / `.update` / `.delete` — gated server-side by `firm-feed-manage`.
 *
 * Dates cross the wire as ISO strings (`eventDate`); the server parses them to `Date`.
 */

const KIND_ENUM: FirmFeedKind[] = ['announcement', 'birthday', 'shoutout', 'update'];

// ---------------------------------------------------------------------------
// GET /v1/firm-feed.list — no params
// ---------------------------------------------------------------------------

type FirmFeedListProps = Record<string, never>;

const FirmFeedListSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isFirmFeedListProps = ajvQuery.compile<FirmFeedListProps>(FirmFeedListSchema);

// ---------------------------------------------------------------------------
// POST /v1/firm-feed.create
// ---------------------------------------------------------------------------

type FirmFeedCreateProps = {
	kind: FirmFeedKind;
	title: string;
	body?: string;
	eventDate?: string;
	pinned?: boolean;
};

const FirmFeedCreateSchema = {
	type: 'object',
	properties: {
		kind: { type: 'string', enum: KIND_ENUM },
		title: { type: 'string', minLength: 1 },
		body: { type: 'string', nullable: true },
		eventDate: { type: 'string', nullable: true },
		pinned: { type: 'boolean', nullable: true },
	},
	required: ['kind', 'title'],
	additionalProperties: false,
};

export const isFirmFeedCreateProps = ajv.compile<FirmFeedCreateProps>(FirmFeedCreateSchema);

// ---------------------------------------------------------------------------
// POST /v1/firm-feed.update
// ---------------------------------------------------------------------------

type FirmFeedUpdateProps = {
	entryId: string;
	kind?: FirmFeedKind;
	title?: string;
	body?: string;
	/** Empty string clears the date. */
	eventDate?: string;
	pinned?: boolean;
};

const FirmFeedUpdateSchema = {
	type: 'object',
	properties: {
		entryId: { type: 'string', minLength: 1 },
		kind: { type: 'string', enum: KIND_ENUM, nullable: true },
		title: { type: 'string', minLength: 1, nullable: true },
		body: { type: 'string', nullable: true },
		eventDate: { type: 'string', nullable: true },
		pinned: { type: 'boolean', nullable: true },
	},
	required: ['entryId'],
	additionalProperties: false,
};

export const isFirmFeedUpdateProps = ajv.compile<FirmFeedUpdateProps>(FirmFeedUpdateSchema);

// ---------------------------------------------------------------------------
// POST /v1/firm-feed.delete
// ---------------------------------------------------------------------------

type FirmFeedDeleteProps = { entryId: string };

const FirmFeedDeleteSchema = {
	type: 'object',
	properties: { entryId: { type: 'string', minLength: 1 } },
	required: ['entryId'],
	additionalProperties: false,
};

export const isFirmFeedDeleteProps = ajv.compile<FirmFeedDeleteProps>(FirmFeedDeleteSchema);

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type FirmFeedEndpoints = {
	'/v1/firm-feed.list': {
		GET: (params?: FirmFeedListProps) => { entries: IFirmFeedEntry[] };
	};
	'/v1/firm-feed.create': {
		POST: (params: FirmFeedCreateProps) => { entry: IFirmFeedEntry };
	};
	'/v1/firm-feed.update': {
		POST: (params: FirmFeedUpdateProps) => { entry: IFirmFeedEntry };
	};
	'/v1/firm-feed.delete': {
		POST: (params: FirmFeedDeleteProps) => { success: true };
	};
};
