import { Users } from '@rocket.chat/models';

import { API } from '../api';

/**
 * Hands the client the logged-in user's OmnisAI subject (services.omnisai.id). Rocket.Chat does NOT
 * publish the `services` block to the browser, so the Cross-firm panel reads it here to key the
 * cross-firm network on the user's STABLE CentralizedAuth identity (not the per-instance Meteor _id).
 */
API.v1.addRoute(
	'cross-firm.identity',
	{ authRequired: true },
	{
		async get() {
			const user = await Users.findOneById(this.userId, { projection: { 'services.omnisai': 1, name: 1, username: 1 } });
			const omnisai = (user as any)?.services?.omnisai || {};
			return API.v1.success({
				userId: this.userId,
				omnisaiId: omnisai.id || null,
				name: user?.name || user?.username || this.userId,
			});
		},
	},
);
