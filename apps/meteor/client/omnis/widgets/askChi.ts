import { sdk } from '../../../app/utils/client/lib/SDKClient';
import { router } from '../../providers/RouterProvider';
import { roomCoordinator } from '../../lib/rooms/roomCoordinator';

/**
 * The Chi orb's `ask` adapter. Calls the caller-scoped Chi copilot endpoint (`/v1/chi.ask` → the
 * same tools, confirm/park and #chi-admin-audit trail as the @chi.bot DM) and EXECUTES any client
 * UI actions Chi returns — navigating the user's screen to a chat, a person's DM, or an app surface
 * (home / boards / directory) — then returns the text reply for the orb to render.
 *
 * It also tells Chi WHAT THE USER IS LOOKING AT (the open room name, parsed from the URL) so
 * context-aware commands resolve ("summarize this channel", "who's in here", "post this reply").
 * Everything stays within the user's own authority: navigate targets are resolved server-side from
 * THEIR subscriptions, and the context name is re-checked against their subscriptions before any
 * tool uses it.
 */
type ChiAction =
	| { type: 'navigate'; rid: string; name: string; t: string; tmid?: string }
	| { type: 'route'; path: string; label?: string }
	| { type: 'search'; term: string };
type ChiAskResponse = { reply?: string; actions?: ChiAction[]; needsConfirm?: boolean };
export type ChiHistory = { who: 'me' | 'chi'; text: string };

function runAction(action: ChiAction): void {
	try {
		switch (action.type) {
			case 'navigate':
				// Chi only ever returns rooms the user already belongs to (resolved server-side from
				// THEIR subscriptions), so this drives the UI within the user's own authority.
				roomCoordinator.openRouteLink(
					action.t as Parameters<typeof roomCoordinator.openRouteLink>[0],
					{ rid: action.rid, name: action.name },
					action.tmid ? { tab: 'thread', context: action.tmid } : undefined,
				);
				break;
			case 'route':
				// A named app surface (home / boards / directory / admin). SPA navigation, no reload.
				// The server only emits paths for known surfaces; the typed-router overloads can't know that.
				router.navigate(action.path as Parameters<typeof router.navigate>[0]);
				break;
			case 'search':
				// Best-effort: nudge the SPA to the directory (no global search-box setter exists).
				router.navigate('/directory');
				break;
		}
	} catch {
		/* navigation is best-effort; the text reply still lands */
	}
}

/** The conversation the user is currently viewing, parsed from the SPA URL, so Chi's context-aware
 *  tools default to it ("this channel"). Only a NAME is sent; the server re-resolves it against the
 *  user's own subscriptions, so this can never widen access. */
function currentContext(): { roomName?: string } | undefined {
	try {
		const parts = (window.location.pathname || '').split('/').filter(Boolean);
		if (parts.length >= 2 && ['channel', 'group', 'direct'].includes(parts[0])) {
			return { roomName: decodeURIComponent(parts[1]) };
		}
	} catch {
		/* ignore */
	}
	return undefined;
}

export async function askChi(text: string, history: ChiHistory[] = []): Promise<{ reply: string; needsConfirm: boolean }> {
	const res = (await (sdk.rest.post as (e: string, p: unknown) => Promise<unknown>)('/v1/chi.ask', {
		text,
		history,
		context: currentContext(),
	})) as ChiAskResponse;
	(res.actions ?? []).forEach(runAction);
	// needsConfirm drives the orb's inline Confirm/Cancel buttons (no typing "confirm").
	return { reply: res.reply || '…', needsConfirm: Boolean(res.needsConfirm) };
}
