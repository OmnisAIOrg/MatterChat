/**
 * SECURITY regression test — the LitBox credential must NEVER reach a client.
 *
 * Background
 * ----------
 * When a user signs in via "Sign in with OmnisAI", the OIDC callback hands us a LitBox
 * session/refresh token. That credential is persisted on the user document on a *TOP-LEVEL*
 * field, `omnisaiLitbox` (see app/omnisai-oauth/server/loginHandler.ts), specifically so it is
 * NOT under `services.*`.
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
 * THE SECOND LEAK PATH (this is what the latest fix closed, and what the earlier version of
 * this test MISSED):
 *   `users.updateOwnBasicInfo` (app/api/server/v1/users.ts ~line 221) does NOT go through the
 *   allowlist path above. It re-reads the user with the *EXCLUSION* projection
 *   `API.v1.defaultFieldsToExclude` (a blacklist, defined in app/api/server/ApiClass.ts ~line
 *   203) and feeds the result to `getUserInfo` (app/api/server/helpers/getUserInfo.ts), which
 *   serializes it to the client with a bare `...me`. Because that projection is an EXCLUSION
 *   list, anything NOT explicitly excluded passes through — so `omnisaiLitbox` leaked.
 *
 *   The fix has two layers (both asserted below):
 *     (1) `defaultFieldsToExclude` now contains `omnisaiLitbox: 0` (drop it at the DB read).
 *     (2) `getUserInfo` now destructures `omnisaiLitbox` out before serializing (defense in
 *         depth: even a caller that reads the user WITHOUT that projection can't leak it).
 *
 * What this test guards (so the above can't silently regress):
 *   (a) the field projections used by getFullUserData / users.info (defaultFields, fullFields)
 *       and by the `/me` endpoint (getDefaultUserFields / getBaseUserFields) do NOT mention
 *       `omnisaiLitbox` (nor any `omnisaiLitbox.*` sub-key);
 *   (b) a user document that DOES carry `omnisaiLitbox`, when run through the real
 *       getFullUserDataByUniqueSearchTerm projection logic (including the self-view branch that
 *       additionally projects `services: 1`), comes back WITHOUT `omnisaiLitbox`.
 *   (c) [updateOwnBasicInfo exclusion path, layer 1] `API.v1.defaultFieldsToExclude` (read from
 *       the REAL ApiClass) contains `omnisaiLitbox: 0`, so the DB read in updateOwnBasicInfo
 *       drops the credential.
 *   (d) [updateOwnBasicInfo serializer, layer 2] the REAL `getUserInfo`, given a user object
 *       carrying `omnisaiLitbox` (shaped exactly as loginHandler persists it), returns an object
 *       with NO `omnisaiLitbox` key and the literal secret strings nowhere in the payload.
 *
 * Runnable: yes. This is a mocha + chai + sinon + proxyquire unit test, matching the existing
 * specs in this folder (e.g. sendUserEmail.spec.ts, getRoomByNameOrIdWithOptionToJoin.spec.ts).
 * It is picked up by `yarn testunit` via the tests/unit/app spec glob in .mocharc.js.
 * The heavy Meteor/Rocket.Chat imports are stubbed via proxyquire so the REAL projection code
 * (defaultFields/fullFields, the projection object built in getFullUserDataByUniqueSearchTerm,
 * the real defaultFieldsToExclude in ApiClass, and the real getUserInfo serializer) is exercised
 * — only the DB/permission/settings/url collaborators are faked.
 *
 * To confirm these assertions aren't trivially green: revert either layer of the fix and the
 * corresponding case fails — drop `omnisaiLitbox: 0` from ApiClass.defaultFieldsToExclude and (c)
 * fails; remove the destructure in getUserInfo and (d) fails.
 *
 * Run just this file:
 *   TZ=UTC TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' \
 *     npx mocha --config ./.mocharc.js --grep 'omnisaiLitbox'
 */
import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import mock from 'proxyquire';
import Sinon from 'sinon';

import { getDefaultUserFields } from '../../../../../../app/utils/server/functions/getDefaultUserFields';

type ProjectionFields = Record<string, 0 | 1>;

type GetFullUserDataFn = (
	userId: string,
	searchValue: string,
	searchType: 'id' | 'username' | 'importId' | 'email' | 'freeSwitchExtension',
) => Promise<Record<string, any> | null>;

type LoadedModule = {
	defaultFields: ProjectionFields;
	fullFields: ProjectionFields;
	getFullUserDataByUniqueSearchTerm: GetFullUserDataFn;
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

const makeStubs = (caller: Record<string, any>, targetDoc: Record<string, any>) => {
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

const loadModule = (caller: Record<string, any>, targetDoc: Record<string, any>): LoadedModule => {
	const { UsersStub, LoggerStub, SettingsStub, HasPermissionStub } = makeStubs(caller, targetDoc);
	return mock.noCallThru().load('../../../../../../app/lib/server/functions/getFullUserData.ts', {
		'@rocket.chat/models': { Users: UsersStub },
		'@rocket.chat/logger': LoggerStub,
		'../../../authorization/server/functions/hasPermission': HasPermissionStub,
		'../../../settings/server': SettingsStub,
	}) as LoadedModule;
};

/**
 * Load the REAL ApiClass and instantiate APIClass so we can read the actual
 * `defaultFieldsToExclude` instance property the running server uses. Every heavy Meteor /
 * Rocket.Chat import the module pulls in at load time is stubbed via proxyquire.noCallThru(); the
 * constructor itself only needs `RocketChatAPIRouter` (stubbed to a no-op) and runs with
 * `useDefaultAuth: false` so `_initAuth()` is skipped. This exercises the real projection object
 * — not a copy — so it fails if `omnisaiLitbox: 0` is ever removed from ApiClass.ts.
 */
const loadDefaultFieldsToExclude = (): ProjectionFields => {
	const noop = Sinon.stub();
	const Settings = {
		settings: { get: Sinon.stub().returns(undefined), getByRegexp: Sinon.stub().returns([]), watch: noop },
	};
	const RouterStub = {
		RocketChatAPIRouter: Sinon.stub().callsFake(function (this: any) {
			// minimal router surface touched by the constructor (none beyond construction)
		} as any),
	};
	const { APIClass } = mock.noCallThru().load('../../../../../../app/api/server/ApiClass.ts', {
		'@rocket.chat/license': { License: {} },
		'@rocket.chat/logger': { Logger: Sinon.stub().callsFake(function (this: any) {}) },
		'@rocket.chat/models': { Users: {} },
		'@rocket.chat/random': { Random: { id: () => 'rid' } },
		'@rocket.chat/rest-typings': { ajv: {} },
		'@rocket.chat/tools': { wrapExceptions: (fn: any) => fn },
		'meteor/accounts-base': { Accounts: {} },
		'meteor/ddp': { DDP: {} },
		'meteor/ddp-common': { DDPCommon: {} },
		'meteor/meteor': { Meteor: {} },
		'meteor/rate-limit': { RateLimiter: Sinon.stub() },
		'underscore': {},
		'./api.helpers': { checkPermissions: noop, parseDeprecation: noop },
		'./helpers/getUserInfo': { getUserInfo: noop },
		'./helpers/parseJsonQuery': { parseJsonQuery: noop },
		'./middlewares/authenticationHono': { authenticationMiddlewareForHono: noop },
		'./middlewares/permissions': { permissionsMiddleware: noop },
		'./router': RouterStub,
		'../../../ee/app/api-enterprise/server/middlewares/license': { license: noop },
		'../../../lib/utils/isObject': { isObject: noop },
		'../../../server/lib/getNestedProp': { getNestedProp: noop },
		'../../../server/lib/shouldBreakInVersion': { shouldBreakInVersion: () => false },
		'../../2fa/server/code': { checkCodeForUser: noop },
		'../../authorization/server/functions/hasPermission': { hasPermissionAsync: noop },
		'../../lib/server/lib/notifyListener': { notifyOnUserChangeAsync: noop },
		'../../settings/server': Settings,
		'../../utils/server/functions/getDefaultUserFields': { getDefaultUserFields: () => ({}) },
	}) as { APIClass: new (props: any) => { defaultFieldsToExclude: ProjectionFields } };

	const api = new APIClass({ apiPath: '', useDefaultAuth: false, prettyJson: false });
	return api.defaultFieldsToExclude;
};

type GetUserInfoFn = (me: Record<string, any>, pullPreferences?: boolean) => Promise<Record<string, any>>;

/**
 * Load the REAL getUserInfo serializer with its async/Meteor collaborators stubbed:
 *   - settings.getByRegexp -> [] so no default user preferences are fetched
 *   - settings.get -> undefined so the Outlook-calendar branch stays disabled
 *   - getURL -> a fixed string (no Site_Url settings needed)
 *   - getUserPreference -> never called (getByRegexp is empty), stubbed defensively
 *   - isOAuthUser -> false (deterministic)
 *   - Info -> minimal (only touched if `me.banners` exists; we don't set banners)
 * This runs the genuine `...me` spread + the `omnisaiLitbox` destructure, so it fails if the
 * destructure is removed.
 */
const loadGetUserInfo = (): GetUserInfoFn => {
	const SettingsStub = {
		settings: {
			get: Sinon.stub().returns(undefined),
			getByRegexp: Sinon.stub().returns([] as [string, unknown][]),
		},
	};
	const mod = mock.noCallThru().load('../../../../../../app/api/server/helpers/getUserInfo.ts', {
		'@rocket.chat/core-typings': { isOAuthUser: () => false },
		'semver': { valid: () => true, lte: () => false },
		'../../../settings/server': SettingsStub,
		'../../../utils/rocketchat.info': { Info: { version: '0.0.0' } },
		'../../../utils/server/getURL': { getURL: () => 'https://example.test/avatar' },
		'../../../utils/server/lib/getUserPreference': { getUserPreference: Sinon.stub().resolves(undefined) },
	}) as { getUserInfo: GetUserInfoFn };
	return mod.getUserInfo;
};

const SECRET = 'omnisaiLitbox';

describe('omnisaiLitbox must never leak to a client (users.info / getFullUserData / /me)', () => {
	const callerId = 'self-user-id';

	// A user document that DOES carry the secret LitBox credential, exactly as loginHandler.ts
	// persists it (top-level `omnisaiLitbox`, NOT under services.*).
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
			sessionToken: 'SECRET-litbox-session-token',
			refreshToken: 'SECRET-litbox-refresh-token',
			expiresAt: 9999999999,
		},
	};

	const caller = { _id: callerId, username: 'jdoe', importIds: [], emails: userDocWithSecret.emails, freeSwitchExtension: undefined };

	const hasLitboxKey = (fields: ProjectionFields): boolean =>
		Object.keys(fields).some((k) => k === SECRET || k.startsWith(`${SECRET}.`));

	let defaultFields: ProjectionFields;
	let fullFields: ProjectionFields;
	let getFullUserDataByUniqueSearchTerm: GetFullUserDataFn;

	beforeEach(() => {
		const mod = loadModule(caller, userDocWithSecret);
		defaultFields = mod.defaultFields;
		fullFields = mod.fullFields;
		getFullUserDataByUniqueSearchTerm = mod.getFullUserDataByUniqueSearchTerm;
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

	describe('(b) a user doc carrying omnisaiLitbox comes back WITHOUT it through the real projection', () => {
		it('users.info for SELF (the highest-exposure path: also projects services:1) does not return omnisaiLitbox', async () => {
			// self view => canViewAllInfo === true AND `services: 1` is added to the projection.
			// This is the worst case: if the secret were under services.* it WOULD leak here.
			const user = await getFullUserDataByUniqueSearchTerm(callerId, callerId, 'id');

			expect(user, 'expected a user document').to.not.equal(null);
			expect(user).to.not.have.property(SECRET);
			// And the sensitive services sub-keys the function strips are still stripped (sanity).
			expect(user?.services).to.not.have.property('resume');
			// JSON safety net: the literal secret value must not appear anywhere in the payload.
			expect(JSON.stringify(user)).to.not.contain('SECRET-litbox');
		});

		it('users.info for ANOTHER user (no permission) does not return omnisaiLitbox', async () => {
			const user = await getFullUserDataByUniqueSearchTerm('other-caller-id', callerId, 'id');

			expect(user, 'expected a user document').to.not.equal(null);
			expect(user).to.not.have.property(SECRET);
			expect(JSON.stringify(user)).to.not.contain('SECRET-litbox');
		});
	});

	/**
	 * (c) + (d) cover the SECOND leak path that the earlier version of this test missed:
	 * `users.updateOwnBasicInfo` reads the user with the EXCLUSION projection
	 * `API.v1.defaultFieldsToExclude` and serializes it through `getUserInfo`. Neither of those
	 * uses the allowlist guarded above, so they each need their own assertion.
	 */
	describe('(c) the updateOwnBasicInfo exclusion projection (ApiClass.defaultFieldsToExclude) drops omnisaiLitbox', () => {
		it('defaultFieldsToExclude contains `omnisaiLitbox: 0`', () => {
			const exclude = loadDefaultFieldsToExclude();
			// EXCLUSION projection: omnisaiLitbox MUST be present and set to 0 to be dropped at the
			// DB read in users.updateOwnBasicInfo. (Absence here = leak, hence `=== 0`, not "absent".)
			expect(exclude).to.have.property(SECRET);
			expect(exclude[SECRET], `defaultFieldsToExclude must drop ${SECRET}: ${JSON.stringify(exclude)}`).to.equal(0);
		});
	});

	describe('(d) the real getUserInfo serializer strips omnisaiLitbox before sending to the client', () => {
		const meWithSecret = {
			_id: callerId,
			username: 'jdoe',
			name: 'Jane Doe',
			emails: [{ address: 'jane@example.com', verified: true }],
			roles: ['user'],
			active: true,
			type: 'user',
			status: 'online',
			services: {
				omnisai: { id: 'cp-123', orgId: 'org-1', role: 'attorney' },
				password: { bcrypt: 'hash' },
				resume: { loginTokens: [{ hashedToken: 'x' }] },
			},
			// Shaped exactly as app/omnisai-oauth/server/loginHandler.ts persists it.
			omnisaiLitbox: {
				sessionToken: 'SECRET_ACCESS',
				refreshToken: 'SECRET_REFRESH',
				expiresAt: 9999999999,
			},
		};

		it('returns NO omnisaiLitbox key and leaks none of the literal secret strings', async () => {
			const getUserInfo = loadGetUserInfo();
			// pullPreferences=false matches the updateOwnBasicInfo call site (users.ts ~line 221).
			const result = await getUserInfo(meWithSecret, false);

			expect(result, 'expected a serialized user object').to.be.an('object');
			expect(result).to.not.have.property(SECRET);

			const serialized = JSON.stringify(result);
			expect(serialized, 'session token leaked').to.not.contain('SECRET_ACCESS');
			expect(serialized, 'refresh token leaked').to.not.contain('SECRET_REFRESH');

			// Sanity: the serializer still returns the user (so we know the spread actually ran and
			// the assertion above isn't passing because `result` is empty/undefined).
			expect(result).to.have.property('username', 'jdoe');
			// The password hash itself must not leak either (only `password.exists`); guards that
			// the `...me` spread didn't blindly copy services.password through.
			expect(serialized, 'password hash leaked').to.not.contain('"bcrypt"');
		});

		it('does not mutate the caller-supplied user object (destructure is non-destructive)', async () => {
			const getUserInfo = loadGetUserInfo();
			await getUserInfo(meWithSecret, false);
			// The destructure must not delete the field from the source doc the server still holds.
			expect(meWithSecret.omnisaiLitbox, 'getUserInfo must not mutate its input').to.deep.equal({
				sessionToken: 'SECRET_ACCESS',
				refreshToken: 'SECRET_REFRESH',
				expiresAt: 9999999999,
			});
		});
	});
});
