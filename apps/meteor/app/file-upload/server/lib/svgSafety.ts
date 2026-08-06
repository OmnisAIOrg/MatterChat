import type http from 'node:http';

/**
 * MATTERCHAT — make SVG uploads safe to allow.
 *
 * Rocket.Chat ships `FileUpload_MediaTypeBlackList = 'image/svg+xml'` out of the box, and it is not
 * arbitrary: an SVG is an XML DOCUMENT, not a bitmap. It may contain <script>, <foreignObject> and
 * event handlers, and when the server hands one back as `image/svg+xml` with
 * `Content-Disposition: inline`, opening that attachment navigates the browser to OUR origin and
 * RUNS it. That is textbook stored XSS: the script executes with the victim's MatterChat session and
 * can read their rooms and mint API calls as them. Blocking the type is upstream's blunt answer.
 *
 * The founder needs to send SVGs (logos, exhibits, diagrams), so we take the sharp answer instead:
 * keep the upload, remove the execution.
 *
 * WHAT MAKES THIS SAFE, and why SVGs still work in chat:
 *
 *   • `Content-Disposition: attachment` — a top-level navigation to the file downloads it instead of
 *     rendering it, so there is no document on our origin for the script to run in. Crucially this
 *     does NOT break the chat preview: Content-Disposition is ignored for SUBRESOURCE loads, so
 *     `<img src="….svg">` (how Rocket.Chat renders image attachments — see isImagePreviewSupported,
 *     which already lists image/svg+xml) still paints the picture. And by spec an SVG loaded through
 *     <img> is script-disabled: no scripts, no external fetches, no cross-origin anything. So the
 *     useful half survives and the dangerous half does not.
 *
 *   • `X-Content-Type-Options: nosniff` — stops a browser from re-guessing a mislabelled upload back
 *     into an executable type. Without it, uploading a script-bearing SVG under a lying Content-Type
 *     walks straight around the check above.
 *
 *   • `Content-Security-Policy: sandbox` — defence in depth for any path that still ends up
 *     rendering the file as a document (a proxied store, a future inline route, a browser that
 *     honours the disposition loosely). A sandbox with no allow-* tokens means no scripts, and an
 *     opaque origin so nothing it does can touch our session.
 *
 * Applied at every point where an upload's response headers are set, because a single unhardened
 * store is a complete bypass.
 */

/** Media types that are DOCUMENTS pretending to be images — they can execute if rendered inline. */
const ACTIVE_IMAGE_TYPES = ['image/svg+xml', 'image/svg'];

export const isActiveImageType = (type?: string): boolean => {
	if (!type) {
		return false;
	}
	// Content-Type may carry parameters (`image/svg+xml; charset=utf-8`).
	const [mediaType] = type.split(';');
	return ACTIVE_IMAGE_TYPES.includes(mediaType.trim().toLowerCase());
};

/**
 * Neutralise an upload response if its media type can execute.
 *
 * Call AFTER the store has set Content-Type/Content-Disposition — this deliberately OVERWRITES the
 * disposition, and can only do that once the value it is correcting exists.
 */
export const applyActiveContentSafety = (file: { type?: string; name?: string }, res: http.ServerResponse): void => {
	if (!isActiveImageType(file.type)) {
		return;
	}

	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
	res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name || 'image.svg')}`);
};
