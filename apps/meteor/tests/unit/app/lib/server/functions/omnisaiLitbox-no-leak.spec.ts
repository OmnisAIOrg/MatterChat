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
 * What this test guards (so the above can't silently regress):
 *   (a) the field projections used by getFullUserData / users.info (defaultFields, fullFields)
 *       and by the `/me` endpoint (getDefaultUserFields / getBaseUserFields) do NOT mention
 *       `omnisaiLitbox` (nor any `omnisaiLitbox.*` sub-key);
 *   (b) a user document that DOES carry `omnisaiLitbox`, when run through the real
 *       getFullUserDataByUniqueSearchTerm projection logic (including the self-view branch that
 *       additionally projects `services: 1`), comes back WITHOUT `omnisaiLitbox`.
 *
 * Runnable: yes. This is a mocha + chai + sinon + proxyquire unit test, matching the existing
 * specs in this folder (e.g. sendUserEmail.spec.ts, getRoomByNameOrIdWithOptionToJoin.spec.ts).
 * It is picked up by `yarn testunit` via the tests/unit/app spec glob in .mocharc.js.
 * The heavy Meteor/Rocket.Chat imports are stubbed via proxyquire so the REAL projection code
 * (defaultFields/fullFields and the projection object built in getFullUserDataByUniqueSearchTerm)
 * is exercised — only the DB/permission/settings collaborators are faked.
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
});
