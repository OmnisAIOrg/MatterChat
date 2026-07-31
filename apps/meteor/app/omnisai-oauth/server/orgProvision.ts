/**
 * Auto-provision — mirror a CasePro firm's team into MatterChat on the first
 * "Sign in with OmnisAI" by one of the firm's admins.
 *
 * Flow (server-only, background, idempotent):
 *   an ORG ADMIN's first OmnisAI login (loginHandler; workspace admins also
 *   qualify) → claim the org's durable marker in `matterchat_org_provisions`
 *   (per-ORG, `_id` = orgId — _id uniqueness is the concurrency lock) → fetch
 *   the org's member roster from CentralizedAuth (GET /organizations/:id/members,
 *   authed with the shared `x-provision-key`) → pre-create a LINKED MatterChat
 *   user for each member (services.omnisai.id == member.userId == their
 *   CentralizedAuth `sub`), stamped with `customFields.firmId` = orgId so PR
 *   #166's firm scoping applies from day one. When a teammate later signs in via
 *   OmnisAI, upsertOmnisaiUser finds this pre-created doc (by sub, then email)
 *   and adopts it — same person, no duplicate.
 *
 * Why IMPORT (pre-create) and not "invite": the firm's team already exists in
 * CentralizedAuth/CasePro (they ARE the org's members), so CentralizedAuth's
 * invite-multiple would reject every one as "already a member". Pre-creating the
 * MatterChat accounts is what actually delivers "the whole team is just there"
 * — and it needs no SMTP (staging has none).
 *
 * Standalone principle (mirrors the litbox/crossfirm/oidc modules): does nothing
 * unless the OIDC issuer AND a provision key are configured — a fresh MatterChat
 * with neither is fully self-contained.
 */
import { Users } from '@rocket.chat/models';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Accounts } from 'meteor/accounts-base';

import { db } from '../../../server/database/utils';
import { SystemLogger } from '../../../server/lib/logger/system';
import type { OrgProvisionCounts, OrgProvisionMarker } from './orgProvisionHelpers';
import { buildOrgProvisionClaimFilter, decideFirmIdStamp, isDuplicateKeyError } from './orgProvisionHelpers';

type RosterMember = {
	userId: string;
	email: string;
	name?: string | null;
	role?: string | null;
	status?: string;
};

type ProvisionConfig = { apiBase: string; provisionKey: string };

// CentralizedAuth's org REST endpoints live at the issuer host root (e.g.
// https://auth-app.stg-omnisai.io/organizations/...), the same host the OIDC
// issuer points at. An explicit override is honoured first for setups where the
// REST API and the OIDC issuer differ.
function getProvisionConfig(): ProvisionConfig | null {
	const apiBase = (process.env.OMNISAI_AUTH_API_BASE || process.env.OMNISAI_OIDC_ISSUER || '').replace(/\/$/, '');
	const provisionKey = process.env.MATTERCHAT_PROVISION_KEY || '';
	if (!apiBase || !provisionKey) {
		return null;
	}
	return { apiBase, provisionKey };
}

/**
 * Per-ORG provisioned markers. A dedicated raw collection (NOT a
 * @rocket.chat/models class — mirrors web-push/server/subscriptions.ts) so this
 * stays fully self-contained: no packages/models edits, no turbo rebuild. `_id`
 * is the CentralizedAuth orgId, so the built-in _id unique index doubles as the
 * claim lock — two simultaneous first-logins from the same org cannot both win.
 */
const ORG_PROVISIONS_COLLECTION = 'matterchat_org_provisions';

const orgProvisions = () => db.collection<OrgProvisionMarker>(ORG_PROVISIONS_COLLECTION);

/** Read an org's marker (null = never provisioned). */
export async function getOrgProvision(orgId: string): Promise<OrgProvisionMarker | null> {
	return orgProvisions().findOne({ _id: orgId });
}

/**
 * Atomically claim the right to provision an org. Returns true when THIS caller
 * owns the run. Semantics (see buildOrgProvisionClaimFilter): no marker → upsert
 * inserts 'pending' (claimed); 'failed' or stale-'pending' → re-claimed; 'done'
 * or fresh-'pending' → the filter misses, the upsert insert hits the _id unique
 * index (E11000) → claim lost. Even a rare stale-pending takeover racing a zombie
 * run is harmless: importMember dedups by sub/email.
 */
export async function claimOrgProvision(orgId: string, byUserId: string): Promise<boolean> {
	const now = new Date();
	try {
		const res = await orgProvisions().updateOne(
			buildOrgProvisionClaimFilter(orgId, now),
			{ $set: { status: 'pending', startedAt: now, byUserId } },
			{ upsert: true },
		);
		return res.upsertedCount > 0 || res.matchedCount > 0;
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			return false; // already 'done', or a fresh run is in flight
		}
		throw err;
	}
}

export async function markOrgProvisionDone(orgId: string, counts: OrgProvisionCounts): Promise<void> {
	await orgProvisions().updateOne({ _id: orgId }, { $set: { status: 'done', completedAt: new Date(), counts }, $unset: { lastError: 1 } });
}

export async function markOrgProvisionFailed(orgId: string, message: string): Promise<void> {
	await orgProvisions().updateOne(
		{ _id: orgId },
		{ $set: { status: 'failed', completedAt: new Date(), lastError: (message || 'unknown').slice(0, 500) } },
	);
}

/**
 * Seed a 'done' marker for an org provisioned under the OLD per-admin scheme
 * (services.omnisai.provisionedOrgId — only ever written after a successful run).
 * $setOnInsert-only, so an existing marker (any status) is never touched.
 * Returns true when a marker was actually created. Used by orgBackfill.ts so the
 * first deploy of the per-org trigger never re-runs org #1 on the live workspace.
 */
export async function seedOrgProvisionMarkerAsDone(orgId: string): Promise<boolean> {
	const now = new Date();
	const res = await orgProvisions().updateOne(
		{ _id: orgId },
		{ $setOnInsert: { status: 'done', startedAt: now, completedAt: now, seededFrom: 'legacy-admin-marker' } },
		{ upsert: true },
	);
	return res.upsertedCount > 0;
}

/**
 * Stamp `customFields.firmId` = the CentralizedAuth orgId — the EXACT field PR
 * #166's firm scoping reads (getFirmScopeExtraQuery / userMatchesFirmScope), so
 * OIDC users land in their org's cohort. One atomic `$exists:false`-guarded
 * update (the same non-clobber precedent as firms adoptUserIntoFirm): an
 * existing firmId — a self-serve firm's Team _id, or a prior org stamp — is
 * NEVER overwritten; a differing value is warn-logged instead. Never throws:
 * callers are login/import paths that must not break on a metadata stamp.
 */
export async function stampFirmIdFromOrg(userId: string, orgId: string, source: 'login' | 'roster-import' | 'backfill'): Promise<void> {
	try {
		const res = await Users.updateOne(
			{ '_id': userId, 'customFields.firmId': { $exists: false } },
			{ $set: { 'customFields.firmId': orgId, 'customFields.firmIdSource': 'omnisai' } },
		);
		if (res.matchedCount > 0) {
			return;
		}
		// The guard didn't match — the user already carries a firmId. Only a DIFFERENT
		// value warrants noise (equal = already stamped on an earlier login).
		const user = await Users.findOneById(userId, { projection: { customFields: 1 } });
		const existing = (user?.customFields as Record<string, unknown> | undefined)?.firmId;
		if (decideFirmIdStamp(existing, orgId) === 'conflict') {
			SystemLogger.warn({
				msg: 'OmnisAI firmId stamp conflict: user already carries a different customFields.firmId — keeping the existing value',
				userId,
				orgId,
				existingFirmId: existing,
				source,
			});
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'OmnisAI firmId stamp failed (non-fatal)', err, userId, orgId, source });
	}
}

// Local copy of loginHandler's helper (kept here to avoid a loginHandler↔orgProvision
// import cycle — loginHandler imports THIS module, never the reverse).
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

/**
 * Pre-create one teammate's MatterChat account, linked by their CentralizedAuth
 * subject and stamped into the org's firm-scope cohort. Idempotent: a member who
 * already has a MatterChat user (matched by sub, then email) only gains the
 * missing link/firmId stamps. Never promotes to admin and never mints a login
 * token — this is a passive import, not a login.
 */
async function importMember(member: RosterMember, orgId: string): Promise<'created' | 'exists' | 'skipped'> {
	if (!member?.userId || !member?.email) {
		return 'skipped';
	}

	// Match the same way upsertOmnisaiUser does, so a later real login adopts this doc.
	let existing = await Users.findOne({ 'services.omnisai.id': member.userId }, { projection: { _id: 1, 'services.omnisai.id': 1 } });
	if (!existing) {
		existing = await Users.findOneByEmailAddress(member.email);
	}

	if (existing) {
		// A pre-existing account matched only by email won't carry the omnisai link
		// yet; stamp it so this teammate's later OIDC login resolves by sub too.
		const hasLink = (existing as any)?.services?.omnisai?.id === member.userId;
		if (!hasLink) {
			await Users.updateOne({ _id: existing._id }, { $set: { 'services.omnisai.id': member.userId } });
		}
		// Guarded (never clobbers an existing firmId — see stampFirmIdFromOrg).
		await stampFirmIdFromOrg(existing._id, orgId, 'roster-import');
		return 'exists';
	}

	const username = await uniqueUsername(member.email.split('@')[0] || `omnisai-${member.userId.slice(0, 8)}`);
	await Accounts.insertUserDoc(
		{ skipAuthServiceDefaultRoles: true } as any,
		{
			name: member.name || username,
			username,
			active: true,
			emails: [{ address: member.email, verified: true }],
			globalRoles: ['user'],
			services: { omnisai: { id: member.userId } },
			// firm-scope cohort (PR #166) from day one — no waiting for the member's first login
			customFields: { firmId: orgId, firmIdSource: 'omnisai' },
		} as any,
	);
	return 'created';
}

export type ProvisionRunResult = { ok: true; counts: OrgProvisionCounts } | { ok: false; reason: string };

/**
 * Fetch the org roster from CentralizedAuth and import every member. Returns
 * `{ ok: true, counts }` when the roster was fetched and processed (so the
 * caller marks the org 'done'), `{ ok: false, reason }` when it could not be
 * fetched (so the caller marks it 'failed' and the next qualifying login
 * retries). Per-member failures are logged and do NOT fail the run.
 */
export async function provisionOrgFromRoster(orgId: string): Promise<ProvisionRunResult> {
	const config = getProvisionConfig();
	if (!config) {
		SystemLogger.debug({ msg: 'OmnisAI auto-provision skipped: OMNISAI_OIDC_ISSUER or MATTERCHAT_PROVISION_KEY not set' });
		return { ok: false, reason: 'provision config missing (OMNISAI_OIDC_ISSUER / MATTERCHAT_PROVISION_KEY)' };
	}
	if (!orgId) {
		return { ok: false, reason: 'no orgId' };
	}

	let members: RosterMember[] = [];
	try {
		const url = `${config.apiBase}/organizations/${encodeURIComponent(orgId)}/members`;
		const res = await fetch(url, {
			ignoreSsrfValidation: true, // issuer is an admin-configured trusted host (often a private VPC IP), not user input
			headers: { 'x-provision-key': config.provisionKey },
		});
		if (!res.ok) {
			SystemLogger.warn({ msg: 'OmnisAI auto-provision: roster fetch failed', status: res.status, orgId });
			return { ok: false, reason: `roster fetch failed: HTTP ${res.status}` };
		}
		const body = await res.json();
		members = Array.isArray(body?.members) ? body.members : [];
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI auto-provision: roster fetch error', err });
		return { ok: false, reason: `roster fetch error: ${err instanceof Error ? err.message : 'unknown'}` };
	}

	let created = 0;
	let exists = 0;
	let skipped = 0;
	for (const member of members) {
		try {
			// eslint-disable-next-line no-await-in-loop
			const outcome = await importMember(member, orgId);
			if (outcome === 'created') {
				created++;
			} else if (outcome === 'exists') {
				exists++;
			} else {
				skipped++;
			}
		} catch (err) {
			skipped++;
			SystemLogger.warn({ msg: 'OmnisAI auto-provision: member import failed', err });
		}
	}

	SystemLogger.info({ msg: 'OmnisAI auto-provision complete', orgId, total: members.length, created, existing: exists, skipped });
	return { ok: true, counts: { total: members.length, created, existing: exists, skipped } };
}
