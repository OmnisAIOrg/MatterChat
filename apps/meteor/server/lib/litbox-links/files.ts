import { Users } from '@rocket.chat/models';
import { serverFetch } from '@rocket.chat/server-fetch';

import { resolveLitboxLinksConfig } from './config';
import { decryptToken } from '../../../app/omnisai-oauth/server/litboxCrypto';
import { SystemLogger } from '../logger/system';

/**
 * The matter-files feed behind the LitBox widget.
 *
 * Authenticated with **the caller's own** LitBox credential, exactly like the
 * `/_litbox` proxy — no service credential, no new egress, no separate login.
 * The credential is read from `user.omnisaiLitbox` and decrypted here rather
 * than going back out through the browser proxy, because the REST layer has
 * already authenticated this user and a second token round-trip would only add
 * a failure mode.
 *
 * A READ, so it degrades: an unreachable or unconnected LitBox yields
 * `reachable: false` and an empty list, and the widget says "Can't reach LitBox
 * right now" rather than rendering an empty list that reads as "no files".
 */

export type LitboxFileRow = {
	id: string;
	name: string;
	sizeBytes: number;
	uploadedBy?: string;
	uploadedAt: string;
	/** LitBox sync/processing state, surfaced as the row chip. */
	state: 'synced' | 'processing' | 'needs_ocr' | 'failed';
	organizationId?: string;
};

export type LitboxFilesFeed = {
	connected: boolean;
	reachable: boolean;
	isDemoData: boolean;
	files: LitboxFileRow[];
	summary: { files: number; thisWeek: number; needsOcr: number };
};

function summarize(files: LitboxFileRow[]): LitboxFilesFeed['summary'] {
	const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	return {
		files: files.length,
		thisWeek: files.filter((f) => new Date(f.uploadedAt).getTime() >= weekAgo).length,
		needsOcr: files.filter((f) => f.state === 'needs_ocr').length,
	};
}

function iso(hoursAgo: number): string {
	return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

function stubFiles(): LitboxFileRow[] {
	return [
		{ id: 'stub-f1', name: 'patel-clinic-bill-june.pdf', sizeBytes: 284_120, uploadedBy: 'M. Alvarez', uploadedAt: iso(3), state: 'synced' },
		{ id: 'stub-f2', name: 'crash-scene-photos.zip', sizeBytes: 8_431_200, uploadedBy: 'D. Reyes', uploadedAt: iso(30), state: 'synced' },
		{ id: 'stub-f3', name: 'imaging-report-scan.pdf', sizeBytes: 1_942_300, uploadedBy: 'Client upload', uploadedAt: iso(52), state: 'needs_ocr' },
		{ id: 'stub-f4', name: 'wage-loss-statement.pdf', sizeBytes: 61_200, uploadedBy: 'K. Osei', uploadedAt: iso(190), state: 'synced' },
		{ id: 'stub-f5', name: 'policy-declarations.pdf', sizeBytes: 402_800, uploadedBy: 'Intake', uploadedAt: iso(320), state: 'processing' },
	];
}

function normalizeState(raw: unknown): LitboxFileRow['state'] {
	switch (String(raw)) {
		case 'synced':
		case 'ready':
		case 'complete':
			return 'synced';
		case 'processing':
		case 'uploading':
			return 'processing';
		case 'needs_ocr':
		case 'ocr_pending':
			return 'needs_ocr';
		case 'failed':
		case 'error':
			return 'failed';
		default:
			return 'synced';
	}
}

function normalizeFile(raw: unknown): LitboxFileRow | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const r = raw as Record<string, unknown>;
	const id = typeof r.documentId === 'string' ? r.documentId : typeof r.id === 'string' ? r.id : undefined;
	if (!id) {
		return null;
	}
	return {
		id,
		name: typeof r.name === 'string' ? r.name : 'file',
		sizeBytes: typeof r.size === 'number' ? r.size : 0,
		...(typeof r.uploadedBy === 'string' ? { uploadedBy: r.uploadedBy } : {}),
		uploadedAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
		state: normalizeState(r.status ?? r.state),
		...(typeof r.organizationId === 'string' ? { organizationId: r.organizationId } : {}),
	};
}

/**
 * @param uid    the caller (already authenticated by the REST layer)
 * @param scope  a matter's workspace, or the user's own LitBox when absent —
 *               the shared context rule applied to file scope
 */
export async function listMatterFiles(uid: string, scope: { workspaceId?: string }): Promise<LitboxFilesFeed> {
	const cfg = resolveLitboxLinksConfig();

	if (!cfg.baseUrl) {
		// Not configured at all: fixtures, honestly labelled.
		const files = stubFiles();
		return { connected: true, reachable: true, isDemoData: true, files, summary: summarize(files) };
	}

	const user = await Users.findOneById(uid, { projection: { omnisaiLitbox: 1 } });
	const stored = (user as { omnisaiLitbox?: { sessionToken?: string } } | null)?.omnisaiLitbox;
	const token = decryptToken(stored?.sessionToken);
	if (!token) {
		// A plain username/password login never captured a LitBox credential. This
		// is DISTINCT from unreachable — the widget offers "Connect your OmnisAI
		// account" rather than implying LitBox is down.
		return { connected: false, reachable: true, isDemoData: false, files: [], summary: summarize([]) };
	}

	try {
		const url = new URL(`${cfg.baseUrl}/api/v1/files`);
		if (scope.workspaceId) {
			url.searchParams.set('workspace_id', scope.workspaceId);
		}
		url.searchParams.set('limit', '25');

		const response = await serverFetch(url.toString(), {
			headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
			ignoreSsrfValidation: false,
			allowList: [url.host],
		});
		if (!response.ok) {
			throw new Error(`LitBox responded ${response.status}`);
		}

		const raw = (await response.json()) as { files?: unknown[]; data?: unknown[] };
		const files = (raw.files ?? raw.data ?? []).map(normalizeFile).filter((f): f is LitboxFileRow => Boolean(f));
		return { connected: true, reachable: true, isDemoData: false, files, summary: summarize(files) };
	} catch (err) {
		SystemLogger.warn({ msg: 'LitBox file list unavailable — serving a degraded feed', err });
		return { connected: true, reachable: false, isDemoData: false, files: [], summary: summarize([]) };
	}
}
