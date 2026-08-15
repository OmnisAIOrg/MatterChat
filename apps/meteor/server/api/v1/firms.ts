import { Users } from '@rocket.chat/models';

import { listPracticeAreas } from '../../lib/firms/firmTemplates';
import { createFirm, getFirmForUser, inviteToFirm, isSelfServeFirmsEnabled } from '../../lib/firms/firmsService';
import { API } from '../api';

/**
 * MATTERCHAT: Self-serve firms REST surface.
 *
 *  POST firms.create    — create your firm (private team) during onboarding.
 *  GET  firms.mine      — the caller's firm (or firm: null when none / feature off).
 *  POST firms.invite    — email teammates an invite link into the firm team.
 *  GET  firms.templates — practice areas the setup concierge can offer.
 *
 * Boards REST idioms: `this.userId` (never Meteor.userId() — unavailable in
 * this REST context), authorization enforced HERE in the service layer (the
 * client only hides controls). All routes no-op cleanly when
 * `Firms_SelfServe_Enabled` is off.
 */

API.v1.addRoute(
	'firms.create',
	{ authRequired: true },
	{
		async post() {
			const { name, practiceAreas } = this.bodyParams as { name?: unknown; practiceAreas?: unknown };
			const firm = await createFirm(this.userId, name, { practiceAreas });
			return API.v1.success({ firm });
		},
	},
);

API.v1.addRoute(
	'firms.templates',
	{ authRequired: true },
	{
		async get() {
			// Static data, but authenticated: the practice-area list is a hint about
			// what this product is for, and there is no reason to serve it to
			// anonymous callers.
			return API.v1.success({ practiceAreas: listPracticeAreas() });
		},
	},
);

API.v1.addRoute(
	'firms.mine',
	{ authRequired: true },
	{
		async get() {
			if (!isSelfServeFirmsEnabled()) {
				return API.v1.success({ enabled: false, firm: null });
			}
			const user = await Users.findOneById(this.userId);
			if (!user) {
				return API.v1.unauthorized();
			}
			const firm = await getFirmForUser(user);
			return API.v1.success({ enabled: true, firm });
		},
	},
);

API.v1.addRoute(
	'firms.invite',
	{ authRequired: true },
	{
		async post() {
			const { emails } = this.bodyParams as { emails?: unknown };
			const result = await inviteToFirm(this.userId, emails);
			return API.v1.success(result);
		},
	},
);
