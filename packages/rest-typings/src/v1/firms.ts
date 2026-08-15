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

export type FirmsEndpoints = {
	'/v1/firms.create': {
		POST: (params: { name: string; practiceAreas?: string[] }) => { firm: FirmInfoDTO };
	};
	'/v1/firms.mine': {
		GET: () => { enabled: boolean; firm: FirmInfoDTO | null };
	};
	'/v1/firms.invite': {
		POST: (params: { emails: string[] }) => { sent: string[]; invalid: string[]; inviteUrl: string };
	};
	'/v1/firms.templates': {
		GET: () => { practiceAreas: PracticeAreaDTO[] };
	};
};
