/**
 * Typed access to `this` inside an Omnis REST handler.
 *
 * The Omnis routes are fork-only and therefore not declared in `rest-typings`,
 * so `API.v1.addRoute` types their handler `this` as `Operations<never, …>` —
 * a shape with no `userId`, `bodyParams`, `queryParams`, `user` or `request` on
 * it at all. Every access is a TS2339 without a cast.
 *
 * `server/api/v1/chi.ts` established the workaround inline:
 *
 *     const { userId, bodyParams } = this as unknown as { userId: string; bodyParams: {…} };
 *
 * This module is the same cast, hoisted so there is ONE place doing it and one
 * place to delete when these routes are eventually declared in rest-typings.
 * Confining it also keeps the honesty of the cast visible: the fields really
 * are present at runtime (the API layer populates them before dispatch), the
 * types simply cannot see them.
 *
 * Note what is deliberately NOT loosened: `bodyParams` stays `unknown`-valued,
 * so every handler still has to narrow its own inputs. Widening it to `any`
 * here would silently turn unvalidated request data into trusted values.
 */
export type OmnisApiContext = {
	/** Always present on `authRequired: true` routes; empty string on public ones. */
	userId: string;
	user?: { _id: string; username?: string };
	queryParams: Record<string, string | undefined>;
	bodyParams: Record<string, unknown>;
	/**
	 * Typed as the global `Request` because that is what `getUploadFormData`
	 * accepts. At runtime this is the Express request, which also carries
	 * `rawBody` and a plain-object `headers` — see {@link omnisRawRequest} for
	 * reaching those without loosening this type for every caller.
	 */
	request: Request;
};

/**
 * The webhook-only view of the request: the RAW body and plain headers.
 *
 * Signing must be verified over the exact bytes received — re-serialising the
 * parsed body would change key order and whitespace, and the HMAC would never
 * match. Kept separate from {@link OmnisApiContext} so only the code that
 * genuinely needs the Express shape asserts it.
 */
export type OmnisRawRequest = {
	rawBody?: string;
	headers: Record<string, string | undefined>;
};

export function omnisRawRequest(self: unknown): OmnisRawRequest {
	return (self as { request: unknown }).request as OmnisRawRequest;
}

/** Narrow an Omnis route handler's `this` to the fields the API layer provides. */
export function omnisCtx(self: unknown): OmnisApiContext {
	return self as OmnisApiContext;
}
