/**
 * MATTERCHAT: pure resolver for the direct (self-hosted) APNs provider credentials.
 *
 * Apple supports two provider-authentication mechanisms:
 *
 *  - **certificate** auth — the legacy `.p12`/PEM key + cert pair. This is what upstream
 *    Rocket.Chat supports and it remains the default so existing deployments are untouched.
 *  - **token** auth — a `.p8` ES256 private key plus its Key ID and the Apple Team ID.
 *    `@parse/node-apn` takes this as `{ token: { key, keyId, teamId } }` instead of
 *    `{ key, cert, passphrase }`.
 *
 * This module is deliberately **pure**: no meteor, no models, no settings imports. It takes the
 * raw setting/env strings and returns the object that should be handed to `Push.configure({ apn })`
 * (and from there to `new apn.Provider(...)`), or `undefined` when the credentials are not
 * usable — matching the pre-existing "blank certs ⇒ APNs silently off" behaviour.
 */

export type ApnProviderToken = {
	key: string;
	keyId: string;
	teamId: string;
};

export type ApnTokenAuthConfig = {
	token: ApnProviderToken;
	production: boolean;
	topic?: string;
	gateway?: string;
};

export type ApnCertificateAuthConfig = {
	passphrase?: string;
	key: string;
	cert: string;
	production: boolean;
	topic?: string;
	gateway?: string;
};

export type ApnAuthConfig = ApnTokenAuthConfig | ApnCertificateAuthConfig | undefined;

export type ApnAuthType = 'certificate' | 'token';

/**
 * Legacy binary-protocol hostname. `@parse/node-apn` v8 speaks HTTP/2 and ignores this entirely —
 * it derives the endpoint from `production` — but the original code set it and `initAPN` still
 * keys its "development mode" warning off it, so it is preserved verbatim for certificate auth.
 */
export const APN_SANDBOX_GATEWAY = 'gateway.sandbox.push.apple.com';

const trimmed = (value?: string): string => (typeof value === 'string' ? value.trim() : '');

/** Anything that is not exactly `token` (case/whitespace-insensitive) falls back to certificate auth. */
export const normalizeApnAuthType = (authType?: string): ApnAuthType =>
	trimmed(authType).toLowerCase() === 'token' ? 'token' : 'certificate';

export type ResolveApnConfigInput = {
	authType?: string;
	production?: boolean;
	/** certificate auth, production credentials */
	passphrase?: string;
	key?: string;
	cert?: string;
	/** certificate auth, sandbox credentials */
	devPassphrase?: string;
	devKey?: string;
	devCert?: string;
	/** token auth — contents of the `.p8`, its Key ID and the Apple Team ID */
	tokenKey?: string;
	tokenKeyId?: string;
	teamId?: string;
	/** APNs topic, i.e. the iOS bundle id. Optional; see `resolveApnTopic`. */
	bundleId?: string;
};

export const resolveApnConfig = (input: ResolveApnConfigInput): ApnAuthConfig => {
	const production = input.production === true;
	const topic = trimmed(input.bundleId) || undefined;

	if (normalizeApnAuthType(input.authType) === 'token') {
		const key = trimmed(input.tokenKey);
		const keyId = trimmed(input.tokenKeyId);
		const teamId = trimmed(input.teamId);

		// Same graceful degradation as the certificate path: incomplete credentials ⇒ APNs off.
		if (!key || !keyId || !teamId) {
			return undefined;
		}

		return {
			token: { key, keyId, teamId },
			production,
			...(topic && { topic }),
		};
	}

	// Certificate auth — byte-for-byte the pre-existing behaviour: production credentials when
	// `Push_production` is true, otherwise the `_dev_` credentials plus the sandbox gateway.
	// Values are intentionally NOT trimmed (PEM blocks are whitespace-sensitive); only the
	// emptiness check trims.
	const certificate: Omit<ApnCertificateAuthConfig, 'production'> = production
		? {
				passphrase: input.passphrase ?? '',
				key: input.key ?? '',
				cert: input.cert ?? '',
			}
		: {
				passphrase: input.devPassphrase ?? '',
				key: input.devKey ?? '',
				cert: input.devCert ?? '',
				gateway: APN_SANDBOX_GATEWAY,
			};

	if (!certificate.key || certificate.key.trim() === '' || !certificate.cert || certificate.cert.trim() === '') {
		return undefined;
	}

	return {
		...certificate,
		production,
		...(topic && { topic }),
	};
};

/**
 * Resolve the APNs topic for an outgoing notification.
 *
 * Upstream derives the topic from `IPushToken.appName`, which is whatever the mobile client sent
 * when it registered its device token. That is fine for certificate auth (APNs can infer the topic
 * from the certificate) but token auth **requires** a correct topic — a mismatch is rejected with
 * `MissingTopic`/`TopicDisallowed`. So when an admin has explicitly configured the bundle id for
 * this workspace it wins over the client-reported value; when it is unset (the default) the
 * client-reported topic is used exactly as before.
 */
export const resolveApnTopic = ({
	topic,
	useVoipToken,
	configuredBundleId,
}: {
	topic: string;
	useVoipToken?: boolean;
	configuredBundleId?: string;
}): string => {
	const bundleId = trimmed(configuredBundleId);

	if (!bundleId) {
		return topic;
	}

	return useVoipToken ? `${bundleId}.voip` : bundleId;
};
