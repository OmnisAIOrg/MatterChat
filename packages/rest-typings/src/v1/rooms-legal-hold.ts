import { ajvQuery, ajv } from './Ajv';

/**
 * REST validators + endpoint types for the LEGAL HOLD admin surface (litigation hold).
 *
 * `rooms.legalHold`      — read a room's hold state (GET).
 * `rooms.setLegalHold`   — place a hold on a room (POST; optional caseId/reason).
 * `rooms.clearLegalHold` — release the hold (POST).
 *
 * Enforcement already exists on staging: the retention pruner skips rooms with
 * `retention.legalHold.enabled` (cronPruneMessages.ts) and manual purge/erase paths refuse held
 * rooms. These endpoints are the missing control surface; all three are gated server-side by the
 * `manage-legal-hold` permission (admin by default). Every set/clear is written to the audit
 * trail (`room.legalHold.changed` in `server_events`).
 */

// ---------------------------------------------------------------------------
// Wire shape of a room's hold state (Dates serialize to ISO strings).
// ---------------------------------------------------------------------------

export type LegalHoldStateDTO = {
	enabled: boolean;
	setAt?: string;
	setBy?: { _id: string; username?: string };
	caseId?: string;
	reason?: string;
};

// ---------------------------------------------------------------------------
// GET — read hold state
// ---------------------------------------------------------------------------

type RoomsLegalHoldGetProps = { roomId: string };

const RoomsLegalHoldGetSchema = {
	type: 'object',
	properties: { roomId: { type: 'string', minLength: 1 } },
	required: ['roomId'],
	additionalProperties: false,
};

export const isRoomsLegalHoldGetProps = ajvQuery.compile<RoomsLegalHoldGetProps>(RoomsLegalHoldGetSchema);

// ---------------------------------------------------------------------------
// POST — set
// ---------------------------------------------------------------------------

type RoomsSetLegalHoldProps = { roomId: string; caseId?: string; reason?: string };

const RoomsSetLegalHoldSchema = {
	type: 'object',
	properties: {
		roomId: { type: 'string', minLength: 1 },
		caseId: { type: 'string', nullable: true, maxLength: 256 },
		reason: { type: 'string', nullable: true, maxLength: 2000 },
	},
	required: ['roomId'],
	additionalProperties: false,
};

export const isRoomsSetLegalHoldProps = ajv.compile<RoomsSetLegalHoldProps>(RoomsSetLegalHoldSchema);

// ---------------------------------------------------------------------------
// POST — clear
// ---------------------------------------------------------------------------

type RoomsClearLegalHoldProps = { roomId: string };

const RoomsClearLegalHoldSchema = {
	type: 'object',
	properties: { roomId: { type: 'string', minLength: 1 } },
	required: ['roomId'],
	additionalProperties: false,
};

export const isRoomsClearLegalHoldProps = ajv.compile<RoomsClearLegalHoldProps>(RoomsClearLegalHoldSchema);

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type RoomsLegalHoldEndpoints = {
	'/v1/rooms.legalHold': {
		GET: (params: RoomsLegalHoldGetProps) => { legalHold: LegalHoldStateDTO };
	};
	'/v1/rooms.setLegalHold': {
		POST: (params: RoomsSetLegalHoldProps) => { legalHold: LegalHoldStateDTO };
	};
	'/v1/rooms.clearLegalHold': {
		POST: (params: RoomsClearLegalHoldProps) => { legalHold: LegalHoldStateDTO };
	};
};
