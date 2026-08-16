/**
 * MATTERCHAT: the one correct way to answer with a text body we built in memory.
 *
 * ## Why this exists as a shared function rather than two inline lines
 *
 * Both places that serve generated CSS/JS — app/ui-master/server/inject.ts (the `css-theme`
 * and custom-script routes) and app/theme/server/server.ts (`/theme.css`) — declared
 * `Content-Length: content.length` and then wrote the body as UTF-8.
 *
 * `String.prototype.length` counts UTF-16 code units. UTF-8 needs 2-4 bytes for anything
 * outside ASCII. So a single non-ASCII character anywhere in a workspace's custom CSS makes
 * the declared length SHORTER than the body. On production it was one em dash, in a comment
 * at the top of the brand CSS: 510 characters, 512 bytes.
 *
 * HTTP/1.1 shrugs at the mismatch. HTTP/2 does not — it enforces content-length and kills the
 * stream, so the browser receives ZERO bytes and reports ERR_HTTP2_PROTOCOL_ERROR. The
 * casualty is a render-blocking `<link rel="stylesheet">` in `<head>`, which means the whole
 * app stalls on a stylesheet that is never going to arrive. It presents as "the site won't
 * load", it only reproduces over HTTP/2 (i.e. through the load balancer, never against a local
 * dev server), and it is invisible to `curl` unless you force `--http2`.
 *
 * Two call sites, one subtle rule, and a failure mode that cannot reproduce in development is
 * exactly the shape of thing that comes back. So the rule lives in one tested function.
 */

export type TextResponse = {
	/** The bytes to write. Already encoded — do not re-encode at the call site. */
	body: Buffer;
	/** What to declare as Content-Length. Always the BYTE count. */
	contentLength: number;
};

/**
 * Encode a generated text body and give back the byte count to declare with it.
 *
 * Always pass `body` to `res.write`/`res.end` — handing the original string back to Node would
 * re-encode it and reopen the door this closes.
 */
export function textResponse(content: string): TextResponse {
	const body = Buffer.from(content, 'utf-8');
	return { body, contentLength: body.byteLength };
}
