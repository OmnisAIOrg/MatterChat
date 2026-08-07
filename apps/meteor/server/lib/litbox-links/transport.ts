import { serverFetch } from '@rocket.chat/server-fetch';

import type { LitboxLinksConfig } from './config';
import { buildMultipartBody } from '../omnis/http';
import { SystemLogger } from '../logger/system';

/**
 * The anonymous upload leg: bytes → LitBox, authenticated with the service
 * credential.
 *
 * Everything else about LitBox in MatterChat is a **reference** operation — the
 * two products point at the same LitBox tenant, so a `documentId` is
 * org-resolvable server-side and nobody re-uploads. This module is the single
 * exception, and it is only an exception because the bytes genuinely originate
 * outside LitBox: a client photographing paperwork in a clinic waiting room.
 *
 * Attaching a matter file to a message, or filing an uploaded file into a
 * matter, must NOT come through here. Those carry `documentId` +
 * `organizationId` and move zero bytes.
 */

export type LitboxUploadInput = {
	filename: string;
	contentType: string;
	content: Buffer;
	/** Destination workspace. Absent = the creator's personal workspace. */
	workspaceId?: string;
	/** Folder within the workspace, e.g. "Client uploads". */
	folder?: string;
	/** Who the upload page said this was for — recorded on the file. */
	uploadedByLabel?: string;
};

export type LitboxUploadResult = {
	documentId: string;
	organizationId?: string;
	name: string;
	sizeBytes: number;
};

export interface ILitboxUploadTransport {
	readonly kind: 'stub' | 'native';
	upload(input: LitboxUploadInput): Promise<LitboxUploadResult>;
}

/** Fixtures: the whole upload-link flow is demoable with no LitBox credential. */
export class LitboxStubUploadTransport implements ILitboxUploadTransport {
	readonly kind = 'stub' as const;

	private counter = 0;

	async upload(input: LitboxUploadInput): Promise<LitboxUploadResult> {
		this.counter += 1;
		return {
			documentId: `stub-litbox-${this.counter}`,
			organizationId: 'stub-org',
			name: input.filename,
			sizeBytes: input.content.length,
		};
	}
}

export class LitboxNativeUploadTransport implements ILitboxUploadTransport {
	readonly kind = 'native' as const;

	constructor(private readonly cfg: LitboxLinksConfig) {}

	async upload(input: LitboxUploadInput): Promise<LitboxUploadResult> {
		// Multipart as a Buffer — serverFetch JSON-stringifies any non-Buffer
		// object body, so a FormData would go out as `{}`. See omnis/http.ts.
		const { body, contentType } = buildMultipartBody(
			[
				{ name: 'app_slug', value: 'matterchat' },
				...(input.workspaceId ? [{ name: 'workspace_id', value: input.workspaceId }] : []),
				...(input.folder ? [{ name: 'folder', value: input.folder }] : []),
				...(input.uploadedByLabel ? [{ name: 'uploaded_by_label', value: input.uploadedByLabel }] : []),
			],
			[{ name: 'file', filename: input.filename, contentType: input.contentType, content: input.content }],
		);

		const host = new URL(this.cfg.baseUrl).host;
		const response = await serverFetch(`${this.cfg.baseUrl}/api/v1/files/upload`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': contentType,
				Authorization: `Bearer ${this.cfg.serviceApiKey}`,
			},
			body,
			// Host-pinned to the configured LitBox origin.
			ignoreSsrfValidation: false,
			allowList: [host],
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			SystemLogger.warn({ msg: 'LitBox upload-link upload failed', status: response.status });
			throw new Error(`LitBox rejected the upload (${response.status}) ${text.slice(0, 200)}`);
		}

		const raw = (await response.json()) as Record<string, unknown>;
		const documentId = typeof raw.documentId === 'string' ? raw.documentId : typeof raw.id === 'string' ? raw.id : undefined;
		if (!documentId) {
			throw new Error('LitBox returned no document id');
		}

		return {
			documentId,
			...(typeof raw.organizationId === 'string' ? { organizationId: raw.organizationId } : {}),
			name: typeof raw.name === 'string' ? raw.name : input.filename,
			sizeBytes: typeof raw.size === 'number' ? raw.size : input.content.length,
		};
	}
}

export function litboxUploadTransport(cfg: LitboxLinksConfig): ILitboxUploadTransport {
	// No base URL or no service credential ⇒ fixtures, so the feature stays
	// reviewable end to end before LitBox is wired up.
	return cfg.baseUrl && cfg.serviceApiKey ? new LitboxNativeUploadTransport(cfg) : new LitboxStubUploadTransport();
}

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------

/**
 * Magic-number sniffing. The spec requires validating content types **on
 * arrival** and not trusting the extension: an upload link is an unauthenticated
 * write endpoint, so `invoice.pdf` may be anything at all.
 */
const SIGNATURES: { type: string; test(buf: Buffer): boolean }[] = [
	{ type: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
	{ type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
	{ type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
	{ type: 'image/heic', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
	{ type: 'image/tiff', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])) },
];

/** @returns the sniffed content type, or null when it is not an accepted kind. */
export function sniffContentType(content: Buffer): string | null {
	if (content.length < 12) {
		return null;
	}
	return SIGNATURES.find((sig) => sig.test(content))?.type ?? null;
}
