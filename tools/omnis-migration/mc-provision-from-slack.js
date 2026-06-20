// Proactive bulk-provisioning: turn a Slack workspace's members into real OmnisAI accounts.
//
//   Slack export users.json  ->  extract real members (skip bots/deleted, require email)
//   ->  POST CentralizedAuth /organizations/invite-multiple  (7-day invites, no password up front)
//   ->  CentralizedAuth fires user.added_to_org webhooks  ->  CasePro (+ LitBox) auto-sync the users.
//
// Identity note: the account's CentralizedAuth UUID IS the CasePro users.id, which is exactly what
// MatterChat's "Sign in with OmnisAI" maps to (services.omnisai.id) — so a provisioned member and
// their later MatterChat login are the same person, by email.
//
// Verified here against the mock CentralizedAuth/CasePro. In production: point AUTH_BASE at
// auth-app.stg-omnisai.io and supply a real org-admin session (Authorization/cookie) — the
// invite-multiple endpoint is admin-gated (CsrfGuard + AuthGuard).
const fs = require('fs');

const AUTH_BASE = process.env.AUTH_BASE || 'http://127.0.0.1:9100';
const ORG_ID = process.env.ORG_ID || 'org-22222222-2222-4222-8222-222222222222';
const ROLE_ID = process.env.ROLE_ID || 'role-paralegal';
const USERS_JSON = process.env.SLACK_USERS_JSON || '/Users/davidnguyen/slack-export/users.json';

function extractMembers(usersJsonPath) {
	const raw = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
	return raw
		.filter((u) => !u.is_bot && !u.deleted && u.profile && u.profile.email)
		.map((u) => ({ email: u.profile.email, name: u.profile.real_name || u.name }));
}

(async () => {
	const members = extractMembers(USERS_JSON);
	console.log(`1) Slack export -> ${members.length} real members:`, members.map((m) => m.email).join(', '));

	const res = await fetch(`${AUTH_BASE}/organizations/invite-multiple`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			// Production: a real org-admin session token / cookie goes here.
			Authorization: `Bearer ${process.env.AUTH_ADMIN_TOKEN || 'mock-admin-session'}`,
		},
		body: JSON.stringify({ emails: members.map((m) => m.email), organizationId: ORG_ID, roleId: ROLE_ID }),
	});
	if (!res.ok) {
		console.log('PROVISION FAILED', res.status, await res.text());
		process.exit(1);
	}
	const out = await res.json();
	console.log(`2) invite-multiple -> ${out.totalInvited} invited, ${out.totalErrors} errors`);
	out.invites.forEach((i) => console.log(`   invited ${i.email} (org=${i.organizationId}, role=${i.roleId}, status=${i.status})`));

	// Give the fire-and-forget webhooks a moment, then confirm CasePro received the syncs.
	await new Promise((r) => setTimeout(r, 800));
	const crm = await (await fetch(`${AUTH_BASE}/crm/synced`)).json();
	console.log(`3) CasePro (mock) received ${crm.count} user syncs:`);
	crm.users.forEach((u) => console.log(`   CasePro user ${u.email} -> users.id=${u.id} (${u.event})`));

	const ok = crm.count >= members.length && members.every((m) => crm.users.some((u) => u.email === m.email));
	console.log(ok ? '4) PASS: every Slack member is now provisioned in OmnisAI + synced to CasePro' : '4) FAIL: not all members synced');
})().catch((e) => { console.log('ERROR:', e?.message || e); process.exit(1); });
