import { API } from '../api';
import { omnisCtx, omnisRawRequest } from './omnisApiContext';
import { previewEsignActions } from '../../lib/omnisproof/automations';
import { handleLifecycleEvent, listSignatureFeed, remindSigner, sendForSignature } from '../../lib/omnisproof/client';
import { resolveOmnisProofConfig } from '../../lib/omnisproof/config';
import { listDocumentTypes } from '../../lib/omnisproof/documentTypes';
import { verifyWebhookSignature } from '../../lib/omnisproof/transport';
import type { LifecycleEvent } from '../../lib/omnisproof/client';
import type { EnvelopeSigner } from '../../lib/omnisproof/store';
import { resolveRoomMatter } from '../../lib/omnis/matter';
import { SystemLogger } from '../../lib/logger/system';

/**
 * OmnisProof signatures.
 *
 * | Route                            | Auth                    |
 * | -------------------------------- | ----------------------- |
 * | `GET  /v1/omnisproof.feed`       | `omnisproof-view-queue` |
 * | `GET  /v1/omnisproof.documentTypes` | `omnisproof-send`    |
 * | `POST /v1/omnisproof.preview`    | `omnisproof-send`       |
 * | `POST /v1/omnisproof.send`       | `omnisproof-send`       |
 * | `POST /v1/omnisproof.remind`     | `omnisproof-send`       |
 * | `POST /v1/omnisproof.webhook`    | **HMAC signature**      |
 */

API.v1.addRoute(
	'omnisproof.feed',
	{ authRequired: true, permissionsRequired: ['omnisproof-view-queue'] },
	{
		async get() {
			const { roomId } = omnisCtx(this).queryParams as { roomId?: string };
			const matter = roomId ? await resolveRoomMatter(roomId) : null;
			return API.v1.success(await listSignatureFeed(matter?.matterId));
		},
	},
);

API.v1.addRoute(
	'omnisproof.documentTypes',
	{ authRequired: true, permissionsRequired: ['omnisproof-send'] },
	{
		async get() {
			const types = await listDocumentTypes();
			return API.v1.success({ types: types.map((t) => ({ key: t.key, label: t.label })) });
		},
	},
);

/**
 * The consequence preview.
 *
 * Server-rendered from the same mapping records the automations will execute,
 * so "what will happen" and "what happened" cannot drift. The `matterName` in
 * the response is the RESOLVED matter, never the open channel.
 */
API.v1.addRoute(
	'omnisproof.preview',
	{ authRequired: true, permissionsRequired: ['omnisproof-send'] },
	{
		async post() {
			const { documentTypeKey, matterId, matterName, roomId } = omnisCtx(this).bodyParams as {
				documentTypeKey?: string;
				matterId?: string;
				matterName?: string;
				roomId?: string;
			};

			const fromRoom = roomId ? await resolveRoomMatter(roomId) : null;
			// A matter chosen in the picker OVERRIDES the room. Preferring the room
			// here is exactly the mockup bug: picking "Duong v. Metro Transit"
			// outside a matter channel still promised to file into "Alvarez v. Diaz".
			const resolvedName = matterId ? (matterName ?? matterId) : fromRoom?.matterName;

			const steps = await previewEsignActions(documentTypeKey, resolvedName);
			return API.v1.success({ steps, matterName: resolvedName ?? null });
		},
	},
);

API.v1.addRoute(
	'omnisproof.send',
	{ authRequired: true, permissionsRequired: ['omnisproof-send'] },
	{
		async post() {
			const { username } = omnisCtx(this).user ?? {};
			const body = omnisCtx(this).bodyParams as {
				documentName?: string;
				documentRef?: string;
				signers?: EnvelopeSigner[];
				isMatterDocument?: boolean;
				matterId?: string;
				documentTypeKey?: string;
				roomId?: string;
				subject?: string;
			};

			if (!body.documentName) {
				return API.v1.failure('documentName is required');
			}
			if (!body.signers?.length) {
				return API.v1.failure('At least one signer is required');
			}

			// The fork: matter document vs General. A General send touches no matter
			// and fires no data entry, so it must be chosen, never defaulted into.
			let matterId: string | undefined;
			if (body.isMatterDocument !== false) {
				const fromRoom = body.roomId ? await resolveRoomMatter(body.roomId) : null;
				matterId = body.matterId ?? fromRoom?.matterId;
				if (!matterId) {
					return API.v1.failure('Pick a matter, or send this as a General document');
				}
				if (!body.documentTypeKey) {
					return API.v1.failure('A document type is required for a matter document');
				}
			}

			try {
				const envelope = await sendForSignature({
					documentName: body.documentName,
					...(body.documentRef ? { documentRef: body.documentRef } : {}),
					signers: body.signers.map((s, index) => ({ ...s, order: s.order ?? index + 1 })),
					...(matterId ? { matterId } : {}),
					...(matterId && body.documentTypeKey ? { documentTypeKey: body.documentTypeKey } : {}),
					...(body.roomId ? { roomId: body.roomId } : {}),
					...(body.subject ? { subject: body.subject } : {}),
					sentBy: { _id: omnisCtx(this).userId, ...(username ? { username } : {}) },
				});

				return API.v1.success({
					envelopeId: envelope.envelopeId,
					signUrl: envelope.signUrl,
					matterName: envelope.matterName ?? null,
				});
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Could not send for signature');
			}
		},
	},
);

API.v1.addRoute(
	'omnisproof.remind',
	{ authRequired: true, permissionsRequired: ['omnisproof-send'] },
	{
		async post() {
			const { envelopeId } = omnisCtx(this).bodyParams as { envelopeId?: string };
			if (!envelopeId) {
				return API.v1.failure('envelopeId is required');
			}
			try {
				await remindSigner(envelopeId);
				return API.v1.success();
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Could not send a reminder');
			}
		},
	},
);

/**
 * Envelope lifecycle callback: sent → viewed → signed → declined → voided.
 *
 * **Unsigned callbacks are hostile.** This endpoint can move a matter's status,
 * set its fee percentage and start its limitations clock, so every delivery
 * must carry a valid HMAC over the raw body. With no secret configured, every
 * delivery is rejected — falling open here would expose case-data writes to
 * anyone who can reach the host.
 *
 * Duplicates return success. Providers retry, and a non-200 just makes them
 * retry harder; idempotency is enforced in `claimCompletion`, not by refusing
 * the request.
 */
API.v1.addRoute(
	'omnisproof.webhook',
	{ authRequired: false, rateLimiterOptions: { numRequestsAllowed: 120, intervalTimeInMS: 60000 } },
	{
		async post() {
			const cfg = resolveOmnisProofConfig();
			if (!cfg.enabled) {
				return API.v1.failure('OmnisProof is not enabled');
			}

			const request = omnisRawRequest(this);
			// Sign over the RAW body: re-serialising the parsed object would change
			// key order and whitespace, and the HMAC would never match.
			const rawBody = request.rawBody ?? JSON.stringify(omnisCtx(this).bodyParams ?? {});
			const signature = request.headers['x-omnisproof-signature'] ?? request.headers['x-signature'];

			if (!verifyWebhookSignature(cfg.webhookSecret, rawBody, signature)) {
				SystemLogger.warn({ msg: 'OmnisProof webhook rejected — bad or missing signature' });
				return API.v1.unauthorized();
			}

			const { envelopeId, event, signedDocRef } = omnisCtx(this).bodyParams as {
				envelopeId?: string;
				event?: string;
				signedDocRef?: string;
			};
			if (!envelopeId || !event) {
				return API.v1.failure('envelopeId and event are required');
			}
			if (!['sent', 'viewed', 'signed', 'declined', 'voided'].includes(event)) {
				// Unknown lifecycle verb: acknowledge so the provider stops retrying,
				// but do nothing.
				return API.v1.success({ ignored: true });
			}

			const result = await handleLifecycleEvent(envelopeId, event as LifecycleEvent, {
				...(signedDocRef ? { signedDocRef } : {}),
			});

			return API.v1.success({ applied: result.applied, duplicate: result.duplicate });
		},
	},
);
