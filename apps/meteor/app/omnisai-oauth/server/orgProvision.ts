/**
 * Auto-provision — mirror a CasePro firm's team into MatterChat on the firm
 * admin's first "Sign in with OmnisAI".
 *
 * Flow (server-only, background, idempotent):
 *   firm admin's first OmnisAI login (loginHandler) → fetch the org's member
 *   roster from CentralizedAuth (GET /organizations/:id/members, authed with the
 *   shared `x-provision-key`) → pre-create a LINKED MatterChat user for each
 *   member (services.omnisai.id == member.userId == their CentralizedAuth `sub`)
 *   so the whole team appears in the workspace immediately. When a teammate
 *   later signs in via OmnisAI, upsertOmnisaiUser finds this pre-created doc
 *   (by sub, then email) and adopts it — same person, no duplicate.
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

import { SystemLogger } from '../../../server/lib/logger/system';

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
 * subject. Idempotent: a member who already has a MatterChat user (matched by
 * sub, then email) is left untouched. Never promotes to admin and never mints a
 * login token — this is a passive import, not a login.
 */
async function importMember(member: RosterMember): Promise<'created' | 'exists' | 'skipped'> {
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
		} as any,
	);
	return 'created';
}

/**
 * Fetch the org roster from CentralizedAuth and import every active member.
 * Returns true when the roster was fetched and processed (so the caller may mark
 * the org provisioned), false when it could not be fetched (so it retries on the
 * admin's next login). Per-member failures are logged and do NOT fail the run.
 */
export async function provisionOrgFromRoster(orgId: string): Promise<boolean> {
	const config = getProvisionConfig();
	if (!config) {
		SystemLogger.debug({ msg: 'OmnisAI auto-provision skipped: OMNISAI_OIDC_ISSUER or MATTERCHAT_PROVISION_KEY not set' });
		return false;
	}
	if (!orgId) {
		return false;
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
			return false;
		}
		const body = await res.json();
		members = Array.isArray(body?.members) ? body.members : [];
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI auto-provision: roster fetch error', err });
		return false;
	}

	let created = 0;
	let exists = 0;
	let skipped = 0;
	for (const member of members) {
		try {
			// eslint-disable-next-line no-await-in-loop
			const outcome = await importMember(member);
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
	return true;
}
