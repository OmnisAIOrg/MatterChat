import type { IMessage } from '@rocket.chat/core-typings';

import type { CaseProClientAttachment } from './client';
import { settings } from '../../../settings';

/**
 * FILE (attachment) sync for the client↔firm bridge — the REFERENCE-SHARE path.
 *
 * WHY REFERENCE-SHARE (not byte transfer): MatterChat and CasePro point at the SAME LitBox
 * tenant. CasePro uploads a client-portal document straight to LitBox (presigned PUT) with
 * `app_slug` + the matter's `workspace_id` + a `file_app_link`, and authenticates to LitBox
 * with a KeyGate SERVICE credential keyed on the org. A LitBox `documentId` is therefore
 * org-resolvable server-side by anyone holding a LitBox credential for that org — the same
 * shared-file model MedChron uses (one physical file, many app-links; nobody re-uploads bytes).
 *
 * So this lane moves NO bytes. It carries the LitBox `documentId` (+ its owning `organizationId`,
 * since MatterChat's Client room does not carry an org id) across the bridge as a resolvable
 * reference:
 *   - inbound  (client → firm): the client's LitBox doc becomes a MatterChat message attachment
 *     whose `title_link` deep-links to the LitBox document. A staff member opens it through the
 *     EXISTING user-credentialed LitBox proxy (`/_litbox/v1`) with their OWN token — the doc lives
 *     in their org's matter workspace, so their token can read it. No background service credential
 *     to LitBox is required or invented here.
 *   - outbound (firm → client): a staff message that references a LitBox doc forwards the
 *     `documentId` on the `client_message` so the PWA renders it natively.
 *
 * GATING: everything here is a no-op unless `CasePro_Client_Sync_Files_Enabled` is ON (default
 * OFF). While OFF the caller (index.ts) keeps today's behaviour exactly — reference STUBS only
 * (name + size + "open in CasePro" note), zero documentId carried, zero deep-links.
 *
 * SAFETY: size-capped (oversize → reference note, never blocked); content-type passed through
 * verbatim; a bad/incomplete attachment degrades to a note and NEVER blocks the message.
 */

/** Deep-link prefix a staff user follows to open a shared-LitBox document in MatterChat's Files. */
const LITBOX_DOC_LINK_BASE = '/_litbox/v1/files';

/** ON only when the sub-flag is set (and, implicitly, the parent client-sync gate — checked upstream). */
export function isFileSyncEnabled(): boolean {
	try {
		return Boolean(settings.get('CasePro_Client_Sync_Files_Enabled'));
	} catch {
		return false;
	}
}

/** Configured max bytes for a file whose reference we surface (oversize → note). Safe default 50 MB. */
export function fileMaxBytes(): number {
	try {
		const v = Number(settings.get('CasePro_Client_Sync_File_Max_Bytes'));
		return Number.isFinite(v) && v > 0 ? v : 50 * 1024 * 1024;
	} catch {
		return 50 * 1024 * 1024;
	}
}

/** True when the attachment carries everything needed to resolve the shared-LitBox doc. */
export function isResolvableRef(a: CaseProClientAttachment): boolean {
	return Boolean(a?.documentId) && Boolean(a?.organizationId);
}

/** True when the byte size (if known) is within the cap. Unknown size passes (can't judge). */
export function withinSizeCap(a: CaseProClientAttachment): boolean {
	return typeof a.sizeBytes !== 'number' || a.sizeBytes <= fileMaxBytes();
}

/**
 * The reference-STUB rendering (today's behaviour): a titled note pointing staff at the CasePro
 * matter documents. Carries `documentId` in a field for future deep-linking. NO deep-link.
 * Used when file-sync is OFF, or when a ref is not resolvable / oversize (graceful fallback).
 */
export function toStubAttachment(a: CaseProClientAttachment): NonNullable<IMessage['attachments']>[number] {
	return {
		title: a.name,
		text: `Client attachment${a.sizeBytes ? ` · ${Math.round(a.sizeBytes / 1024)} KB` : ''} (open in the CasePro matter documents)`,
		fields: [{ title: 'documentId', value: a.documentId, short: true }],
	};
}

/**
 * The RESOLVABLE rendering (file-sync ON + resolvable ref + within cap): a titled attachment whose
 * `title_link` deep-links to the shared-LitBox document. Content-type is passed through verbatim.
 * The link is same-origin (`/_litbox/...`) — https-only egress is preserved because the proxy it
 * hits pins outbound to the configured (https) LitBox origin.
 */
export function toResolvableAttachment(a: CaseProClientAttachment): NonNullable<IMessage['attachments']>[number] {
	const sizeLabel = a.sizeBytes ? ` · ${Math.round(a.sizeBytes / 1024)} KB` : '';
	// `title_link` is the load-bearing part — the staff user clicks it and the document opens
	// through the EXISTING user-credentialed LitBox proxy (same-origin `/_litbox`, no new egress).
	// Resolvable coordinates (documentId / org / type) ride in `fields` (a supported, rendered
	// attachment field); the message-level `customFields.caseproClientSync` carries sync metadata.
	return {
		title: a.name,
		title_link: `${LITBOX_DOC_LINK_BASE}/${encodeURIComponent(a.documentId)}`,
		title_link_download: true,
		text: `Client attachment${sizeLabel} — opens from LitBox`,
		fields: [
			{ title: 'documentId', value: a.documentId, short: true },
			{ title: 'organizationId', value: a.organizationId ?? '', short: true },
			...(a.contentType ? [{ title: 'type', value: a.contentType, short: true }] : []),
		],
	};
}

/**
 * Map ONE inbound CasePro attachment to an RC message attachment, choosing resolvable vs stub:
 *  - file-sync OFF, or ref not resolvable (no org/doc id), or oversize → STUB (never blocked).
 *  - else → RESOLVABLE (deep-linkable, opens natively via the LitBox proxy).
 * Never throws — a malformed attachment falls back to a stub.
 */
export function mapInboundAttachment(a: CaseProClientAttachment): NonNullable<IMessage['attachments']>[number] {
	try {
		if (isFileSyncEnabled() && isResolvableRef(a) && withinSizeCap(a)) {
			return toResolvableAttachment(a);
		}
	} catch {
		// fall through to stub — a file must never break a message.
	}
	return toStubAttachment(a);
}

/** Map all inbound attachments (or undefined when there are none). */
export function mapInboundAttachments(attachments?: CaseProClientAttachment[]): IMessage['attachments'] {
	if (!attachments?.length) {
		return undefined;
	}
	return attachments.map(mapInboundAttachment);
}

/**
 * OUTBOUND: extract shared-LitBox document references a staff message wants to forward to the
 * client's PWA. The reference source is `message.customFields.caseproClientSyncFile[]` (the seam a
 * future "attach from LitBox" message action writes). Returns [] when file-sync is OFF, none are
 * present, or the sub-flag is off — so the outbound POST stays text-only and NOTHING is forwarded
 * that the PWA can't resolve. Idempotency of the whole message is handled by `sourceMessageId`
 * upstream; here we only filter to well-formed, in-cap refs.
 */
export function extractOutboundAttachments(message: IMessage): CaseProClientAttachment[] {
	if (!isFileSyncEnabled()) {
		return [];
	}
	const raw = (message.customFields as any)?.caseproClientSyncFile;
	const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const out: CaseProClientAttachment[] = [];
	for (const r of list) {
		const documentId = typeof r?.documentId === 'string' ? r.documentId : undefined;
		const organizationId = typeof r?.organizationId === 'string' ? r.organizationId : undefined;
		if (!documentId || !organizationId) {
			continue; // not resolvable on the client side — skip, never forward a dangling ref.
		}
		const sizeBytes = typeof r?.sizeBytes === 'number' ? r.sizeBytes : undefined;
		const attachment: CaseProClientAttachment = {
			documentId,
			organizationId,
			name: typeof r?.name === 'string' && r.name ? r.name : 'Document',
			...(sizeBytes !== undefined ? { sizeBytes } : {}),
			...(typeof r?.contentType === 'string' ? { contentType: r.contentType } : {}),
		};
		if (withinSizeCap(attachment)) {
			out.push(attachment);
		}
	}
	return out;
}
