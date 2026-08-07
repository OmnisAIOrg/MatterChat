import { API } from '../api';
import { omnisCtx } from './omnisApiContext';
import { getUploadFormData } from '../lib/getUploadFormData';
import { resolveLitboxLinksConfig } from '../../lib/litbox-links/config';
import { createLink, describeLink, listLinks, revokeLink, sanitizeFilename, uploadThroughLink } from '../../lib/litbox-links/client';
import { findUploadLinkById } from '../../lib/litbox-links/store';
import { litboxUploadTransport } from '../../lib/litbox-links/transport';
import { listMatterFiles } from '../../lib/litbox-links/files';
import { resolveRoomMatter } from '../../lib/omnis/matter';
import { postOmnisNote } from '../../lib/omnis/receipt';
import { SystemLogger } from '../../lib/logger/system';

/**
 * LitBox matter files + upload links.
 *
 * | Route                          | Auth                        |
 * | ------------------------------ | --------------------------- |
 * | `GET  /v1/litbox.matterFiles`  | `litbox-view-matter-files`  |
 * | `POST /v1/litbox.createUploadLink` | `litbox-create-upload-link` |
 * | `GET  /v1/litbox.uploadLinks`  | `litbox-create-upload-link` |
 * | `POST /v1/litbox.revokeUploadLink` | `litbox-create-upload-link` |
 * | `POST /v1/litbox.publicLinkInfo`   | **none** (tokenised)    |
 * | `POST /v1/litbox.publicUpload`     | **none** (tokenised)    |
 *
 * The two public routes are the only unauthenticated write surface in this
 * feature. Both take the token from the request and re-check expiry, revocation
 * and caps server-side on every call; neither can list or read anything already
 * in the workspace.
 */

/**
 * Per-token rate limit, on top of the route-level limiter.
 *
 * The route limiter keys on IP, which is the wrong axis here: a link handed to
 * one client should not be exhaustible by an unrelated visitor behind the same
 * NAT, and conversely a single token being hammered from many IPs is exactly
 * the abuse case. Small in-memory window; the hard total-file cap in the store
 * is the real ceiling.
 */
const TOKEN_WINDOW_MS = 60_000;
const TOKEN_MAX_REQUESTS = 20;
const tokenHits = new Map<string, { count: number; resetAt: number }>();

function tokenRateLimited(token: string): boolean {
	const now = Date.now();
	const entry = tokenHits.get(token);
	if (!entry || entry.resetAt <= now) {
		tokenHits.set(token, { count: 1, resetAt: now + TOKEN_WINDOW_MS });
		return false;
	}
	entry.count += 1;
	return entry.count > TOKEN_MAX_REQUESTS;
}

// Keep the map from growing without bound on a busy workspace.
setInterval(() => {
	const now = Date.now();
	for (const [token, entry] of tokenHits) {
		if (entry.resetAt <= now) {
			tokenHits.delete(token);
		}
	}
}, TOKEN_WINDOW_MS).unref?.();

API.v1.addRoute(
	'litbox.matterFiles',
	{ authRequired: true, permissionsRequired: ['litbox-view-matter-files'] },
	{
		async get() {
			const { roomId, workspaceId } = omnisCtx(this).queryParams as { roomId?: string; workspaceId?: string };

			// Scope follows the shared context rule: in a matter channel the widget
			// shows that matter's workspace; elsewhere, the user's own LitBox.
			const matter = roomId ? await resolveRoomMatter(roomId) : null;
			const feed = await listMatterFiles(omnisCtx(this).userId, workspaceId ? { workspaceId } : {});

			return API.v1.success({ ...feed, scope: matter ? { matterId: matter.matterId, matterName: matter.matterName } : null });
		},
	},
);

/**
 * Drop-to-upload on the widget: the file lands in the current matter's LitBox
 * workspace and is announced in the channel.
 *
 * This is the OTHER direction from `litbox.matterFiles` — bytes genuinely
 * originate in the browser here, so an upload is correct. Attaching an existing
 * matter file to a message is a reference operation and must never come through
 * this route.
 */
API.v1.addRoute(
	'litbox.matterUpload',
	{
		authRequired: true,
		permissionsRequired: ['litbox-view-matter-files'],
		rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 },
	},
	{
		async post() {
			const cfg = resolveLitboxLinksConfig();
			const { fileBuffer, filename, mimetype, fields } = await getUploadFormData(
				{ request: omnisCtx(this).request },
				{ field: 'file', sizeLimit: cfg.maxFileBytes },
			);

			const roomId = typeof fields.roomId === 'string' ? fields.roomId : undefined;
			const matter = roomId ? await resolveRoomMatter(roomId) : null;

			try {
				const uploaded = await litboxUploadTransport(cfg).upload({
					filename: sanitizeFilename(filename),
					contentType: mimetype,
					content: fileBuffer,
					folder: matter ? 'Matter documents' : undefined,
					uploadedByLabel: omnisCtx(this).user?.username,
				});

				if (roomId) {
					await postOmnisNote(
						roomId,
						omnisCtx(this).userId,
						`📎 Uploaded \`${sanitizeFilename(filename)}\`${matter ? ` to **${matter.matterName}**` : ''} in LitBox.`,
					);
				}

				return API.v1.success({ documentId: uploaded.documentId, name: uploaded.name });
			} catch (err) {
				SystemLogger.warn({ msg: 'LitBox matter upload failed', err });
				return API.v1.failure(err instanceof Error ? err.message : 'Upload failed');
			}
		},
	},
);

API.v1.addRoute(
	'litbox.createUploadLink',
	{ authRequired: true, permissionsRequired: ['litbox-create-upload-link'] },
	{
		async post() {
			const { username } = omnisCtx(this).user ?? {};
			const body = omnisCtx(this).bodyParams as {
				roomId?: string;
				destination?: 'matter' | 'personal';
				matterId?: string;
				matterName?: string;
				workspaceId?: string;
				recipientLabel?: string;
				requestText?: string;
				notifyOnUpload?: boolean;
				sendToAutoDoc?: boolean;
				password?: string;
				expiryDays?: number;
			};

			// A matter destination is resolved from the ROOM when there is one, so a
			// client cannot name a matter it has no channel for.
			let destination: Parameters<typeof createLink>[0]['destination'];
			if (body.destination === 'personal') {
				destination = { kind: 'personal' };
			} else {
				const fromRoom = body.roomId ? await resolveRoomMatter(body.roomId) : null;
				const matterId = fromRoom?.matterId ?? body.matterId;
				const matterName = fromRoom?.matterName ?? body.matterName;
				if (!matterId || !matterName) {
					return API.v1.failure('A matter is required — pick one, or choose "My LitBox"');
				}
				destination = { kind: 'matter', matterId, matterName, ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}) };
			}

			try {
				const { link, url } = await createLink({
					destination,
					...(body.recipientLabel ? { recipientLabel: body.recipientLabel } : {}),
					...(body.requestText ? { requestText: body.requestText } : {}),
					...(body.roomId ? { notifyRoomId: body.roomId } : {}),
					...(body.notifyOnUpload !== undefined ? { notifyOnUpload: body.notifyOnUpload } : {}),
					...(body.sendToAutoDoc !== undefined ? { sendToAutoDoc: body.sendToAutoDoc } : {}),
					...(body.password ? { password: body.password } : {}),
					...(body.expiryDays !== undefined ? { expiryDays: body.expiryDays } : {}),
					createdBy: { _id: omnisCtx(this).userId, ...(username ? { username } : {}) },
				});

				// `url` carries the ONE-TIME plaintext token; only the hash is stored.
				return API.v1.success({ link: publicLinkShape(link), url });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Could not create the upload link');
			}
		},
	},
);

API.v1.addRoute(
	'litbox.uploadLinks',
	{ authRequired: true, permissionsRequired: ['litbox-create-upload-link'] },
	{
		async get() {
			const { roomId } = omnisCtx(this).queryParams as { roomId?: string };
			const matter = roomId ? await resolveRoomMatter(roomId) : null;
			const links = await listLinks(matter ? { matterId: matter.matterId } : { createdBy: omnisCtx(this).userId });
			return API.v1.success({ links: links.map(publicLinkShape) });
		},
	},
);

API.v1.addRoute(
	'litbox.revokeUploadLink',
	{ authRequired: true, permissionsRequired: ['litbox-create-upload-link'] },
	{
		async post() {
			const { linkId } = omnisCtx(this).bodyParams as { linkId?: string };
			if (!linkId) {
				return API.v1.failure('linkId is required');
			}
			if (!(await findUploadLinkById(linkId))) {
				return API.v1.notFound();
			}
			// Revocation is checked on every subsequent request, so this takes
			// effect immediately rather than at next issue.
			return API.v1.success({ revoked: await revokeLink(linkId) });
		},
	},
);

// ---------------------------------------------------------------------------
// Public (tokenised) — no account, no login, no app install
// ---------------------------------------------------------------------------

API.v1.addRoute(
	'litbox.publicLinkInfo',
	{ authRequired: false, rateLimiterOptions: { numRequestsAllowed: 60, intervalTimeInMS: 60000 } },
	{
		// POST, not GET, purely so the token rides in the body. The upload page
		// keeps it in the URL FRAGMENT (never sent to a server), and a query
		// parameter here would put it straight back into access logs and any
		// Referer header the page emits.
		async post() {
			const { token } = omnisCtx(this).bodyParams as { token?: string };
			if (!token) {
				return API.v1.failure('token is required');
			}
			if (tokenRateLimited(token)) {
				return API.v1.failure('Too many requests');
			}
			if (!resolveLitboxLinksConfig().enabled) {
				return API.v1.failure('Upload links are not enabled');
			}

			const info = await describeLink(token);
			if ('rejected' in info) {
				// Deliberately uniform: a revoked link and a nonexistent one are not
				// distinguished to the caller, so the endpoint is not an oracle for
				// guessing valid tokens.
				return API.v1.success({ valid: false, reason: info.rejected === 'expired' ? 'expired' : 'invalid' });
			}
			return API.v1.success({ valid: true, info });
		},
	},
);

API.v1.addRoute(
	'litbox.publicUpload',
	{ authRequired: false, rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 } },
	{
		async post() {
			if (!resolveLitboxLinksConfig().enabled) {
				return API.v1.failure('Upload links are not enabled');
			}

			const cfg = resolveLitboxLinksConfig();
			const { fileBuffer, filename, fields } = await getUploadFormData(
				{ request: omnisCtx(this).request },
				// A hard ceiling at the parser, before anything is buffered further.
				{ field: 'file', sizeLimit: cfg.maxFileBytes },
			);

			const token = typeof fields.token === 'string' ? fields.token : '';
			const password = typeof fields.password === 'string' ? fields.password : undefined;
			if (!token) {
				return API.v1.failure('token is required');
			}
			if (tokenRateLimited(token)) {
				return API.v1.failure('Too many requests');
			}

			try {
				const result = await uploadThroughLink(token, { filename, content: fileBuffer }, password);
				if ('rejected' in result) {
					return API.v1.success({ uploaded: false, reason: result.rejected });
				}
				return API.v1.success({ uploaded: true, name: result.name });
			} catch (err) {
				SystemLogger.warn({ msg: 'Public upload failed', err });
				return API.v1.failure('Upload failed');
			}
		},
	},
);

/** Never serialise `tokenHash`, `passwordHash` or `passwordSalt` to a client. */
function publicLinkShape(link: Awaited<ReturnType<typeof listLinks>>[number]) {
	return {
		_id: link._id,
		destination: link.destination,
		recipientLabel: link.recipientLabel,
		requestText: link.requestText,
		notifyOnUpload: link.notifyOnUpload,
		sendToAutoDoc: link.sendToAutoDoc,
		requiresPassword: Boolean(link.passwordHash),
		maxFiles: link.maxFiles,
		usedCount: link.usedCount,
		expiresAt: link.expiresAt,
		revokedAt: link.revokedAt,
		createdAt: link.createdAt,
		createdBy: link.createdBy,
		lastUsedAt: link.lastUsedAt,
	};
}
