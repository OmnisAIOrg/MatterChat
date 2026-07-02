import type { SettingValue } from '@rocket.chat/core-typings';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { settings } from '../../../../app/settings/server';

/**
 * CasePro CLIENT-message service client — the wire half of the two-way client↔firm
 * sync bridge (see ./index.ts for the engine).
 *
 * WHY A SEPARATE CLIENT (not the boards `caseProClient` transport): the client↔firm
 * thread lives in CasePro's `client_messages` table, which is exposed ONLY through the
 * OTP-authed client portal controller (`ClientSessionGuard`) and NOT through the generic
 * MCP connector (`query_entities` is module-permission-gated and `client_messages` has no
 * module mapping). So the sync engine talks to a small, purpose-built SERVICE endpoint on
 * the CRM backend:
 *
 *   GET  /service/matters/:matterId/client-messages?since=<iso>&limit=<n>
 *   POST /service/matters/:matterId/client-messages   { body, authorName, sourceMessageId, attachments? }
 *
 * Auth (RECONCILED onto casepro-live-wire): the service call presents the SAME identity
 * the MCP transport presents — the X-MCP-API-Key shared secret (env CASEPRO_MCP_API_KEY
 * only) plus X-Organization-ID — and carries the SAME egress posture: https-only,
 * host-pinned SSRF allow-list, no redirect-follow, and a hard refusal to send without a
 * key. The engine is additionally gated OFF by default (CasePro_Client_Sync_Enabled=false).
 */

/** One message as CasePro's service endpoint returns it. Money/ids are strings. */
export type CaseProClientMessage = {
	/** `client_messages.id` — the stable idempotency key for inbound dedupe. */
	id: string;
	matterId: string;
	/** 'client' = client→firm (inbound to MatterChat), 'firm' = firm→client (our own echo). */
	from: 'client' | 'firm';
	/** Display name captured at write time (the client's party name, or the staff author). */
	author: string;
	body: string;
	/** ISO-8601. */
	sentAt: string;
	/** Document references carried by the message (NOT bytes). */
	attachments?: CaseProClientAttachment[];
};

/** A document reference on a client message (mirrors CasePro `ClientMessageAttachment`). */
export type CaseProClientAttachment = {
	documentId: string;
	name: string;
	sizeBytes?: number;
};

export type PostClientMessageInput = {
	body: string;
	/** The staff author's display name (rendered client-side in the portal). */
	authorName?: string;
	/**
	 * The originating MatterChat message `_id`. CasePro persists it so a re-POST (our retry)
	 * is idempotent server-side AND so the inbound poll can recognise our own firm echo.
	 */
	sourceMessageId: string;
	attachments?: CaseProClientAttachment[];
};

/** Narrow an unknown to a non-empty string, else undefined. */
function str(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/** settings.get throws if a setting is not yet registered (early boot / tests). */
function safeGetSetting<T extends SettingValue>(id: string): T | undefined {
	try {
		return settings.get<T>(id);
	} catch {
		return undefined;
	}
}

/**
 * Resolve the CRM service base URL. Prefer the dedicated client-sync URL; fall back to the
 * shared CasePro base URL. Returns undefined when neither is set (engine treats as "not
 * configured" and stays inert).
 */
function resolveBaseUrl(): string | undefined {
	const dedicated = str(process.env.CASEPRO_CLIENT_SYNC_API_URL) || str(safeGetSetting<string>('CasePro_Client_Sync_API_URL'));
	const shared = str(process.env.CASEPRO_BASE_URL) || str(safeGetSetting<string>('CasePro_Base_URL'));
	const base = dedicated || shared;
	return base ? base.replace(/\/+$/, '') : undefined;
}

export class CaseProClientMessagesClient {
	/**
	 * Auth headers for the CRM service call. RECONCILED onto the casepro-live-wire
	 * posture: presents the SAME identity the MCP transport presents — the
	 * X-MCP-API-Key shared secret (env CASEPRO_MCP_API_KEY only, never a setting) and
	 * the X-Organization-ID scope. The key NEVER leaves via URL or logs, and the
	 * engine refuses to send an unauthenticated request (see `sendRequest`).
	 */
	private authHeaders(): Record<string, string> {
		const apiKey = str(process.env.CASEPRO_MCP_API_KEY);
		const orgId = str(process.env.CASEPRO_ORG_ID) || str(safeGetSetting<string>('CasePro_Org_ID'));
		return {
			'Content-Type': 'application/json',
			...(apiKey ? { 'X-MCP-API-Key': apiKey } : {}),
			...(orgId ? { 'X-Organization-ID': orgId } : {}),
		};
	}

	private url(matterId: string, query?: Record<string, string | number | undefined>): string {
		const base = resolveBaseUrl();
		if (!base) {
			throw new Error('CasePro client-sync: no service base URL configured');
		}
		const qs = query
			? Object.entries(query)
					.filter(([, v]) => v !== undefined && v !== '')
					.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
					.join('&')
			: '';
		return `${base}/service/matters/${encodeURIComponent(matterId)}/client-messages${qs ? `?${qs}` : ''}`;
	}

	/**
	 * Single authenticated request against the CRM service endpoint, carrying the
	 * live-wire egress posture: https-only, refuse-without-key, host-pinned SSRF
	 * allow-list (never the whole internet), and no redirect-following (a redirect
	 * would re-send the key elsewhere).
	 */
	private async sendRequest(target: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<any> {
		const parsed = new URL(target);
		if (parsed.protocol !== 'https:') {
			throw new Error(`CasePro client-sync: service URL must be https (got ${parsed.protocol}//)`);
		}
		const headers = this.authHeaders();
		if (!headers['X-MCP-API-Key']) {
			throw new Error('CasePro client-sync: refusing to call without CASEPRO_MCP_API_KEY');
		}
		const res = await fetch(target, {
			method: init.method,
			headers,
			...(init.body ? { body: init.body } : {}),
			ignoreSsrfValidation: false,
			allowList: parsed.hostname,
			followRedirects: false,
		});
		if (res.status >= 300 && res.status < 400) {
			throw new Error(`CasePro client-sync: service redirected (${res.status}) — refusing to follow`);
		}
		return res;
	}

	/** True when a base URL is configured — the engine skips matters when this is false. */
	isConfigured(): boolean {
		return Boolean(resolveBaseUrl());
	}

	/**
	 * Read client-thread messages for a matter created at/after `since` (exclusive cursor by
	 * the last-seen `sentAt`). Returns them oldest-first so the engine can advance its cursor
	 * deterministically.
	 */
	async listSince(matterId: string, since?: string, limit = 200): Promise<CaseProClientMessage[]> {
		const res = await this.sendRequest(this.url(matterId, { since, limit }), { method: 'GET' });
		if (!res.ok) {
			throw new Error(`CasePro client-sync listSince(${matterId}) failed: ${res.status}`);
		}
		const json = (await res.json()) as { data?: CaseProClientMessage[] };
		return Array.isArray(json.data) ? json.data : [];
	}

	/**
	 * Post a firm-side (staff) reply into the client's portal thread. CasePro stores it as
	 * `direction='outbound'`. Idempotent on `sourceMessageId` (server upserts). Returns the
	 * created/existing message id.
	 */
	async postFirmMessage(matterId: string, input: PostClientMessageInput): Promise<string> {
		const res = await this.sendRequest(this.url(matterId), {
			method: 'POST',
			body: JSON.stringify({
				body: input.body,
				authorName: input.authorName,
				sourceMessageId: input.sourceMessageId,
				attachments: input.attachments,
			}),
		});
		if (!res.ok) {
			throw new Error(`CasePro client-sync postFirmMessage(${matterId}) failed: ${res.status}`);
		}
		const json = (await res.json()) as { data?: { id?: string } };
		const id = str(json.data?.id);
		if (!id) {
			throw new Error(`CasePro client-sync postFirmMessage(${matterId}) returned no id`);
		}
		return id;
	}
}

export const caseProClientMessagesClient = new CaseProClientMessagesClient();
