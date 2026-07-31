/**
 * MATTERCHAT: pure helpers for org auto-provisioning — no Meteor/model imports
 * (type-only mongodb import, same as firms/firmsHelpers.ts) so they stay
 * unit-testable under mocha (see tests/unit/app/omnisai-oauth/server/).
 *
 * The DB-side counterparts (marker collection, roster import, firmId stamping)
 * live in orgProvision.ts; everything here is decision logic over plain values.
 */
import type { Filter } from 'mongodb';

/**
 * Which `casepro:role` claim values count as "org admin" for the provisioning
 * trigger. Overridable via MATTERCHAT_ORG_ADMIN_ROLES (comma-separated,
 * case-insensitive) because CentralizedAuth's role vocabulary is not guaranteed
 * — some deployments use names ('admin', 'owner'), others role UUIDs; ops sets
 * whatever the issuer actually emits.
 */
export const DEFAULT_ORG_ADMIN_ROLES = ['admin', 'owner'] as const;

/**
 * A 'pending' provisioning claim older than this is considered abandoned (pod
 * died mid-run) and may be re-claimed by the next qualifying login. A takeover
 * racing a zombie run is harmless — the roster import dedups by sub/email.
 */
export const STALE_PENDING_CLAIM_MS = 10 * 60 * 1000;

export type OrgProvisionStatus = 'pending' | 'done' | 'failed';

export type OrgProvisionCounts = { total: number; created: number; existing: number; skipped: number };

/** One durable marker per CentralizedAuth org. `_id` = orgId — _id uniqueness IS the concurrency lock. */
export type OrgProvisionMarker = {
	_id: string;
	status: OrgProvisionStatus;
	startedAt: Date;
	byUserId?: string;
	completedAt?: Date;
	counts?: OrgProvisionCounts;
	lastError?: string;
	/** set when the marker was seeded from the legacy per-admin services.omnisai.provisionedOrgId field */
	seededFrom?: 'legacy-admin-marker';
};

/** Parse MATTERCHAT_ORG_ADMIN_ROLES; falls back to the defaults when unset/blank/unparseable. */
export const parseOrgAdminRoles = (raw: string | undefined | null): string[] => {
	if (typeof raw !== 'string' || !raw.trim()) {
		return [...DEFAULT_ORG_ADMIN_ROLES];
	}
	const roles = raw
		.split(',')
		.map((r) => r.trim().toLowerCase())
		.filter(Boolean);
	return roles.length > 0 ? roles : [...DEFAULT_ORG_ADMIN_ROLES];
};

/** True when the login's org-role claim matches the configured org-admin list (case-insensitive). */
export const isOrgAdminRole = (role: string | undefined | null, orgAdminRoles: string[]): boolean => {
	if (typeof role !== 'string' || !role.trim()) {
		return false;
	}
	return orgAdminRoles.includes(role.trim().toLowerCase());
};

/**
 * The provisioning trigger gate: a WORKSPACE admin (preserves the original org-#1
 * behavior regardless of what the role claim says) OR an ORG admin per the
 * `casepro:role` claim (what unblocks org #2+, whose members never get MatterChat
 * workspace-admin).
 */
export const qualifiesToProvisionOrg = (opts: {
	workspaceRoles: unknown;
	orgRole: string | undefined | null;
	orgAdminRoles: string[];
}): boolean => {
	const isWorkspaceAdmin = Array.isArray(opts.workspaceRoles) && opts.workspaceRoles.includes('admin');
	return isWorkspaceAdmin || isOrgAdminRole(opts.orgRole, opts.orgAdminRoles);
};

export type FirmStampDecision = 'stamp' | 'already-stamped' | 'conflict' | 'invalid';

/**
 * Stamp policy for customFields.firmId (the exact field PR #166's scoping reads):
 * stamp ONLY when absent; an existing equal value is a no-op; an existing
 * DIFFERENT value is never overwritten (the caller warn-logs it — a user in a
 * self-serve firm keeps their Team-id firmId, and an org move does not silently
 * re-cohort the user). Mirrors the `{ $exists: false }`-guarded atomic update.
 */
export const decideFirmIdStamp = (existingFirmId: unknown, orgId: string | undefined | null): FirmStampDecision => {
	if (typeof orgId !== 'string' || !orgId) {
		return 'invalid';
	}
	if (existingFirmId === undefined || existingFirmId === null) {
		return 'stamp';
	}
	return existingFirmId === orgId ? 'already-stamped' : 'conflict';
};

/**
 * Filter for the atomic claim upsert (see claimOrgProvision in orgProvision.ts).
 * Matches a re-claimable marker: 'failed', or 'pending' gone stale. When no doc
 * exists the upsert inserts (claim won); when the doc is 'done' or fresh-'pending'
 * the filter misses and the insert attempt throws duplicate-key → claim lost.
 */
export const buildOrgProvisionClaimFilter = (
	orgId: string,
	now: Date,
	staleMs: number = STALE_PENDING_CLAIM_MS,
): Filter<OrgProvisionMarker> => ({
	_id: orgId,
	$or: [{ status: 'failed' }, { status: 'pending', startedAt: { $lt: new Date(now.getTime() - staleMs) } }],
});

/**
 * True when a qualifying login should NOT even contend for the claim: the org is
 * already provisioned, or a fresh run is in flight. The cheap read-side twin of
 * buildOrgProvisionClaimFilter (keeps the common every-later-login path to one find).
 */
export const shouldSkipProvisionTrigger = (
	marker: Pick<OrgProvisionMarker, 'status' | 'startedAt'> | null | undefined,
	now: Date,
	staleMs: number = STALE_PENDING_CLAIM_MS,
): boolean => {
	if (!marker) {
		return false;
	}
	if (marker.status === 'done') {
		return true;
	}
	if (marker.status === 'pending') {
		const startedAt = marker.startedAt instanceof Date ? marker.startedAt.getTime() : NaN;
		// an unreadable startedAt counts as stale — don't let a malformed doc wedge the org forever
		return Number.isFinite(startedAt) && startedAt > now.getTime() - staleMs;
	}
	return false;
};

/** Mongo duplicate-key detection (E11000) across driver error shapes. */
export const isDuplicateKeyError = (err: unknown): boolean => {
	if (!err || typeof err !== 'object') {
		return false;
	}
	const e = err as { code?: unknown; message?: unknown };
	return e.code === 11000 || (typeof e.message === 'string' && e.message.includes('E11000'));
};
