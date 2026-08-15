import { Users } from '@rocket.chat/models';

import { claimFirmDomain, listFirmDomains, removeFirmDomain, verifyFirmDomain } from '../../lib/firms/firmDomains';
import { listPracticeAreas } from '../../lib/firms/firmTemplates';
import {
	createFirm,
	getFirmForUser,
	inviteToFirm,
	isSelfServeFirmsEnabled,
	listFirmInvites,
	revokeFirmInvite,
} from '../../lib/firms/firmsService';
import { API } from '../api';

/**
 * MATTERCHAT: Self-serve firms REST surface.
 *
 *  POST firms.create          — create your firm (private team) during onboarding.
 *  GET  firms.mine            — the caller's firm (or firm: null when none / feature off).
 *  POST firms.invite          — email teammates an invite link into the firm team.
 *  GET  firms.templates       — practice areas the setup concierge can offer.
 *  GET  firms.invites.list    — the firm's live invite links (owner/admin).
 *  POST firms.invites.revoke  — delete one invite link (owner/admin).
 *  POST firms.domains.claim   — claim an email domain; sends the verification email.
 *  POST firms.domains.verify  — consume a verification token.
 *  GET  firms.domains.list    — the firm's domain claims (owner/admin).
 *  POST firms.domains.remove  — release a claimed domain (owner/admin).
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
			const { emails, days, maxUses } = this.bodyParams as { emails?: unknown; days?: unknown; maxUses?: unknown };
			const result = await inviteToFirm(this.userId, emails, { days, maxUses });
			return API.v1.success(result);
		},
	},
);

API.v1.addRoute(
	'firms.invites.list',
	{ authRequired: true },
	{
		async get() {
			const invites = await listFirmInvites(this.userId);
			return API.v1.success({ invites });
		},
	},
);

API.v1.addRoute(
	'firms.invites.revoke',
	{ authRequired: true },
	{
		async post() {
			const { inviteId } = this.bodyParams as { inviteId?: unknown };
			const result = await revokeFirmInvite(this.userId, inviteId);
			return API.v1.success(result);
		},
	},
);

API.v1.addRoute(
	'firms.domains.claim',
	{ authRequired: true },
	{
		async post() {
			const { domain, verificationEmail } = this.bodyParams as { domain?: unknown; verificationEmail?: unknown };
			const result = await claimFirmDomain(this.userId, domain, verificationEmail);
			return API.v1.success(result);
		},
	},
);

API.v1.addRoute(
	'firms.domains.verify',
	{ authRequired: true },
	{
		async post() {
			// The token — mailed to an address at the domain — is the proof of
			// control; `authRequired` is here to stop anonymous token grinding, not
			// to identify the verifier (a shared mailbox is rarely the owner's).
			const { token } = this.bodyParams as { token?: unknown };
			const domain = await verifyFirmDomain(token);
			return API.v1.success({ domain });
		},
	},
);

API.v1.addRoute(
	'firms.domains.list',
	{ authRequired: true },
	{
		async get() {
			const domains = await listFirmDomains(this.userId);
			return API.v1.success({ domains });
		},
	},
);

API.v1.addRoute(
	'firms.domains.remove',
	{ authRequired: true },
	{
		async post() {
			const { domainId } = this.bodyParams as { domainId?: unknown };
			const result = await removeFirmDomain(this.userId, domainId);
			return API.v1.success(result);
		},
	},
);
