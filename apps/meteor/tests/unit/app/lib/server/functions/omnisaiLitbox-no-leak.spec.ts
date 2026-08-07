/**
 * SECURITY regression test — the LitBox credential must NEVER reach a client.
 *
 * Background
 * ----------
 * When a user signs in via "Sign in with OmnisAI", the OIDC callback hands us a LitBox
 * session/refresh token. That credential is persisted on the user document on a *TOP-LEVEL*
 * field, `omnisaiLitbox` (see app/omnisai-oauth/server/loginHandler.ts), specifically so it is
 * NOT under `services.*`. The values stored are encrypted-at-rest, but the *plaintext token must
 * never be projected/serialized to the client* regardless.
 *
 * Why top-level matters: getFullUserData (app/lib/server/functions/getFullUserData.ts), which
 * backs the `users.info` REST endpoint, projects the WHOLE `services` object to the user
 * themselves via a *blacklist* (it returns `services: 1` for `myself`, then deletes only a few
 * known-sensitive sub-keys: password/passwordHistory/resume/email). Anything new under
 * `services.*` would silently leak to that user's own client. Putting the LitBox token on the
 * top-level `omnisaiLitbox` field keeps it out of that blacklist's blast radius: the projection
 * for non-`services` fields is a strict *allowlist* (defaultFields + fullFields + customFields),
 * and `omnisaiLitbox` is in none of them.
 *
 * The real, historical leak this guards against: LitBox OAuth tokens (access + refresh) were
 * exposed via `users.info` / `users.me` for the signed-in user themselves, because the token had
 * been parked under `services.omnisai` (which `users.info`'s self-view projects wholesale, and
 * which `users.me` projects via `services: 1`). The fix moved the token to the top-level
 * `omnisaiLitbox` field AND hardened both response serializers.
 *
 * What this test guards (so the above can't silently regress) — for BOTH endpoints and BOTH
 * token fields (sessionToken AND refreshToken):
 *   (a) the field projections used by getFullUserData / users.info (defaultFields, fullFields)
 *       and by the `/me` endpoint (getDefaultUserFields / getBaseUserFields) do NOT mention
 *       `omnisaiLitbox` (nor any `omnisaiLitbox.*` sub-key);
 *   (b) [users.info] a user document that DOES carry `omnisaiLitbox`, when run through the real
 *       getFullUserDataByUniqueSearchTerm projection logic (including the self-view branch that
 *       additionally projects `services: 1`), comes back WITHOUT `omnisaiLitbox`;
 *   (c) [users.me] the same secret-bearing document, when run through the REAL `users.me`
 *       response serializer (getUserInfo — app/api/server/helpers/getUserInfo.ts), comes back
 *       WITHOUT `omnisaiLitbox` and without either token value. `users.me` (misc.ts) reads the
 *       user with `getBaseUserFields() + services: 1` and pipes it through getUserInfo, so this
 *       exercises the actual serializer, not just the projection allowlist.
 *
 * Runnable: yes. This is a mocha + chai + sinon + proxyquire unit test, matching the existing
 * specs in this folder (e.g. sendUserEmail.spec.ts, getRoomByNameOrIdWithOptionToJoin.spec.ts).
 * It is picked up by `yarn testunit` via the tests/unit/app spec glob in .mocharc.js.
 * The heavy Meteor/Rocket.Chat imports are stubbed via proxyquire so the REAL projection +
 * serialization code is exercised — only the DB/permission/settings collaborators are faked.
 */
import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import mock from 'proxyquire';
import Sinon from 'sinon';

import { getDefaultUserFields } from '../../../../../../server/lib/utils/functions/getDefaultUserFields';

type ProjectionFields = Record<string, 0 | 1>;

type GetFullUserDataFn = (
	userId: string,
	searchValue: string,
	searchType: 'id' | 'username' | 'importId' | 'email' | 'freeSwitchExtension',
) => Promise<Record<string, any> | null>;

type GetUserInfoFn = (me: Record<string, any>, pullPreferences?: boolean) => Promise<Record<string, any>>;

type LoadedGetFullUserData = {
	defaultFields: ProjectionFields;
	fullFields: ProjectionFields;
	getFullUserDataByUniqueSearchTerm: GetFullUserDataFn;
};

type LoadedGetUserInfo = {
	getUserInfo: GetUserInfoFn;
};

/**
 * Minimal Mongo-projection emulator: given a `{ field: 1 }` allowlist projection, return only the
 * allowed top-level keys of the document (plus `_id`, which Mongo always returns). This lets the
 * test feed a full user doc — including the secret `omnisaiLitbox` field — through whatever
 * projection object the real getFullUserData code constructs, and observe what would actually
 * cross the wire. We deliberately only need top-level-key fidelity here, since `omnisaiLitbox` is
 * a top-level field.
 */
const applyAllowlistProjection = (doc: Record<string, any>, projection: ProjectionFields): Record<string, any> => {
	const out: Record<string, any> = {};
	if (doc._id !== undefined) {
		out._id = doc._id;
	}
	for (const key of Object.keys(projection)) {
		if (projection[key] !== 1) {
			continue;
		}
		// Only top-level keys are relevant for this guard; nested-key projections (e.g.
		// `customFields.x`) imply the parent object is present, so include the parent.
		const topLevel = key.split('.')[0];
		if (doc[topLevel] !== undefined && out[topLevel] === undefined) {
			out[topLevel] = doc[topLevel];
		}
	}
	return out;
};

const makeFullUserDataStubs = (caller: Record<string, any>, targetDoc: Record<string, any>) => {
	// findOne* helpers honor the projection so the test exercises the REAL projection object.
	const project = (opts: any) => applyAllowlistProjection(targetDoc, (opts?.projection ?? {}) as ProjectionFields);

	const UsersStub = {
		// caller lookup (line ~92 of getFullUserData) — its own narrow projection
		findOneById: Sinon.stub().callsFake(async (_id: string, opts: any) => {
			if (_id === caller._id) {
				// caller projection is fixed (username/importIds/emails/freeSwitchExtension); just
				// return the caller identity fields the function relies on for the `myself` check.
				return { ...caller };
			}
			return project(opts);
		}),
		findOneByIdOrUsername: Sinon.stub().callsFake(async (_value: string, opts: any) => project(opts)),
		findOneByImportId: Sinon.stub().callsFake(async (_value: string, opts: any) => project(opts)),
		findOneByEmailAddress: Sinon.stub().callsFake(async (_value: string, opts: any) => project(opts)),
		findOneByFreeSwitchExtension: Sinon.stub().callsFake(async (_value: string, opts: any) => project(opts)),
	};

	const LoggerStub = {
		Logger: Sinon.stub().callsFake(function (this: any) {
			this.warn = Sinon.stub();
			this.error = Sinon.stub();
		} as any),
	};

	const SettingsStub = {
		settings: {
			watch: Sinon.stub(),
			get: Sinon.stub().callsFake((key: string) => {
				if (key === 'ABAC_PDP_Type') return 'local';
				return '';
			}),
		},
	};

	const HasPermissionStub = {
		hasPermissionAsync: Sinon.stub().resolves(false),
	};

	return { UsersStub, LoggerStub, SettingsStub, HasPermissionStub };
};

const loadGetFullUserData = (caller: Record<string, any>, targetDoc: Record<string, any>): LoadedGetFullUserData => {
	const { UsersStub, LoggerStub, SettingsStub, HasPermissionStub } = makeFullUserDataStubs(caller, targetDoc);
	return mock.noCallThru().load('../../../../../../app/lib/server/functions/getFullUserData.ts', {
		'@rocket.chat/models': { Users: UsersStub },
		'@rocket.chat/logger': LoggerStub,
		'../../../authorization/server/functions/hasPermission': HasPermissionStub,
		'../../../settings/server': SettingsStub,
	}) as LoadedGetFullUserData;
};

/**
 * Load the REAL `users.me` response serializer (getUserInfo) with its heavy collaborators stubbed.
 * getUserInfo is the function that actually shapes the `users.me` payload (misc.ts calls it), so
 * running a secret-bearing doc through it is the truest test of what `users.me` returns.
 */
const loadGetUserInfo = (): LoadedGetUserInfo => {
	const SettingsStub = {
		settings: {
			get: Sinon.stub().callsFake((key: string) => {
				if (key === 'Outlook_Calendar_Enabled') return false;
				return '';
			}),
			getByRegexp: Sinon.stub().returns([]),
		},
	};

	return mock.noCallThru().load('../../../../../../app/api/server/helpers/getUserInfo.ts', {
		'@rocket.chat/core-typings': { isOAuthUser: Sinon.stub().returns(true) },
		'../../../settings/server': SettingsStub,
		'../../../utils/rocketchat.info': { Info: { version: '7.0.0' } },
		'../../../utils/server/getURL': { getURL: Sinon.stub().returns('https://example.test/avatar/jdoe') },
		'../../../utils/server/lib/getUserPreference': { getUserPreference: Sinon.stub().resolves(undefined) },
	}) as LoadedGetUserInfo;
};

const SECRET = 'omnisaiLitbox';
const SESSION_TOKEN_VALUE = 'SECRET-litbox-session-token';
const REFRESH_TOKEN_VALUE = 'SECRET-litbox-refresh-token';

describe('omnisaiLitbox must never leak to a client (users.info / users.me)', () => {
	const callerId = 'self-user-id';

	// A user document that DOES carry the secret LitBox credential, exactly as loginHandler.ts
	// persists it (top-level `omnisaiLitbox`, NOT under services.*) — both the access (session)
	// AND refresh tokens.
	const userDocWithSecret = {
		_id: callerId,
		username: 'jdoe',
		name: 'Jane Doe',
		emails: [{ address: 'jane@example.com', verified: true }],
		services: {
			omnisai: { id: 'cp-123', orgId: 'org-1', role: 'attorney' },
			password: { bcrypt: 'hash' },
			resume: { loginTokens: [{ hashedToken: 'x' }] },
		},
		omnisaiLitbox: {
			sessionToken: SESSION_TOKEN_VALUE,
			refreshToken: REFRESH_TOKEN_VALUE,
			expiresAt: 9999999999,
		},
	};

	const caller = { _id: callerId, username: 'jdoe', importIds: [], emails: userDocWithSecret.emails, freeSwitchExtension: undefined };

	const hasLitboxKey = (fields: ProjectionFields): boolean => Object.keys(fields).some((k) => k === SECRET || k.startsWith(`${SECRET}.`));

	const assertNoTokenValues = (payload: unknown, label: string): void => {
		const serialized = JSON.stringify(payload);
		expect(serialized, `${label} leaked the access/session token`).to.not.contain(SESSION_TOKEN_VALUE);
		expect(serialized, `${label} leaked the refresh token`).to.not.contain(REFRESH_TOKEN_VALUE);
	};

	let defaultFields: ProjectionFields;
	let fullFields: ProjectionFields;
	let getFullUserDataByUniqueSearchTerm: GetFullUserDataFn;
	let getUserInfo: GetUserInfoFn;

	beforeEach(() => {
		const mod = loadGetFullUserData(caller, userDocWithSecret);
		defaultFields = mod.defaultFields;
		fullFields = mod.fullFields;
		getFullUserDataByUniqueSearchTerm = mod.getFullUserDataByUniqueSearchTerm;
		getUserInfo = loadGetUserInfo().getUserInfo;
	});

	describe('(a) field projections do not include omnisaiLitbox', () => {
		it('defaultFields (used by users.info for everyone) does not project omnisaiLitbox', () => {
			expect(hasLitboxKey(defaultFields), `defaultFields leaks ${SECRET}: ${JSON.stringify(defaultFields)}`).to.equal(false);
		});

		it('fullFields (used by users.info for self / view-full-other-user-info) does not project omnisaiLitbox', () => {
			expect(hasLitboxKey(fullFields), `fullFields leaks ${SECRET}: ${JSON.stringify(fullFields)}`).to.equal(false);
		});

		it('the /me projection (getDefaultUserFields / getBaseUserFields) does not project omnisaiLitbox', () => {
			const meFields = getDefaultUserFields() as ProjectionFields;
			expect(hasLitboxKey(meFields), `/me fields leak ${SECRET}: ${JSON.stringify(meFields)}`).to.equal(false);
		});
	});

	describe('(b) users.info — a user doc carrying omnisaiLitbox comes back WITHOUT it (real projection)', () => {
		it('users.info for SELF (the highest-exposure path: also projects services:1) does not return omnisaiLitbox or either token', async () => {
			// self view => canViewAllInfo === true AND `services: 1` is added to the projection.
			// This is the worst case: if the secret were under services.* it WOULD leak here.
			const user = await getFullUserDataByUniqueSearchTerm(callerId, callerId, 'id');

			expect(user, 'expected a user document').to.not.equal(null);
			expect(user).to.not.have.property(SECRET);
			// And the sensitive services sub-keys the function strips are still stripped (sanity).
			expect(user?.services).to.not.have.property('resume');
			// JSON safety net: neither token value (access OR refresh) may appear anywhere.
			assertNoTokenValues(user, 'users.info (self)');
		});

		it('users.info for ANOTHER user (no permission) does not return omnisaiLitbox or either token', async () => {
			const user = await getFullUserDataByUniqueSearchTerm('other-caller-id', callerId, 'id');

			expect(user, 'expected a user document').to.not.equal(null);
			expect(user).to.not.have.property(SECRET);
			assertNoTokenValues(user, 'users.info (other user)');
		});
	});

	describe('(c) users.me — the real response serializer (getUserInfo) strips omnisaiLitbox + both tokens', () => {
		it('getUserInfo output (the users.me payload) does not contain omnisaiLitbox', async () => {
			// users.me (misc.ts) reads the user with getBaseUserFields() + services:1 and pipes it
			// through getUserInfo. Feed the FULL secret-bearing doc through the real serializer to
			// prove the top-level credential is dropped even when present on the input object.
			const result = await getUserInfo(userDocWithSecret, false);

			expect(result, 'expected a serialized me payload').to.not.equal(undefined);
			expect(result).to.not.have.property(SECRET);
		});

		it('getUserInfo output (the users.me payload) does not contain the access (session) token', async () => {
			const result = await getUserInfo(userDocWithSecret, false);
			expect(JSON.stringify(result), 'users.me leaked the access/session token').to.not.contain(SESSION_TOKEN_VALUE);
		});

		it('getUserInfo output (the users.me payload) does not contain the refresh token', async () => {
			const result = await getUserInfo(userDocWithSecret, false);
			expect(JSON.stringify(result), 'users.me leaked the refresh token').to.not.contain(REFRESH_TOKEN_VALUE);
		});

		it('getUserInfo still returns the safe identity fields (sanity — it strips the secret, not the user)', async () => {
			const result = await getUserInfo(userDocWithSecret, false);
			expect(result).to.have.property('username', 'jdoe');
			expect(result).to.have.property('name', 'Jane Doe');
		});
	});
});
