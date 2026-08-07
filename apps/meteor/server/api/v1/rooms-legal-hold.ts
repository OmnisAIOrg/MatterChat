import { Rooms } from '@rocket.chat/models';
import {
	ajv,
	isRoomsLegalHoldGetProps,
	isRoomsSetLegalHoldProps,
	isRoomsClearLegalHoldProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
	validateForbiddenErrorResponse,
} from '@rocket.chat/rest-typings';

import { API } from '../api';
import { getLegalHoldState, setRoomLegalHold, clearRoomLegalHold } from '../../lib/rooms/legalHold';

/**
 * LEGAL HOLD admin control surface (litigation hold).
 *
 * `rooms.legalHold` (GET)       — read a room's hold state.
 * `rooms.setLegalHold` (POST)   — place a hold (optional caseId/reason).
 * `rooms.clearLegalHold` (POST) — release the hold.
 *
 * All three are gated by the `manage-legal-hold` permission (admin by default) via
 * `permissionsRequired` — deliberately NOT a room-membership check: holds are a workspace
 * compliance action set from the admin area, possibly on rooms the admin is not a member of.
 * Enforcement (pruner skip + manual-purge/erase refusal) lives elsewhere and is not altered here;
 * every set/clear is itself audited to `server_events` as `room.legalHold.changed`.
 * Permissive success schema mirrors boards-*.ts.
 */

const legalHoldSuccessSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

API.v1.get(
	'rooms.legalHold',
	{
		authRequired: true,
		permissionsRequired: ['manage-legal-hold'],
		query: isRoomsLegalHoldGetProps,
		response: {
			200: legalHoldSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const room = await Rooms.findOneById(this.queryParams.roomId, { projection: { retention: 1 } });
		if (!room) {
			return API.v1.failure('error-invalid-room');
		}

		return API.v1.success({ legalHold: getLegalHoldState(room) });
	},
);

API.v1.post(
	'rooms.setLegalHold',
	{
		authRequired: true,
		permissionsRequired: ['manage-legal-hold'],
		body: isRoomsSetLegalHoldProps,
		response: {
			200: legalHoldSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { roomId, caseId, reason } = this.bodyParams;

		const room = await Rooms.findOneById(roomId, { projection: { name: 1, fname: 1 } });
		if (!room) {
			return API.v1.failure('error-invalid-room');
		}

		const legalHold = await setRoomLegalHold(this.userId, room, { caseId, reason });

		return API.v1.success({ legalHold });
	},
);

API.v1.post(
	'rooms.clearLegalHold',
	{
		authRequired: true,
		permissionsRequired: ['manage-legal-hold'],
		body: isRoomsClearLegalHoldProps,
		response: {
			200: legalHoldSuccessSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { roomId } = this.bodyParams;

		const room = await Rooms.findOneById(roomId, { projection: { name: 1, fname: 1 } });
		if (!room) {
			return API.v1.failure('error-invalid-room');
		}

		const legalHold = await clearRoomLegalHold(this.userId, room);

		return API.v1.success({ legalHold });
	},
);
