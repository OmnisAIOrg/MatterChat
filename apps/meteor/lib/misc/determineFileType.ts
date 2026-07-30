/**
 * MATTERCHAT: MIT clean-room port of the EE `determineFileType` helper (was
 * ee/lib/misc/determineFileType — removed with the Enterprise tree). Used by the Apps uploads
 * bridge to give an uploaded buffer a MIME type. Detection: a few well-known magic numbers
 * first, then the filename extension, then a binary fallback. With the Apps engine dropped the
 * only caller is dormant, but it must keep compiling and behave sanely.
 */

const MAGIC: [number[], string][] = [
	[[0x89, 0x50, 0x4e, 0x47], 'image/png'],
	[[0xff, 0xd8, 0xff], 'image/jpeg'],
	[[0x47, 0x49, 0x46, 0x38], 'image/gif'],
	[[0x25, 0x50, 0x44, 0x46], 'application/pdf'],
	[[0x50, 0x4b, 0x03, 0x04], 'application/zip'],
];

const EXTENSIONS: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	pdf: 'application/pdf',
	zip: 'application/zip',
	txt: 'text/plain',
	json: 'application/json',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	webm: 'video/webm',
};

export function determineFileType(buffer: Buffer, filename?: string): string {
	for (const [magic, type] of MAGIC) {
		if (buffer.length >= magic.length && magic.every((byte, i) => buffer[i] === byte)) {
			return type;
		}
	}

	const extension = filename?.split('.').pop()?.toLowerCase();
	if (extension && EXTENSIONS[extension]) {
		return EXTENSIONS[extension];
	}

	return 'application/octet-stream';
}
