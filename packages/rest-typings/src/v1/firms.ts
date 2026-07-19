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

export type FirmsEndpoints = {
	'/v1/firms.create': {
		POST: (params: { name: string }) => { firm: FirmInfoDTO };
	};
	'/v1/firms.mine': {
		GET: () => { enabled: boolean; firm: FirmInfoDTO | null };
	};
	'/v1/firms.invite': {
		POST: (params: { emails: string[] }) => { sent: string[]; invalid: string[]; inviteUrl: string };
	};
};
