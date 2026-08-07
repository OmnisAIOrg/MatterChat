import { resolveLitboxLinksConfig, uploadLinkUrl } from './config';
import type { LitboxLinksConfig } from './config';
import {
	claimUploadSlot,
	createUploadLink,
	listUploadLinks,
	releaseUploadSlot,
	resolveUploadLink,
	revokeUploadLink,
} from './store';
import type { CreateUploadLinkInput, LinkRejection, UploadLinkDestination, UploadLinkRecord } from './store';
import { litboxUploadTransport, sniffContentType } from './transport';
import { submitAutoDocDocument } from '../autodoc/client';
import { resolveAutoDocConfig } from '../autodoc/config';
import { SystemLogger } from '../logger/system';
import { postOmnisNote } from '../omnis/receipt';

/**
 * Upload links — a link you send to a client or provider that lets them upload
 * files **without an account**, landing directly in the right workspace.
 *
 * ## Why this is the interesting half of LitBox
 *
 * A client-uploaded bill arrives **already matter-bound**, so AutoDoc never has
 * to guess — the same property that makes a channel drop a one-click approve.
 * That is the payoff, and it is why `sendToAutoDoc` defaults on: the chain
 * `upload → matter workspace → AutoDoc, pre-bound → one-click approve` is the
 * whole product argument, and it only holds if every hop is wired.
 *
 * ## Security posture
 *
 * The token is a writable door into a matter workspace, held by someone with no
 * account, so every gate is server-side and re-checked per request:
 *
 *   - 32 bytes of CSPRNG entropy, stored only as a SHA-256 (see `./store.ts`);
 *   - **upload-only** — nothing here can list or read what is already in the
 *     workspace, and no route exposes that capability to a token holder;
 *   - expiry, per-file size cap and total-file cap enforced here, never only in
 *     the UI;
 *   - content type sniffed from the bytes on arrival; the extension is not
 *     trusted;
 *   - revocation takes effect immediately, because it is a condition of the
 *     same atomic update that claims the slot.
 */

export type CreateLinkRequest = {
	destination: UploadLinkDestination;
	recipientLabel?: string;
	requestText?: string;
	notifyRoomId?: string;
	notifyOnUpload?: boolean;
	sendToAutoDoc?: boolean;
	password?: string;
	/** 7 | 30 | 90 | 0 (never). Defaults to the configured default. */
	expiryDays?: number;
	createdBy: { _id: string; username?: string };
};

export type CreateLinkResult = {
	link: UploadLinkRecord;
	/** The ONE-TIME plaintext URL. Never recoverable after this response. */
	url: string;
};

export async function createLink(request: CreateLinkRequest): Promise<CreateLinkResult> {
	const cfg = resolveLitboxLinksConfig();
	if (!cfg.enabled) {
		throw new Error('Upload links are not enabled on this workspace');
	}

	const input: CreateUploadLinkInput = {
		destination: request.destination,
		...(request.recipientLabel ? { recipientLabel: request.recipientLabel } : {}),
		...(request.requestText ? { requestText: request.requestText } : {}),
		...(request.notifyRoomId ? { notifyRoomId: request.notifyRoomId } : {}),
		notifyOnUpload: request.notifyOnUpload ?? true,
		// Only meaningful for a matter destination: there is no matter to bind to
		// on the personal path, so AutoDoc would be back to guessing.
		sendToAutoDoc: (request.sendToAutoDoc ?? true) && request.destination.kind === 'matter',
		...(request.password ? { password: request.password } : {}),
		maxFiles: cfg.maxFiles,
		maxFileBytes: cfg.maxFileBytes,
		...(request.expiryDays === 0 ? {} : { expiryDays: request.expiryDays ?? cfg.defaultExpiryDays }),
		createdBy: request.createdBy,
	};

	const { record, token } = await createUploadLink(input);
	return { link: record, url: uploadLinkUrl(cfg, token) };
}

export async function listLinks(filter: { matterId?: string; createdBy?: string }): Promise<UploadLinkRecord[]> {
	return listUploadLinks(filter);
}

export async function revokeLink(linkId: string): Promise<boolean> {
	return revokeUploadLink(linkId);
}

// ---------------------------------------------------------------------------
// The public leg
// ---------------------------------------------------------------------------

export type PublicLinkInfo = {
	recipientLabel?: string;
	requestText?: string;
	destinationLabel: string;
	requiresPassword: boolean;
	expiresAt?: string;
	maxFileMb: number;
	remainingFiles: number;
};

/**
 * What the upload page may know before a file is sent.
 *
 * Deliberately minimal: the personal message, the ask, the expiry and the
 * limits. It does NOT reveal the matter id, the workspace id, or anything
 * already stored — a token holder must never be able to learn what is in the
 * workspace, only add to it.
 */
export async function describeLink(token: string): Promise<PublicLinkInfo | { rejected: LinkRejection }> {
	// Password is checked at upload time; describing the page must not require it
	// (the recipient needs to see the prompt before they can answer it).
	const resolved = await resolveUploadLink(token);
	if ('rejected' in resolved) {
		// A bad password cannot be the reason here — no password was supplied.
		return resolved;
	}
	const { link } = resolved;

	return {
		...(link.recipientLabel ? { recipientLabel: link.recipientLabel } : {}),
		...(link.requestText ? { requestText: link.requestText } : {}),
		destinationLabel: link.destination.kind === 'matter' ? link.destination.matterName : 'your legal team',
		requiresPassword: Boolean(link.passwordHash),
		...(link.expiresAt ? { expiresAt: link.expiresAt.toISOString() } : {}),
		maxFileMb: Math.round(link.maxFileBytes / (1024 * 1024)),
		remainingFiles: Math.max(0, link.maxFiles - link.usedCount),
	};
}

export type PublicUploadResult = { documentId: string; name: string };

export async function uploadThroughLink(
	token: string,
	file: { filename: string; content: Buffer },
	password?: string,
): Promise<PublicUploadResult | { rejected: LinkRejection | 'too-large' | 'unsupported-type' }> {
	const cfg = resolveLitboxLinksConfig();

	const resolved = await resolveUploadLink(token, password);
	if ('rejected' in resolved) {
		return resolved;
	}
	const { link } = resolved;

	if (file.content.length > link.maxFileBytes) {
		return { rejected: 'too-large' };
	}

	// Sniff the bytes. `invoice.pdf` from an unauthenticated endpoint may be
	// anything at all, so the extension is not evidence.
	const contentType = sniffContentType(file.content);
	if (!contentType) {
		return { rejected: 'unsupported-type' };
	}

	// Claim the slot BEFORE uploading, so two concurrent uploads cannot both pass
	// a cap of one. Released again if the upload itself fails.
	if (!(await claimUploadSlot(link._id))) {
		return { rejected: 'exhausted' };
	}

	let uploaded;
	try {
		uploaded = await litboxUploadTransport(cfg).upload({
			filename: sanitizeFilename(file.filename),
			contentType,
			content: file.content,
			...(link.destination.kind === 'matter' && link.destination.workspaceId
				? { workspaceId: link.destination.workspaceId }
				: {}),
			folder: 'Client uploads',
			...(link.recipientLabel ? { uploadedByLabel: link.recipientLabel } : {}),
		});
	} catch (err) {
		await releaseUploadSlot(link._id);
		SystemLogger.warn({ msg: 'Upload-link upload failed', linkId: link._id, err });
		throw err;
	}

	// Everything after this point is best-effort: the file IS in the workspace,
	// and failing the request now would invite the client to upload it twice.
	await afterUpload(link, uploaded.documentId, file, contentType).catch((err) =>
		SystemLogger.warn({ msg: 'Upload-link post-processing failed', linkId: link._id, err }),
	);

	return { documentId: uploaded.documentId, name: uploaded.name };
}

async function afterUpload(
	link: UploadLinkRecord,
	documentId: string,
	file: { filename: string; content: Buffer },
	contentType: string,
): Promise<void> {
	const who = link.recipientLabel ?? 'A client';

	if (link.notifyOnUpload && link.notifyRoomId) {
		await postOmnisNote(
			link.notifyRoomId,
			link.createdBy._id,
			`📎 **${who}** uploaded \`${sanitizeFilename(file.filename)}\` via an upload link.`,
		);
	}

	// The payoff: a client-uploaded bill reaches AutoDoc ALREADY matter-bound.
	if (link.sendToAutoDoc && link.destination.kind === 'matter' && resolveAutoDocConfig().enabled) {
		await submitAutoDocDocument({
			filename: sanitizeFilename(file.filename),
			contentType,
			content: file.content,
			matterId: link.destination.matterId,
			...(link.notifyRoomId ? { roomId: link.notifyRoomId } : {}),
			submittedBy: link.createdBy._id,
		});
	}
}

/**
 * Strip directory components and control characters. The filename arrives from
 * an unauthenticated client, so it is attacker-controlled all the way to
 * whatever writes it.
 */
export function sanitizeFilename(name: string): string {
	const base = name.split(/[/\\]/).pop() ?? 'upload';
	// Control characters (C0 + DEL) written as escapes, not literal bytes: they
	// would otherwise survive into a filesystem path, a Content-Disposition
	// header, or a log line — and be invisible in the source while doing it.
	// eslint-disable-next-line no-control-regex
	const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	// Leading dots would hide the file or reintroduce a '..' segment.
	return cleaned.replace(/^\.+/, '').slice(0, 200) || 'upload';
}

export type { LitboxLinksConfig, UploadLinkRecord };
