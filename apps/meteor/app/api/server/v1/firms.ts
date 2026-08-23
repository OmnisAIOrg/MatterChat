import { Users } from '@rocket.chat/models';

import { createFirm, getFirmForUser, inviteToFirm, isSelfServeFirmsEnabled, setUserFirm } from '../../../../server/lib/firms/firmsService';
// MATTERCHAT: side-effect import — registers the beforeCreateRoom firmId stamp at boot
import '../../../../server/lib/firms/stampRoomFirmId';
import { API } from '../api';

/**
 * MATTERCHAT: Self-serve firms REST surface.
 *
 *  POST firms.create      — create your firm (private team) during onboarding.
 *  GET  firms.mine        — the caller's firm (or firm: null when none / feature off).
 *  POST firms.invite      — email teammates an invite link into the firm team.
 *  POST firms.setUserFirm — ADMIN: stamp / move / clear a user's firm membership.
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
			const { name } = this.bodyParams as { name?: unknown };
			const firm = await createFirm(this.userId, name);
			return API.v1.success({ firm });
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

/**
 * The only supported write path for firm membership. The admin check lives in
 * the service (like every other firms route); `edit-other-user-info` is declared
 * here too so the route is refused at the API layer for anyone who could not
 * edit the target user through the stock admin surface either.
 */
API.v1.addRoute(
	'firms.setUserFirm',
	{ authRequired: true, permissionsRequired: ['edit-other-user-info'] },
	{
		async post() {
			const { userId, username, firmId, firmName, firmRole } = this.bodyParams as {
				userId?: unknown;
				username?: unknown;
				firmId?: unknown;
				firmName?: unknown;
				firmRole?: unknown;
			};
			const result = await setUserFirm(this.userId, { userId, username, firmId, firmName, firmRole });
			return API.v1.success(result);
		},
	},
);
