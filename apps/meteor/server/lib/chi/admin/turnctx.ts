import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-turn CONTEXT for Chi (the orb copilot). Carries what the user is currently looking at — the
 * open room — so context-aware commands resolve: "summarize THIS channel", "who's in here",
 * "create a task from this". Scoped to one turn via AsyncLocalStorage, exactly like the client-action
 * collector in actions.ts. The DM path opens no context (getChiContext() → undefined), so those tools
 * simply require an explicit channel there.
 */
export type ChiTurnContext = {
	/** The room the user is viewing, if any (resolved server-side from THEIR subscriptions). */
	rid?: string;
	roomName?: string;
	roomType?: string;
	/** A message the user has focused (for "create a task from this"), if the client sent one. */
	focusedMessageId?: string;
};

const store = new AsyncLocalStorage<ChiTurnContext>();

export async function withChiContext<T>(ctx: ChiTurnContext, fn: () => Promise<T>): Promise<T> {
	return store.run(ctx, fn);
}

export function getChiContext(): ChiTurnContext | undefined {
	return store.getStore();
}
