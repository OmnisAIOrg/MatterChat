import { Rooms } from '@rocket.chat/models';

import { API } from '../api';
import { getUploadFormData } from '../lib/getUploadFormData';
import {
	approveAutoDocDocument,
	getAutoDocDocument,
	listAutoDocFeed,
	rejectAutoDocDocument,
	submitAutoDocDocument,
} from '../../lib/autodoc/client';
import { hasPermissionAsync } from '../../lib/authorization/hasPermission';
import { resolveRoomMatter } from '../../lib/omnis/matter';
import { SystemLogger } from '../../lib/logger/system';

/**
 * AutoDoc document-intake REST surface.
 *
 * | Route                    | Permission            |
 * | ------------------------ | --------------------- |
 * | `GET  /v1/autodoc.feed`   | `view-document-queue` |
 * | `GET  /v1/autodoc.document` | `view-document-queue` |
 * | `POST /v1/autodoc.submit` | `submit-documents`    |
 * | `POST /v1/autodoc.approve`| `view-document-queue` |
 * | `POST /v1/autodoc.reject` | `view-document-queue` |
 *
 * The submit/view split is the shared permission model: anyone may drop a
 * document, but the queue is firm-wide so seeing it exposes every document in
 * the firm.
 */

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

API.v1.addRoute(
	'autodoc.feed',
	{ authRequired: true, permissionsRequired: ['view-document-queue'] },
	{
		async get() {
			return API.v1.success(await listAutoDocFeed());
		},
	},
);

API.v1.addRoute(
	'autodoc.document',
	{ authRequired: true, permissionsRequired: ['view-document-queue'] },
	{
		async get() {
			const { documentId } = this.queryParams as { documentId?: string };
			if (!documentId) {
				return API.v1.failure('documentId is required');
			}
			const document = await getAutoDocDocument(documentId);
			if (!document) {
				return API.v1.notFound();
			}
			return API.v1.success({ document });
		},
	},
);

API.v1.addRoute(
	'autodoc.submit',
	{
		authRequired: true,
		permissionsRequired: ['submit-documents'],
		rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 },
	},
	{
		async post() {
			const { fileBuffer, filename, mimetype, fields } = await getUploadFormData(
				{ request: this.request },
				{ field: 'file', sizeLimit: MAX_UPLOAD_BYTES },
			);

			// `roomId` binds the matter. This is the whole point of dropping in a
			// channel: AutoDoc never has to guess, so a high-confidence extraction
			// becomes a one-click approve instead of a review task. We resolve the
			// matter from the ROOM rather than trusting a client-supplied matterId.
			const roomId = typeof fields.roomId === 'string' ? fields.roomId : undefined;
			const matter = roomId ? await resolveRoomMatter(roomId) : null;

			const document = await submitAutoDocDocument({
				filename,
				contentType: mimetype,
				content: fileBuffer,
				...(matter ? { matterId: matter.matterId } : {}),
				...(roomId ? { roomId } : {}),
				submittedBy: this.userId,
			});

			return API.v1.success({
				document,
				// Echoed so the client can say "Files are read and filed to <matter>"
				// rather than a generic confirmation.
				...(matter ? { matter: { matterId: matter.matterId, matterName: matter.matterName } } : {}),
			});
		},
	},
);

API.v1.addRoute(
	'autodoc.approve',
	{ authRequired: true, permissionsRequired: ['view-document-queue'] },
	{
		async post() {
			const { documentId, matterId, corrections, roomId } = this.bodyParams as {
				documentId?: string;
				matterId?: string;
				corrections?: { name: string; value: string }[];
				roomId?: string;
			};

			if (!documentId) {
				return API.v1.failure('documentId is required');
			}
			// No matter, no filing. The picker exists precisely so this is never
			// guessed server-side.
			if (!matterId) {
				return API.v1.failure('matterId is required — pick the matter this document belongs to');
			}

			try {
				const result = await approveAutoDocDocument({
					documentId,
					matterId,
					...(corrections?.length ? { corrections } : {}),
					...(roomId ? { roomId } : {}),
					uid: this.userId,
				});
				return API.v1.success(result);
			} catch (err) {
				// A write failure must reach the user — a swallowed write is silent
				// data loss. The client falls back to opening the document for review.
				SystemLogger.warn({ msg: 'AutoDoc approve failed', documentId, err });
				return API.v1.failure(err instanceof Error ? err.message : 'Approve failed');
			}
		},
	},
);

API.v1.addRoute(
	'autodoc.reject',
	{ authRequired: true, permissionsRequired: ['view-document-queue'] },
	{
		async post() {
			const { documentId, reason } = this.bodyParams as { documentId?: string; reason?: string };
			if (!documentId) {
				return API.v1.failure('documentId is required');
			}
			try {
				await rejectAutoDocDocument(documentId, reason);
				return API.v1.success();
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Reject failed');
			}
		},
	},
);

/**
 * Per-channel auto-processing toggle. Deliberately NOT part of the AutoDoc
 * settings group: it is a property of one channel, set by someone who can
 * already submit documents there, and only meaningful on a matter-linked room.
 */
API.v1.addRoute(
	'autodoc.setAutoProcess',
	{ authRequired: true, permissionsRequired: ['submit-documents'] },
	{
		async post() {
			const { roomId, enabled } = this.bodyParams as { roomId?: string; enabled?: boolean };
			if (!roomId || typeof enabled !== 'boolean') {
				return API.v1.failure('roomId and enabled are required');
			}

			const matter = await resolveRoomMatter(roomId);
			if (!matter) {
				return API.v1.failure('Auto-processing is only available on matter-linked channels');
			}

			if (!(await hasPermissionAsync(this.userId, 'edit-room', roomId))) {
				return API.v1.unauthorized();
			}

			await Rooms.updateOne({ _id: roomId }, { $set: { autodocAutoProcess: enabled } });
			return API.v1.success({ roomId, enabled });
		},
	},
);
