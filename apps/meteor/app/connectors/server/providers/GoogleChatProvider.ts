/**
 * GoogleChatProvider — Google Chat REST implementation of IChatProvider.
 *
 * GREENFIELD on the Google Chat API; clean-room from the Google docs — nothing under
 * apps/meteor/ee/ was read or copied. Mirrors TeamsProvider, but Google Chat is SIMPLER: a space's
 * resource name (`spaces/{id}`) IS the channel id, so there is NO composite encode/decode — the
 * `externalId` is passed straight through to `GET/POST /v1/{space}/messages`.
 *
 * WHAT IS REAL:
 *   - connect            → completes the OAuth auth-code + PKCE exchange (the same exchange the
 *                          /_google/oauth/callback route runs) and returns usable credentials.
 *                          DELEGATED scopes; acts AS the signed-in user.
 *   - verifyCredentials  → lists spaces (cheapest authenticated call) to confirm the token works.
 *   - listChannels       → GET /v1/spaces (paged via nextPageToken), each space mapped to
 *                          IProviderChannel { externalId: space.name, name, isPrivate }.
 *   - syncMessages       → GET /v1/{space}/messages?pageSize=50 (paged), each mapped to
 *                          IProviderMessage (author from sender.displayName, text, createdAt).
 *   - postMessage        → POST /v1/{space}/messages with { text }, AS the signed-in user. Returns
 *                          the created message resource name as the externalId.
 *
 * WHAT IS A TODO STUB (the realtime milestone):
 *   - subscribe          → Google Chat does not push per-space message events to a generic OAuth
 *                          client; a polling fallback (or a Chat app/Pub-Sub) is the realtime path.
 *   - resolveIdentity    → from the message `sender` block carried in each payload.
 *
 * STANDALONE-SAFE: every live method throws `google_not_configured` when the connector is disabled
 * or no client secret is set, so a fresh MatterChat with Google Chat off has zero Google behavior.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import type {
	IChatProvider,
	InboundMessageHandler,
	IOutboundMessage,
	IProviderChannel,
	IProviderConnection,
	IProviderCredentials,
	IProviderMessage,
	IProviderOAuthInput,
	IProviderSubscription,
	IProviderUser,
	IVerifiedConnection,
} from '../ChatProvider';
import {
	CHAT_BASE,
	getGoogleConfig,
	isGoogleConfigured,
	GOOGLE_TOKEN_ENDPOINT,
	redirectUri,
	GOOGLE_DELEGATED_SCOPES,
} from './google/config';
import type { GoogleTokens } from './google/googleApi';
import { googleFetch, googleGetAll } from './google/googleApi';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new GoogleChatProvider()`) also wires /_google/oauth.
import './google/routes';

const NEXT_MILESTONE =
	'GoogleChatProvider: realtime is the next milestone (subscribe/resolveIdentity). Google Chat has no generic per-space push to an OAuth client; polling/Pub-Sub is the path.';

function notConfigured(): never {
	throw new Error('google_not_configured');
}

/** How many message pages (×pageSize) to read in one syncMessages call — a reasonable backfill cap. */
const MAX_MESSAGE_PAGES = 5;
const MESSAGE_PAGE_SIZE = 50;

/** Build the mutable GoogleTokens bundle the googleApi reads/refreshes from stored credentials. */
function tokensFromCredentials(credentials: IProviderCredentials): GoogleTokens {
	if (!credentials?.accessToken) {
		throw new Error('google_missing_access_token');
	}
	return {
		accessToken: credentials.accessToken,
		refreshToken: credentials.refreshToken,
		expiresAt: typeof credentials.expiresAt === 'number' ? credentials.expiresAt : undefined,
	};
}

/** Normalize a space resource name to the `spaces/{id}` form (tolerates a bare id). */
function toSpaceName(externalId: string): string {
	if (!externalId) {
		throw new Error('google_invalid_channel_id');
	}
	return externalId.startsWith('spaces/') ? externalId : `spaces/${externalId}`;
}

export class GoogleChatProvider implements IChatProvider {
	readonly provider = 'google' as const;

	// ─── auth / lifecycle ──────────────────────────────────────────────────────────────────────

	/**
	 * Complete the OAuth auth-code + PKCE exchange and return usable credentials. The primary connect
	 * flow is the browser redirect handled by ./google/routes.ts (which persists the connection
	 * itself); this method exists so the IChatProvider contract is honored and callers that already
	 * hold an auth code (+ verifier) can complete the exchange programmatically.
	 */
	async connect(input: IProviderOAuthInput): Promise<IProviderCredentials> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const { authCode, codeVerifier } = input;
		if (!authCode || !codeVerifier) {
			throw new Error('google_connect_requires_auth_code_and_verifier');
		}
		const config = getGoogleConfig();

		const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // Google token host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: authCode,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: input.redirectUri || redirectUri(),
			}).toString(),
		});
		const tokens: any = await res.json().catch(() => ({}));
		if (!res.ok || !tokens?.access_token) {
			throw new Error(`google_token_exchange_failed:${tokens?.error || res.status}`);
		}

		// Decode the workspace domain from the id_token (present via `openid email`).
		let externalOrgId = '';
		if (typeof tokens.id_token === 'string') {
			try {
				const payload = tokens.id_token.split('.')[1];
				const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
				externalOrgId = claims.hd || (typeof claims.email === 'string' ? claims.email.split('@')[1] : '') || '';
			} catch {
				// fall through — verifyCredentials can still confirm the token by listing spaces
			}
		}

		return {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined,
			externalOrgId,
		};
	}

	/**
	 * Sanity-check credentials by listing spaces (the cheapest authenticated Chat call; the googleApi
	 * refreshes the access token once on a 401). Returns `ok:false` rather than throwing so the caller
	 * can mark the connection `error`/`needs-reconnect` cleanly.
	 */
	async verifyCredentials(credentials: IProviderCredentials): Promise<IVerifiedConnection> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(credentials);
		try {
			// A 1-item spaces listing proves the delegated token is valid for Chat.
			await googleFetch<{ spaces?: unknown[] }>(`${CHAT_BASE}/spaces?pageSize=1`, tokens);
			const externalOrgId = (typeof credentials.externalOrgId === 'string' && credentials.externalOrgId) || '';
			const externalOrgName = externalOrgId ? `Google Chat (${externalOrgId})` : 'Google Chat';
			return { ok: true, externalOrgId, externalOrgName, scopes: GOOGLE_DELEGATED_SCOPES };
		} catch (err) {
			return { ok: false, externalOrgId: String(credentials.externalOrgId || ''), externalOrgName: '', scopes: [] };
		}
	}

	/**
	 * Tear down live resources for this connection. No sockets/subscriptions exist yet (realtime is
	 * the next milestone), so this is a no-op today — disconnect at the record level is handled by
	 * connectionService.
	 */
	async disconnect(_connection: IProviderConnection): Promise<void> {
		// No live Google subscriptions to delete until the realtime milestone; nothing to release.
	}

	// ─── discovery ─────────────────────────────────────────────────────────────────────────────

	/**
	 * List the spaces visible to this connection's user: GET /v1/spaces, paged via nextPageToken,
	 * mapped to IProviderChannel. The space resource name (`spaces/{id}`) IS the channel id.
	 * `isPrivate` is derived from spaceType (anything that isn't a named `SPACE` — i.e. a DM or group
	 * DM — is treated as private).
	 */
	async listChannels(connection: IProviderConnection): Promise<IProviderChannel[]> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(connection.credentials);

		type GoogleSpace = { name?: string; displayName?: string; spaceType?: string; type?: string };

		const spaces = await googleGetAll<GoogleSpace>(`${CHAT_BASE}/spaces?pageSize=100`, 'spaces', tokens);

		const channels: IProviderChannel[] = [];
		for (const space of spaces) {
			if (!space?.name) {
				continue;
			}
			// spaceType is the current field; `type` is the legacy field (ROOM/DM) — tolerate both.
			const spaceType = space.spaceType || space.type || '';
			channels.push({
				// The space resource name is the channel id — passed straight to the messages endpoints.
				externalId: space.name,
				name: space.displayName || space.name,
				isPrivate: spaceType !== 'SPACE' && spaceType !== 'ROOM',
			});
		}
		return channels;
	}

	// ─── sync (read) — REAL ──────────────────────────────────────────────────────────────────────

	/**
	 * Read a space's messages: GET /v1/{space}/messages?pageSize=50, paged via nextPageToken up to
	 * MAX_MESSAGE_PAGES. Each Google message is mapped to IProviderMessage — author from
	 * `sender.displayName` (falls back to the sender resource name), text from `text`, `ts` from
	 * `createTime`. Messages without text (pure attachments/cards) still flow through with empty text.
	 *
	 * `channelExternalId` is the `spaces/{id}` resource name listChannels emitted. `since` is an
	 * optional ISO timestamp; messages at/older than it are skipped client-side (Google's list order
	 * is ascending by create time, so we filter rather than stop early).
	 */
	async *syncMessages(connection: IProviderConnection, channelExternalId: string, since?: string): AsyncIterable<IProviderMessage> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(connection.credentials);
		const space = toSpaceName(channelExternalId);

		type GoogleSender = { name?: string; displayName?: string; type?: string };
		type GoogleMessage = {
			name?: string;
			text?: string;
			createTime?: string;
			lastUpdateTime?: string;
			sender?: GoogleSender;
		};

		const sinceMs = since ? Date.parse(since) : NaN;
		const hasSince = !Number.isNaN(sinceMs);

		let pageToken: string | undefined;
		let pages = 0;

		while (pages < MAX_MESSAGE_PAGES) {
			const url = new URL(`${CHAT_BASE}/${space}/messages`);
			url.searchParams.set('pageSize', String(MESSAGE_PAGE_SIZE));
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}

			const page = await googleFetch<{ messages?: GoogleMessage[]; nextPageToken?: string }>(url.toString(), tokens);
			pages++;

			for (const msg of page.messages || []) {
				if (!msg?.name) {
					continue;
				}
				const ts = msg.createTime || '';
				if (hasSince && ts) {
					const tsMs = Date.parse(ts);
					if (!Number.isNaN(tsMs) && tsMs <= sinceMs) {
						continue;
					}
				}

				const authorId = msg.sender?.name || '';
				const authorName = msg.sender?.displayName;

				yield {
					externalId: msg.name,
					channelExternalId,
					authorExternalId: authorId,
					// Display name rides on the message (`sender.displayName`), so the UI can render a name
					// without a separate resolveIdentity lookup. Falls back to the sender id at the client.
					...(authorName ? { authorDisplayName: authorName } : {}),
					text: msg.text || '',
					ts,
					...(msg.lastUpdateTime && msg.lastUpdateTime !== msg.createTime ? { editedTs: msg.lastUpdateTime } : {}),
				};
			}

			pageToken = page.nextPageToken;
			if (!pageToken) {
				break;
			}
		}
	}

	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		// TODO(next milestone): Google Chat has no generic per-space push to an OAuth client; the
		// realtime path is either polling on a per-connection toggle or a Chat app + Pub/Sub event sub.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── identity — NEXT MILESTONE ───────────────────────────────────────────────────────────────

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		// TODO(next milestone): resolve from the message `sender` block carried in each payload.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── write — REAL ────────────────────────────────────────────────────────────────────────────

	/**
	 * Post a message to a space AS the signed-in user (delegated chat.messages.create):
	 * POST /v1/{space}/messages with `{ text }`. Returns the created message resource name as the
	 * externalId. Google API errors ({error:{code,message,status}}) are surfaced unswallowed by
	 * googleFetch.
	 *
	 * `channelExternalId` is the `spaces/{id}` resource name listChannels emitted.
	 */
	async postMessage(
		connection: IProviderConnection,
		channelExternalId: string,
		message: IOutboundMessage,
	): Promise<{ externalId: string }> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const text = message?.text;
		if (typeof text !== 'string' || !text.trim()) {
			throw new Error('google_empty_message');
		}
		const tokens = tokensFromCredentials(connection.credentials);
		const space = toSpaceName(channelExternalId);

		const created = await googleFetch<{ name?: string }>(`${CHAT_BASE}/${space}/messages`, tokens, {
			method: 'POST',
			body: { text },
		});
		if (!created?.name) {
			throw new Error('google_post_no_message_id');
		}
		return { externalId: created.name };
	}
}
