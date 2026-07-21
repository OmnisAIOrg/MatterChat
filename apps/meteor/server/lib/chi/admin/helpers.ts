/**
 * Chi Admin Assistant — pure helpers (no Meteor / no transport; unit-tested in isolation at
 * tests/unit/server/lib/chi/admin/helpers.spec.ts). The Slack sibling is
 * app/connectors/server/providers/slack/eventsSecurity.ts — same "pure module first" pattern.
 */

/** Hard cap for one bulk_create_users call — keeps a single DM from minting an unbounded fleet. */
export const BULK_CREATE_MAX = 100;

/**
 * Settings access contract (widened 2026-07-20 on founder direction — "admin capability on
 * everything"): Chi may READ any setting and WRITE any setting. The guardrails that remain are
 * the ones that matter: secret VALUES are always masked on read/echo (never leave the server in
 * chat), writes stay double-gated behind Chi_Assistant_Allow_Settings_Writes + an in-chat
 * confirm, and every write is audited. The old allowlists are kept as functions so call sites
 * and tests keep a single seam if scoping ever needs to come back.
 */

/** Setting ids whose VALUES must never be echoed back into chat/audit. */
const SECRET_SETTING_MARKERS = ['Secret', 'Password', 'API_Key', 'Token'];

export function isSettingReadable(id: string): boolean {
	return id.trim().length > 0;
}

export function isSettingWritable(id: string): boolean {
	return id.trim().length > 0;
}

export function isSecretSetting(id: string): boolean {
	return SECRET_SETTING_MARKERS.some((m) => id.includes(m));
}

/** Mask a secret for display/audit: keep enough to recognize, never enough to use. */
export function maskSecret(value: unknown): string {
	const s = String(value ?? '');
	if (!s) {
		return '(empty)';
	}
	if (s.length <= 6) {
		return '••••';
	}
	return `${s.slice(0, 3)}…${s.slice(-2)} (${s.length} chars)`;
}

/**
 * Derive a MatterChat username from an email local part: lowercase, dot-separated word chars
 * only, no leading/trailing/double separators. `jane.o'brien+x@firm.com` → `jane.obrien`.
 */
export function deriveUsername(email: string): string {
	const local = (email.split('@')[0] || '').toLowerCase();
	const cleaned = local
		.replace(/\+.*$/, '') // strip +tag
		.replace(/[^a-z0-9._-]/g, '')
		.replace(/[._-]{2,}/g, '.')
		.replace(/^[._-]+|[._-]+$/g, '');
	return cleaned || 'user';
}

export type BulkUserRow = { email: string; name?: string; username?: string };
export type BulkParseResult = { rows: BulkUserRow[]; errors: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse a bulk-users blob. Accepts one user per line as `email`, `email, Full Name`, or
 * `email, Full Name, username` (commas or semicolons; a leading `- ` bullet is tolerated —
 * people paste lists straight from notes). Dedupes emails within the blob, derives usernames
 * from the email local part when absent, and de-collides usernames with numeric suffixes.
 */
export function parseBulkUsers(blob: string, takenUsernames: ReadonlySet<string> = new Set()): BulkParseResult {
	const rows: BulkUserRow[] = [];
	const errors: string[] = [];
	const seenEmails = new Set<string>();
	const seenUsernames = new Set<string>(Array.from(takenUsernames, (u) => u.toLowerCase()));

	for (const rawLine of blob.split(/\r?\n/)) {
		const line = rawLine.replace(/^\s*[-*]\s+/, '').trim();
		if (!line) {
			continue;
		}
		const parts = line.split(/[,;]/).map((p) => p.trim());
		const email = (parts[0] || '').toLowerCase();
		if (!EMAIL_RE.test(email)) {
			errors.push(`not an email: "${line.slice(0, 80)}"`);
			continue;
		}
		if (seenEmails.has(email)) {
			errors.push(`duplicate email skipped: ${email}`);
			continue;
		}
		seenEmails.add(email);

		let username = (parts[2] || '').toLowerCase().replace(/[^a-z0-9._-]/g, '') || deriveUsername(email);
		if (seenUsernames.has(username)) {
			let n = 2;
			while (seenUsernames.has(`${username}${n}`)) {
				n += 1;
			}
			username = `${username}${n}`;
		}
		seenUsernames.add(username);

		rows.push({ email, name: parts[1] || undefined, username });
	}
	return { rows, errors };
}

/** A human-typed confirmation? (the deterministic gate for destructive tools) */
export function isConfirmText(text: string): boolean {
	return /^(confirm|yes|y)\.?$/i.test(text.trim());
}

export function isCancelText(text: string): boolean {
	return /^(cancel|no|abort|stop)\.?$/i.test(text.trim());
}

/** Compact single-line JSON for audit lines, with secret-looking keys masked. */
export function auditArgs(input: Record<string, unknown>): string {
	const masked: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(input)) {
		masked[k] = /secret|password|api_key|token/i.test(k) ? maskSecret(v) : v;
	}
	const s = JSON.stringify(masked);
	return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}
