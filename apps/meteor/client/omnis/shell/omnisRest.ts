import { sdk } from '../../../app/utils/client/lib/SDKClient';

/**
 * Thin typed wrappers over `sdk.rest` for the Omnis widget routes.
 *
 * These routes are fork-only and therefore not declared in `rest-typings`, so
 * `useEndpoint` cannot see them and `sdk.rest.get/post` type as `never`. The
 * cast is confined to this file rather than sprinkled across every call site —
 * the same approach `client/omnis/widgets/askChi.ts` takes for `/v1/chi.ask`.
 */

type RestGet = (endpoint: string, params?: unknown) => Promise<unknown>;
type RestPost = (endpoint: string, params?: unknown) => Promise<unknown>;

export async function omnisGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
	return (await (sdk.rest.get as RestGet)(endpoint, params)) as T;
}

export async function omnisPost<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
	return (await (sdk.rest.post as RestPost)(endpoint, params)) as T;
}

/**
 * Multipart upload. Goes through `fetch` rather than `sdk.rest` because the SDK
 * serialises bodies as JSON; the auth headers are the same ones the SDK sends.
 */
export async function omnisUpload<T>(endpoint: string, form: FormData): Promise<T> {
	const userId = window.localStorage.getItem('Meteor.userId') ?? '';
	const authToken = window.localStorage.getItem('Meteor.loginToken') ?? '';

	const response = await fetch(`/api${endpoint}`, {
		method: 'POST',
		headers: { 'X-User-Id': userId, 'X-Auth-Token': authToken },
		body: form,
	});

	const body = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string } & T;
	if (!response.ok || body.success === false) {
		throw new Error(body.error ?? `Upload failed (${response.status})`);
	}
	return body;
}

// ---------------------------------------------------------------------------
// Shared matter-context types (mirror server/lib/omnis/matter.ts)
// ---------------------------------------------------------------------------

export type OmnisMatterRef = {
	matterId: string;
	matterName: string;
	matterNumber?: string;
	stageName?: string;
	source: 'channel' | 'search' | 'recent' | 'guess';
	confidence?: number;
};

export type OmnisMatterContext = {
	/** Non-null ⇒ the active screen supplies the matter; show a chip, not a picker. */
	bound: OmnisMatterRef | null;
	/** Tier 2 of the picker. A listing convenience — never pre-selected. */
	recent: OmnisMatterRef[];
};

export const fetchMatterContext = (roomId?: string): Promise<OmnisMatterContext> =>
	omnisGet<OmnisMatterContext>('/v1/omnis.matterContext', roomId ? { roomId } : {});

export const searchMatters = (q: string): Promise<{ matters: OmnisMatterRef[] }> =>
	omnisGet<{ matters: OmnisMatterRef[] }>('/v1/omnis.matterSearch', { q });
