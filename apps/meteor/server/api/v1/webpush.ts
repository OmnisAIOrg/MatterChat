import { ajv, validateBadRequestErrorResponse, validateUnauthorizedErrorResponse } from '@rocket.chat/rest-typings';

import { getWebPushPublicKey, isWebPushConfigured } from '../../../app/web-push/server/send';
import { saveSubscription, removeSubscription } from '../../../app/web-push/server/subscriptions';
import { API } from '../api';

/**
 * MatterChat Web Push (browser/PWA) REST surface — see MATTERCHAT-DESKTOP-PWA-SPEC.md B.4.
 *
 *   GET  webpush.config       — VAPID public key + whether push is configured (auth not required)
 *   POST webpush.subscribe    — store this browser's Push API subscription for the caller
 *   POST webpush.unsubscribe  — drop a subscription (e.g. user revoked permission)
 *
 * Subscriptions are PER-USER (keyed on `this.userId`); the store upserts on the
 * endpoint URL so re-subscribing the same browser never duplicates. Schemas are
 * compiled inline to keep this feature self-contained (no shared rest-typings edits).
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

const configResponseSchema = ajv.compile<{ publicKey: string; configured: boolean }>({
	type: 'object',
	properties: {
		publicKey: { type: 'string' },
		configured: { type: 'boolean' },
	},
	required: ['publicKey', 'configured'],
	additionalProperties: true,
});

const subscribeSchema = ajv.compile<{
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}>({
	type: 'object',
	properties: {
		subscription: {
			type: 'object',
			properties: {
				endpoint: { type: 'string', minLength: 1 },
				keys: {
					type: 'object',
					properties: {
						p256dh: { type: 'string', minLength: 1 },
						auth: { type: 'string', minLength: 1 },
					},
					required: ['p256dh', 'auth'],
					additionalProperties: true,
				},
			},
			required: ['endpoint', 'keys'],
			additionalProperties: true,
		},
	},
	required: ['subscription'],
	additionalProperties: false,
});

const unsubscribeSchema = ajv.compile<{ endpoint: string }>({
	type: 'object',
	properties: { endpoint: { type: 'string', minLength: 1 } },
	required: ['endpoint'],
	additionalProperties: false,
});

API.v1.get(
	'webpush.config',
	{
		authRequired: false,
		response: {
			200: configResponseSchema,
		},
	},
	async function action() {
		return API.v1.success({
			publicKey: getWebPushPublicKey(),
			configured: isWebPushConfigured(),
		});
	},
);

API.v1.post(
	'webpush.subscribe',
	{
		authRequired: true,
		body: subscribeSchema,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { subscription } = this.bodyParams;
		const ua = this.request.headers.get('user-agent') ?? undefined;
		await saveSubscription(this.userId, subscription, ua);
		return API.v1.success({ success: true });
	},
);

API.v1.post(
	'webpush.unsubscribe',
	{
		authRequired: true,
		body: unsubscribeSchema,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		await removeSubscription(this.userId, this.bodyParams.endpoint);
		return API.v1.success({ success: true });
	},
);
