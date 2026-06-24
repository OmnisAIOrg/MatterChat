/**
 * Meteor login handler for "Sign in with OmnisAI".
 *
 * The client route /omnisai/:token calls Meteor.loginWithOmnisaiToken(token), which invokes the
 * login method with { omnisai: true, credentialToken }. Here we redeem that one-time token (stashed
 * by the /_omnisai/callback route), find-or-create the matching MatterChat user, persist the OIDC
 * `sub` as services.omnisai.id (== CasePro users.id), and hand Meteor a stamped login token so the
 * browser ends up in a real session — exactly the contract the SAML handler uses.
 */
import type { IPersonalAccessToken } from '@rocket.chat/core-typings';
import { CredentialTokens, Users } from '@rocket.chat/models';
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../../server/lib/logger/system';
import { encryptToken } from './litboxCrypto';

const makeError = (message: string): Record<string, any> => ({
	type: 'omnisai',
	error: new Meteor.Error(Accounts.LoginCancelledError.numericError, message),
});

type OmnisAIProfile = {
	sub: string;
	email?: string;
	name?: string;
	username?: string;
	orgId?: string;
	role?: string;
	// LitBox credential, captured at the OIDC callback. Server-only — persisted on the user doc
	// for the /api/litbox proxy; never published/projected to the client (verified).
	litboxSessionToken?: string;
	litboxRefreshToken?: string;
	litboxExpiresAt?: number;
};

async function uniqueUsername(base: string): Promise<string> {
	const cleaned = (base || '').replace(/[^a-zA-Z0-9._-]/g, '') || 'omnisai-user';
	let candidate = cleaned;
	for (let n = 1; n <= 50; n++) {
		// eslint-disable-next-line no-await-in-loop
		const existing = await Users.findOneByUsernameIgnoringCase(candidate, { projection: { _id: 1 } });
		if (!existing) {
			return candidate;
		}
		candidate = `${cleaned}-${n}`;
	}
	return `${cleaned}-${Date.now()}`;
}

async function upsertOmnisaiUser(profile: OmnisAIProfile): Promise<{ userId: string; token: string }> {
	let user = await Users.findOne({ 'services.omnisai.id': profile.sub });
	if (!user && profile.email) {
		user = await Users.findOneByEmailAddress(profile.email);
	}

	if (!user) {
		const username = await uniqueUsername(profile.username || (profile.email || '').split('@')[0] || `omnisai-${profile.sub.slice(0, 8)}`);
		const userId = await Accounts.insertUserDoc(
			{ skipAuthServiceDefaultRoles: true } as any,
			{
				name: profile.name || username,
				username,
				active: true,
				emails: profile.email ? [{ address: profile.email, verified: true }] : [],
				globalRoles: ['user'],
				services: { omnisai: { id: profile.sub } },
			} as any,
		);
		user = await Users.findOneById(userId);
	}

	if (!user) {
		throw new Error('Failed to create OmnisAI user');
	}

	// Persist / refresh the CasePro identity link + context on every login.
	await Users.updateOne(
		{ _id: user._id },
		{
			$set: {
				'services.omnisai.id': profile.sub,
				...(profile.orgId ? { 'services.omnisai.orgId': profile.orgId } : {}),
				...(profile.role ? { 'services.omnisai.role': profile.role } : {}),
				// LitBox credential for the /api/litbox proxy. Stored on a TOP-LEVEL field (NOT
				// under services.*) because getFullUserData projects the whole `services` object
				// to the user themselves (blacklist, not allowlist) — services.* would leak the
				// token to the browser. `omnisaiLitbox` is not in getDefaultUserFields, so no
				// publication/REST endpoint projects it. Tokens are encrypted-at-rest via
				// encryptToken (no-op until LITBOX_TOKEN_ENC_KEY is configured); the proxy decrypts.
				...(profile.litboxSessionToken ? { 'omnisaiLitbox.sessionToken': encryptToken(profile.litboxSessionToken) } : {}),
				...(profile.litboxRefreshToken ? { 'omnisaiLitbox.refreshToken': encryptToken(profile.litboxRefreshToken) } : {}),
				...(profile.litboxExpiresAt ? { 'omnisaiLitbox.expiresAt': profile.litboxExpiresAt } : {}),
			},
		},
	);

	// Bootstrap admin: stock Rocket.Chat makes the very first user an admin, but that runs in the
	// setup-wizard / password-registration path — NOT on this OmnisAI OIDC login path, which creates
	// users with globalRoles ['user']. Without this, the first person to sign in via OmnisAI lands as
	// a plain member with no admin area and nobody owns the workspace. If no admin exists yet, promote
	// this user — only ever fires while the workspace is ownerless, exactly like stock RC's first-user
	// rule (idempotent: a $addToSet, and skipped the moment any admin exists).
	const adminExists = await Users.findOne({ roles: 'admin' }, { projection: { _id: 1 } });
	if (!adminExists) {
		await Users.updateOne({ _id: user._id }, { $addToSet: { roles: 'admin' } });
		SystemLogger.info({ msg: 'OmnisAI login: promoted first user to admin (workspace had no admin)', userId: user._id });
	}

	// Mint a stamped login token so Meteor establishes the session for this user.
	const stampedToken = Accounts._generateStampedLoginToken();
	await Users.addPersonalAccessTokenToUser({
		userId: user._id,
		loginTokenObject: stampedToken as unknown as IPersonalAccessToken,
	});

	return { userId: user._id, token: stampedToken.token };
}

Accounts.registerLoginHandler('omnisai', async (loginRequest) => {
	const request = loginRequest as { omnisai?: boolean; credentialToken?: string };
	if (!request.omnisai || !request.credentialToken || typeof request.credentialToken !== 'string') {
		return undefined;
	}

	const doc = await CredentialTokens.findOneNotExpiredById(request.credentialToken);
	await CredentialTokens.removeById(request.credentialToken);

	const profile = doc?.userInfo?.profile as OmnisAIProfile | undefined;
	if (!profile || !profile.sub) {
		return makeError('No matching OmnisAI login attempt found');
	}

	try {
		return await upsertOmnisaiUser(profile);
	} catch (err: any) {
		SystemLogger.error({ msg: 'OmnisAI login handler error', err });
		return makeError(err?.message || 'OmnisAI login failed');
	}
});
