import { Users } from '@rocket.chat/models';

import { API } from '../api';
import { runChiOrbTurn } from '../../../../server/lib/chi/admin/service';
import type { ChiOrbHistory } from '../../../../server/lib/chi/admin/service';

/**
 * Chi copilot endpoint for the floating orb. Runs ONE Chi turn AS the authenticated user (same
 * caller-scoped tools, confirm/park and audit as the @chi.bot DM) and returns the reply plus any
 * client UI actions (e.g. navigate) the orb should perform. Distinct from the DM path so orb-only
 * structured actions never leak into a chat message.
 */
API.v1.addRoute(
	'chi.ask',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 } },
	{
		async post() {
			// This route is not declared in rest-typings, so `this` types as Operations<never>.
			const { userId, bodyParams } = this as unknown as { userId: string; bodyParams: { text?: unknown; history?: unknown } };
			const text = typeof bodyParams?.text === 'string' ? bodyParams.text : '';
			if (!text.trim()) {
				return API.v1.failure('text is required');
			}
			const history: ChiOrbHistory[] = Array.isArray(bodyParams?.history)
				? (bodyParams.history as unknown[])
						.filter((h): h is { who: unknown; text: unknown } => Boolean(h) && typeof h === 'object')
						.map((h) => ({ who: h.who === 'chi' ? 'chi' : 'me', text: typeof h.text === 'string' ? h.text : '' }))
						.filter((h) => h.text)
				: [];
			const sender = await Users.findOneById(userId);
			if (!sender) {
				return API.v1.failure('user not found');
			}
			const result = await runChiOrbTurn(sender, text, history);
			return API.v1.success({ reply: result.reply, actions: result.actions, needsConfirm: result.needsConfirm });
		},
	},
);
