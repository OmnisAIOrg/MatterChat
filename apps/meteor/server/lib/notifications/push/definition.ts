import type { ApnCertificateAuthConfig, ApnTokenAuthConfig } from './apnConfig';

export type PushOptions = {
	sendTimeout?: number;
	production?: boolean;
	// MATTERCHAT: `apn` used to be certificate-only ({ passphrase, key, cert, gateway }); it is now
	// a union so token (.p8) auth can be configured too. See ./apnConfig.ts.
	apn?: ApnCertificateAuthConfig | ApnTokenAuthConfig;
	gcm?: {
		apiKey: string;
		projectNumber: string;
	};
	gateways?: string[];
	uniqueId: string;
	getAuthorization?: () => Promise<string>;
};

export type PendingPushNotification = {
	from?: string;
	title?: string;
	text?: string;
	badge?: number;
	sound?: string;
	notId?: number;
	apn?: {
		category?: string;
		expirationSeconds?: number;
	};
	gcm?: {
		style?: string;
		image?: string;
	};
	payload?: Record<string, any>;
	createdAt: Date;
	createdBy?: string;

	userId: string;

	sent?: boolean;
	sending?: number;
	priority?: number;

	contentAvailable?: 1 | 0;
	useVoipToken?: boolean;
};
