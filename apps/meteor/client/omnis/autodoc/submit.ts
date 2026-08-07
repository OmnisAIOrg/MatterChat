import { omnisUpload } from '../shell/omnisRest';

/**
 * Submit a file to AutoDoc.
 *
 * `roomId` is the ONLY matter signal sent, and the server resolves the matter
 * from that room rather than trusting a client-supplied `matterId`. A browser
 * that could name its own matter could file a document into any matter in the
 * firm.
 */

export type AutoDocSubmitResponse = {
	document: { id: string; filename: string; status: string };
	matter?: { matterId: string; matterName: string };
};

export async function submitToAutoDoc(file: File, roomId?: string): Promise<AutoDocSubmitResponse> {
	const form = new FormData();
	form.append('file', file, file.name);
	if (roomId) {
		form.append('roomId', roomId);
	}
	return omnisUpload<AutoDocSubmitResponse>('/v1/autodoc.submit', form);
}

/** Content types AutoDoc can read — used to gate the message action and drop zones. */
const READABLE_TYPES = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/tiff',
	'image/heic',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const READABLE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.heic', '.doc', '.docx'];

export function isAutoDocReadable(file: { type?: string; name?: string }): boolean {
	if (file.type && READABLE_TYPES.has(file.type)) {
		return true;
	}
	const name = (file.name ?? '').toLowerCase();
	return READABLE_EXTENSIONS.some((ext) => name.endsWith(ext));
}
