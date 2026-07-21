import { sdk } from '../../../app/utils/client/lib/SDKClient';
import { roomCoordinator } from '../../lib/rooms/roomCoordinator';

/**
 * The Chi orb's `ask` adapter. Calls the caller-scoped Chi copilot endpoint (`/v1/chi.ask` → the
 * same tools, confirm/park and #chi-admin-audit trail as the @chi.bot DM) and EXECUTES any client
 * UI actions Chi returns — e.g. navigating the user's screen to the chat they asked for — then
 * returns the text reply for the orb to render.
 */
type ChiAction = { type: 'navigate'; rid: string; name: string; t: string } | { type: 'search'; term: string };
type ChiAskResponse = { reply?: string; actions?: ChiAction[] };
export type ChiHistory = { who: 'me' | 'chi'; text: string };

function runAction(action: ChiAction): void {
	try {
		if (action.type === 'navigate') {
			// Chi only ever returns rooms the user already belongs to (resolved server-side from THEIR
			// subscriptions), so this drives the UI within the user's own authority.
			roomCoordinator.openRouteLink(action.t as Parameters<typeof roomCoordinator.openRouteLink>[0], {
				rid: action.rid,
				name: action.name,
			});
		}
	} catch {
		/* navigation is best-effort; the text reply still lands */
	}
}

export async function askChi(text: string, history: ChiHistory[] = []): Promise<string> {
	const res = (await (sdk.rest.post as (e: string, p: unknown) => Promise<unknown>)('/v1/chi.ask', {
		text,
		history,
	})) as ChiAskResponse;
	(res.actions ?? []).forEach(runAction);
	return res.reply || '…';
}
