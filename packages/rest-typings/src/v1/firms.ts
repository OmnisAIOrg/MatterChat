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

/**
 * `queued` means handed to the mail transport, NOT delivered — the mailer is
 * fire-and-forget, so delivery can never be confirmed synchronously.
 * `emailDelivery: 'unavailable'` means the workspace has no mail transport at
 * all and nothing was even attempted; `inviteUrl` is the fallback in both cases.
 */
export type FirmInviteResultDTO = {
	queued: string[];
	invalid: string[];
	undelivered: string[];
	emailDelivery: 'queued' | 'unavailable';
	inviteUrl: string;
};

export type FirmUserAssignmentDTO = {
	userId: string;
	username?: string;
	firmId: string | null;
	firmName: string | null;
	firmRole: string | null;
	/** false when the firmId has no team behind it (e.g. an OmnisAI org cohort). */
	firmTeamFound: boolean;
};

export type FirmsEndpoints = {
	'/v1/firms.create': {
		POST: (params: { name: string }) => { firm: FirmInfoDTO };
	};
	'/v1/firms.mine': {
		GET: () => { enabled: boolean; firm: FirmInfoDTO | null };
	};
	'/v1/firms.invite': {
		POST: (params: { emails: string[] }) => FirmInviteResultDTO;
	};
	'/v1/firms.setUserFirm': {
		POST: (params: {
			userId?: string;
			username?: string;
			firmId: string | null;
			firmName?: string;
			firmRole?: 'member' | 'owner';
		}) => FirmUserAssignmentDTO;
	};
};
