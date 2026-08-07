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
	request: {
		/** Raw request body, needed for HMAC verification over the exact bytes. */
		rawBody?: string;
		headers: Record<string, string | undefined>;
	};
};

/** Narrow an Omnis route handler's `this` to the fields the API layer provides. */
export function omnisCtx(self: unknown): OmnisApiContext {
	return self as OmnisApiContext;
}
