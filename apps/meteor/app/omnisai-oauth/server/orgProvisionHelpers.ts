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

/**
 * A 'failed' claim re-arms the trigger, so a PERMANENTLY unavailable roster
 * endpoint (CentralizedAuth's /organizations/:id/members is still unmerged —
 * see docs/features/org-auto-provision.md) would otherwise produce one outbound
 * HTTP call per qualifying login, forever. Wait this long after the failure
 * before retrying.
 */
export const FAILED_RETRY_BACKOFF_MS = 60 * 60 * 1000;

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

/**
 * Optional ops allow-list of CentralizedAuth org ids permitted to trigger a
 * roster import (env MATTERCHAT_PROVISION_ORG_ALLOWLIST, comma-separated).
 * EMPTY = no restriction (current behaviour). Set it on deployments where the
 * widened org-admin trigger should not let a brand-new self-served org fire a
 * roster import against the workspace's shared provision key.
 */
export const parseProvisionOrgAllowlist = (raw: string | undefined | null): string[] => {
	if (typeof raw !== 'string' || !raw.trim()) {
		return [];
	}
	return raw
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
};

/** True when `orgId` may be provisioned (an empty allow-list permits every org). */
export const orgIsProvisionable = (orgId: string | undefined | null, allowlist: string[]): boolean => {
	if (!orgId) {
		return false;
	}
	if (allowlist.length === 0) {
		return true;
	}
	return allowlist.includes(orgId);
};

/**
 * Roster statuses that may be imported. CentralizedAuth rosters also carry
 * invited/pending/suspended/deactivated members; importing those mints live,
 * pre-verified MatterChat accounts for people the org never actually activated.
 * A member with NO status at all is treated as active (older roster payloads
 * omit the field entirely).
 */
export const IMPORTABLE_ROSTER_STATUSES = ['active', 'enabled'] as const;

export const isImportableRosterStatus = (status: unknown): boolean => {
	if (status === undefined || status === null || status === '') {
		return true;
	}
	if (typeof status !== 'string') {
		return false;
	}
	return (IMPORTABLE_ROSTER_STATUSES as readonly string[]).includes(status.trim().toLowerCase());
};

/**
 * MATTERCHAT (2026-07-30 fixer): the org→firm cohort stamp is OPT-IN.
 *
 * `Firms_Scoped_Directory` defaults to true and prod already runs
 * `Firms_SelfServe_Enabled=true`, so PR #166's user scoping is ARMED on the live
 * workspace today — inert only because NOBODY carries customFields.firmId.
 * Stamping every OIDC user with their CentralizedAuth org id would split the
 * workspace into two mutually invisible cohorts on the deploy itself (stamped
 * OIDC users vs. rocket.cat, every bot/app/service account, every
 * password/invite-registered account and every not-yet-logged-in roster import),
 * hard-blocking DMs across the split.
 *
 * So the stamp only happens when ops explicitly turns it on:
 *   MATTERCHAT_ORG_FIRM_COHORTS=1|true|yes|on
 * Off (the default) → no firmId is ever written from an org claim, no cohort
 * split, and rooms stay unstamped (the room stamp derives from the creator's
 * firmId), i.e. the deploy is a behavioural no-op for the existing workspace.
 */
export const orgFirmCohortsEnabled = (raw: string | undefined | null): boolean => {
	if (typeof raw !== 'string') {
		return false;
	}
	return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
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
	failedBackoffMs: number = FAILED_RETRY_BACKOFF_MS,
): Filter<OrgProvisionMarker> => ({
	_id: orgId,
	$or: [
		// a 'failed' marker only re-arms once the backoff has elapsed. `completedAt` is
		// always written by markOrgProvisionFailed; a marker missing it (hand-edited, or
		// written by an older build) re-arms immediately, matching the previous behaviour.
		{ status: 'failed', completedAt: { $lt: new Date(now.getTime() - failedBackoffMs) } },
		{ status: 'failed', completedAt: { $exists: false } },
		{ status: 'pending', startedAt: { $lt: new Date(now.getTime() - staleMs) } },
	],
});

/**
 * True when a qualifying login should NOT even contend for the claim: the org is
 * already provisioned, or a fresh run is in flight. The cheap read-side twin of
 * buildOrgProvisionClaimFilter (keeps the common every-later-login path to one find).
 */
export const shouldSkipProvisionTrigger = (
	marker: Pick<OrgProvisionMarker, 'status' | 'startedAt' | 'completedAt'> | null | undefined,
	now: Date,
	staleMs: number = STALE_PENDING_CLAIM_MS,
	failedBackoffMs: number = FAILED_RETRY_BACKOFF_MS,
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
	if (marker.status === 'failed') {
		// Back off before retrying: without this, a roster endpoint that is down (or not
		// deployed at all) means one outbound HTTP call on EVERY qualifying login. Must
		// stay in lockstep with buildOrgProvisionClaimFilter's 'failed' arm.
		const completedAt = marker.completedAt instanceof Date ? marker.completedAt.getTime() : NaN;
		return Number.isFinite(completedAt) && completedAt > now.getTime() - failedBackoffMs;
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
