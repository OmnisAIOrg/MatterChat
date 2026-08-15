/**
 * REST endpoint types for MatterChat self-serve firms
 * (public signup → create firm → invite teammates).
 *
 * Validation happens server-side in the service layer
 * (apps/meteor/server/lib/firms/firmsService.ts); these types exist so the
 * client can use `useEndpoint` with full typing.
 */

export type FirmInfoDTO = {
	firmId: string;
	name: string;
	roomId: string;
	isOwner: boolean;
};

/** A practice area offered by the setup concierge. Channel layout stays server-side. */
export type PracticeAreaDTO = {
	id: string;
	label: string;
};

/**
 * A live invite link into the firm's team. `maxUses: 0` = unlimited,
 * `expires: null` = never expires.
 */
export type FirmInviteDTO = {
	_id: string;
	url: string;
	days: number;
	maxUses: number;
	uses: number;
	createdAt: string;
	expires: string | null;
	createdBy: string;
};

/**
 * A claimed email domain. Auto-join only happens once `verified` is true —
 * until then the claim is inert.
 */
export type FirmDomainDTO = {
	_id: string;
	domain: string;
	verified: boolean;
	/** The address at the domain the verification link was mailed to. */
	verificationEmail?: string;
	verificationExpiresAt?: string;
	createdAt: string;
	verifiedAt?: string;
};

export type FirmsEndpoints = {
	'/v1/firms.create': {
		POST: (params: { name: string; practiceAreas?: string[] }) => { firm: FirmInfoDTO };
	};
	'/v1/firms.mine': {
		GET: () => { enabled: boolean; firm: FirmInfoDTO | null };
	};
	'/v1/firms.invite': {
		/**
		 * `days` must be one of 0, 1, 7, 15, 30 and `maxUses` one of
		 * 0, 1, 5, 10, 25, 50, 100 — the whitelists findOrCreateInvite enforces.
		 * Out-of-whitelist values are rejected, never rounded. Omit for the
		 * defaults (15 days, unlimited uses).
		 */
		POST: (params: { emails: string[]; days?: number; maxUses?: number }) => {
			sent: string[];
			invalid: string[];
			inviteUrl: string;
			inviteId: string;
			days: number;
			maxUses: number;
		};
	};
	'/v1/firms.templates': {
		GET: () => { practiceAreas: PracticeAreaDTO[] };
	};
	'/v1/firms.invites.list': {
		GET: () => { invites: FirmInviteDTO[] };
	};
	'/v1/firms.invites.revoke': {
		POST: (params: { inviteId: string }) => { revoked: boolean };
	};
	'/v1/firms.domains.claim': {
		/**
		 * `verificationEmail` must be an address AT `domain`; omit it to use the
		 * caller's own address when that already is.
		 */
		POST: (params: { domain: string; verificationEmail?: string }) => { domain: FirmDomainDTO; sentTo: string };
	};
	'/v1/firms.domains.verify': {
		POST: (params: { token: string }) => { domain: FirmDomainDTO };
	};
	'/v1/firms.domains.list': {
		GET: () => { domains: FirmDomainDTO[] };
	};
	'/v1/firms.domains.remove': {
		POST: (params: { domainId: string }) => { removed: boolean };
	};
};
