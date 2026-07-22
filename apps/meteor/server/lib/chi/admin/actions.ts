import { AsyncLocalStorage } from 'async_hooks';

/**
 * Client-side action bridge for Chi. Server tools run with the caller's authority and speak plain
 * strings back to the model — but some intents ("take me to #general") are UI actions the client
 * must perform. A tool records a CLIENT ACTION here; the orb endpoint (turn.ts) collects them for
 * the current turn and returns them alongside the text reply, and the orb executes them (navigate,
 * …). Decoupled from the reply text, so it is robust and never leaks a directive into the DM path
 * (which simply never opens a collector).
 *
 * AsyncLocalStorage scopes the collector to ONE turn even under concurrent requests.
 */
export type ChiClientAction =
	// Open one of the user's conversations (channel / group / DM), optionally jumping to a thread.
	| { type: 'navigate'; rid: string; name: string; t: string; tmid?: string }
	// Route the user's screen to a named app surface (home / boards / directory / search / admin / activity).
	| { type: 'route'; path: string; label?: string }
	// Open the global search UI pre-filled with a term.
	| { type: 'search'; term: string };

const store = new AsyncLocalStorage<ChiClientAction[]>();

/** Run `fn` with a fresh collector; returns the fn's result plus everything tools emitted. */
export async function withClientActions<T>(fn: () => Promise<T>): Promise<{ result: T; actions: ChiClientAction[] }> {
	const actions: ChiClientAction[] = [];
	const result = await store.run(actions, fn);
	return { result, actions };
}

/** Record a client action for the current turn. No-op outside a collector (e.g. the DM path). */
export function emitClientAction(action: ChiClientAction): void {
	store.getStore()?.push(action);
}
