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

import { encryptToken } from './litboxCrypto';
import {
	claimOrgProvision,
	getOrgProvision,
	markOrgProvisionDone,
	markOrgProvisionFailed,
	provisionOrgFromRoster,
	stampFirmIdFromOrg,
} from './orgProvision';
import {
	orgIsProvisionable,
	parseOrgAdminRoles,
	parseProvisionOrgAllowlist,
	qualifiesToProvisionOrg,
	shouldSkipProvisionTrigger,
} from './orgProvisionHelpers';
import { SystemLogger } from '../../../server/lib/logger/system';

const makeError = (message: string): Record<string, any> => ({
	type: 'omnisai',
	error: new Meteor.Error(Accounts.LoginCancelledError.numericError, message),
});

export type OmnisAIProfile = {
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
		const existing = await Users.findOneByUsernameIgnoringCase(candidate, { projection: { _id: 1 } });
		if (!existing) {
			return candidate;
		}
		candidate = `${cleaned}-${n}`;
	}
	return `${cleaned}-${Date.now()}`;
}

/**
 * The ONE identity mapping for OmnisAI/CentralizedAuth subjects — find-or-create the
 * MatterChat user for a verified profile and refresh the persisted link. Shared by this
 * login handler AND the Chi session-exchange bridge (/v1/chi.session-exchange), so a
 * member lands on the SAME MatterChat account whether they arrive through the web OIDC
 * flow or a standalone Chi client: match `services.omnisai.id` (the CentralizedAuth
 * UUID == CasePro users.id) first, fall back to verified email, create otherwise.
 * Returns the MatterChat userId; token minting stays with each caller.
 */
export async function resolveOmnisaiUser(profile: OmnisAIProfile): Promise<string> {
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

	// Firm scoping (PR #166) reads `customFields.firmId` — stamp it from the org claim on
	// EVERY login (create AND revisit; both the web OIDC lane and the Chi session-exchange
	// lane funnel through here). Guarded + never-throw inside: an existing different firmId
	// (e.g. a self-serve firm's Team _id) is kept and warn-logged, never overwritten. With
	// the firms feature off this is harmless metadata (scoping stays a no-op).
	if (profile.orgId) {
		await stampFirmIdFromOrg(user._id, profile.orgId, 'login');
	}

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

	return user._id;
}

async function upsertOmnisaiUser(profile: OmnisAIProfile): Promise<{ userId: string; token: string }> {
	const userId = await resolveOmnisaiUser(profile);

	// Mint a stamped login token so Meteor establishes the session for this user.
	const stampedToken = Accounts._generateStampedLoginToken();
	await Users.addPersonalAccessTokenToUser({
		userId,
		loginTokenObject: stampedToken as unknown as IPersonalAccessToken,
	});

	return { userId, token: stampedToken.token };
}

/**
 * On the first OmnisAI login of one of an org's admins, mirror the org's CasePro
 * team into MatterChat (see orgProvision.ts — fetches the org roster and
 * pre-creates each teammate's linked, firm-stamped account). Gated + idempotent:
 *  - trigger = a WORKSPACE admin (original org-#1 behavior) OR an ORG admin per
 *    the `casepro:role` claim (env MATTERCHAT_ORG_ADMIN_ROLES, default
 *    'admin,owner') — org #2+'s admins never get MatterChat workspace-admin, so
 *    the old workspace-admin-only gate structurally dead-ended them;
 *  - done-ness lives in the per-ORG marker collection `matterchat_org_provisions`
 *    (NOT per-admin — the legacy services.omnisai.provisionedOrgId field is no
 *    longer written; orgBackfill.ts seeds markers from it once). The claim upsert
 *    is the concurrency lock; 'failed' (or stale-'pending') re-arms on the next
 *    qualifying login. To force a re-run, ops deletes the org's marker doc.
 *  - the import dedups by sub/email, so even a racing double-run is harmless.
 * Runs in the background — the login round-trip never waits on it — and never
 * throws: a provisioning hiccup must not break sign-in.
 */
async function maybeAutoProvisionOrg(userId: string, profile: OmnisAIProfile): Promise<void> {
	try {
		if (!profile.orgId) {
			return;
		}
		const user = await Users.findOne({ _id: userId }, { projection: { roles: 1 } });
		if (!user) {
			return;
		}
		const qualifies = qualifiesToProvisionOrg({
			workspaceRoles: (user as any).roles,
			orgRole: profile.role,
			orgAdminRoles: parseOrgAdminRoles(process.env.MATTERCHAT_ORG_ADMIN_ROLES),
		});
		if (!qualifies) {
			return; // only an admin bulk-provisions the team
		}

		const { orgId } = profile;
		// Optional ops containment for the widened (org-admin) trigger: when
		// MATTERCHAT_PROVISION_ORG_ALLOWLIST is set, only the listed CentralizedAuth
		// orgs may fire a roster import. Unset (the default) allows every org.
		if (!orgIsProvisionable(orgId, parseProvisionOrgAllowlist(process.env.MATTERCHAT_PROVISION_ORG_ALLOWLIST))) {
			SystemLogger.debug({ msg: 'OmnisAI auto-provision skipped: org not in MATTERCHAT_PROVISION_ORG_ALLOWLIST', orgId });
			return;
		}
		// Cheap pre-check (the common path on every later admin login): 'done', or a
		// fresh run already in flight → nothing to do without contending for the claim.
		if (shouldSkipProvisionTrigger(await getOrgProvision(orgId), new Date())) {
			return;
		}
		if (!(await claimOrgProvision(orgId, userId))) {
			return; // another login won the race (or the org just finished)
		}

		// Background: never block the login round-trip on the roster fetch + N inserts.
		setImmediate(() => {
			provisionOrgFromRoster(orgId)
				.then((result) => {
					if (result.ok) {
						return markOrgProvisionDone(orgId, result.counts);
					}
					return markOrgProvisionFailed(orgId, result.reason);
				})
				.catch(async (err) => {
					SystemLogger.error({ msg: 'OmnisAI auto-provision (deferred) failed', err });
					await markOrgProvisionFailed(orgId, err instanceof Error ? err.message : 'unknown').catch(() => undefined);
				});
		});
	} catch (err) {
		// Best-effort: a failure here must never break the login.
		SystemLogger.warn({ msg: 'OmnisAI auto-provision trigger error (login unaffected)', err });
	}
}

Accounts.registerLoginHandler('omnisai', async (loginRequest) => {
	const request = loginRequest as { omnisai?: boolean; credentialToken?: string };
	if (!request.omnisai || !request.credentialToken || typeof request.credentialToken !== 'string') {
		return undefined;
	}

	const doc = await CredentialTokens.findOneNotExpiredById(request.credentialToken);
	await CredentialTokens.removeById(request.credentialToken);

	const profile = doc?.userInfo?.profile as OmnisAIProfile | undefined;
	if (!profile?.sub) {
		return makeError('No matching OmnisAI login attempt found');
	}

	try {
		const result = await upsertOmnisaiUser(profile);
		// Fire-and-forget the team mirror (gated to first admin login w/ orgId).
		await maybeAutoProvisionOrg(result.userId, profile);
		return result;
	} catch (err: any) {
		SystemLogger.error({ msg: 'OmnisAI login handler error', err });
		return makeError(err?.message || 'OmnisAI login failed');
	}
});
