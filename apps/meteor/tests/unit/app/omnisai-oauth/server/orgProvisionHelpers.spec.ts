import { expect } from 'chai';

import {
	DEFAULT_ORG_ADMIN_ROLES,
	STALE_PENDING_CLAIM_MS,
	buildOrgProvisionClaimFilter,
	decideFirmIdStamp,
	isDuplicateKeyError,
	isOrgAdminRole,
	parseOrgAdminRoles,
	qualifiesToProvisionOrg,
	shouldSkipProvisionTrigger,
} from '../../../../../app/omnisai-oauth/server/orgProvisionHelpers';

describe('orgProvisionHelpers (org auto-provision pure logic)', () => {
	describe('parseOrgAdminRoles (MATTERCHAT_ORG_ADMIN_ROLES)', () => {
		it('falls back to the defaults when unset', () => {
			expect(parseOrgAdminRoles(undefined)).to.deep.equal([...DEFAULT_ORG_ADMIN_ROLES]);
			expect(parseOrgAdminRoles(null)).to.deep.equal([...DEFAULT_ORG_ADMIN_ROLES]);
		});

		it('falls back to the defaults on blank / whitespace-only / separator-only input', () => {
			expect(parseOrgAdminRoles('')).to.deep.equal([...DEFAULT_ORG_ADMIN_ROLES]);
			expect(parseOrgAdminRoles('   ')).to.deep.equal([...DEFAULT_ORG_ADMIN_ROLES]);
			expect(parseOrgAdminRoles(',, ,')).to.deep.equal([...DEFAULT_ORG_ADMIN_ROLES]);
		});

		it('parses a comma-separated list, trimming and lowercasing', () => {
			expect(parseOrgAdminRoles(' Admin, OWNER ,manager')).to.deep.equal(['admin', 'owner', 'manager']);
		});

		it('drops empty entries but keeps the rest', () => {
			expect(parseOrgAdminRoles('admin,,owner,')).to.deep.equal(['admin', 'owner']);
		});

		it('accepts opaque role UUIDs (CentralizedAuth vocabulary is not guaranteed to be names)', () => {
			expect(parseOrgAdminRoles('c2a9e5d0-1234-4abc-9def-000000000001')).to.deep.equal(['c2a9e5d0-1234-4abc-9def-000000000001']);
		});
	});

	describe('isOrgAdminRole', () => {
		const roles = ['admin', 'owner'];

		it('matches case-insensitively with surrounding whitespace', () => {
			expect(isOrgAdminRole('admin', roles)).to.be.true;
			expect(isOrgAdminRole('  OWNER ', roles)).to.be.true;
		});

		it('rejects non-matching, empty, and missing roles', () => {
			expect(isOrgAdminRole('paralegal', roles)).to.be.false;
			expect(isOrgAdminRole('', roles)).to.be.false;
			expect(isOrgAdminRole('   ', roles)).to.be.false;
			expect(isOrgAdminRole(undefined, roles)).to.be.false;
			expect(isOrgAdminRole(null, roles)).to.be.false;
		});

		it('never matches against an empty configured list', () => {
			expect(isOrgAdminRole('admin', [])).to.be.false;
		});
	});

	describe('qualifiesToProvisionOrg (the trigger gate)', () => {
		const orgAdminRoles = ['admin', 'owner'];

		it('workspace admin qualifies regardless of the org-role claim (org #1 behavior preserved)', () => {
			expect(qualifiesToProvisionOrg({ workspaceRoles: ['user', 'admin'], orgRole: undefined, orgAdminRoles })).to.be.true;
			expect(qualifiesToProvisionOrg({ workspaceRoles: ['admin'], orgRole: 'paralegal', orgAdminRoles })).to.be.true;
		});

		it('org-admin role claim qualifies without workspace admin (the org-#2 unblock)', () => {
			expect(qualifiesToProvisionOrg({ workspaceRoles: ['user'], orgRole: 'owner', orgAdminRoles })).to.be.true;
		});

		it('neither → does not qualify', () => {
			expect(qualifiesToProvisionOrg({ workspaceRoles: ['user'], orgRole: 'paralegal', orgAdminRoles })).to.be.false;
			expect(qualifiesToProvisionOrg({ workspaceRoles: ['user'], orgRole: undefined, orgAdminRoles })).to.be.false;
		});

		it('tolerates malformed roles arrays', () => {
			expect(qualifiesToProvisionOrg({ workspaceRoles: undefined, orgRole: undefined, orgAdminRoles })).to.be.false;
			expect(qualifiesToProvisionOrg({ workspaceRoles: 'admin', orgRole: undefined, orgAdminRoles })).to.be.false;
		});
	});

	describe('decideFirmIdStamp (customFields.firmId stamp policy)', () => {
		const orgId = 'org-uuid-1';

		it('stamps when no firmId exists', () => {
			expect(decideFirmIdStamp(undefined, orgId)).to.equal('stamp');
			expect(decideFirmIdStamp(null, orgId)).to.equal('stamp');
		});

		it('no-ops when the same value is already stamped', () => {
			expect(decideFirmIdStamp(orgId, orgId)).to.equal('already-stamped');
		});

		it('reports conflict for a DIFFERENT existing firmId (self-serve Team _id, or an org move) — never overwrite', () => {
			expect(decideFirmIdStamp('team-id-abc', orgId)).to.equal('conflict');
			expect(decideFirmIdStamp('org-uuid-2', orgId)).to.equal('conflict');
		});

		it('treats a present-but-garbage firmId as conflict (mirrors the $exists:false update guard)', () => {
			expect(decideFirmIdStamp('', orgId)).to.equal('conflict');
			expect(decideFirmIdStamp(42, orgId)).to.equal('conflict');
		});

		it('rejects a missing/empty orgId as invalid', () => {
			expect(decideFirmIdStamp(undefined, undefined)).to.equal('invalid');
			expect(decideFirmIdStamp(undefined, null)).to.equal('invalid');
			expect(decideFirmIdStamp(undefined, '')).to.equal('invalid');
		});
	});

	describe('buildOrgProvisionClaimFilter (the claim lock filter)', () => {
		const now = new Date('2026-07-30T12:00:00.000Z');

		it('keys on _id = orgId and re-claims failed or stale-pending markers', () => {
			const filter = buildOrgProvisionClaimFilter('org-1', now) as any;
			expect(filter._id).to.equal('org-1');
			expect(filter.$or).to.have.lengthOf(2);
			expect(filter.$or[0]).to.deep.equal({ status: 'failed' });
			expect(filter.$or[1].status).to.equal('pending');
			expect(filter.$or[1].startedAt.$lt.getTime()).to.equal(now.getTime() - STALE_PENDING_CLAIM_MS);
		});

		it('honours a custom staleness window', () => {
			const filter = buildOrgProvisionClaimFilter('org-1', now, 1000) as any;
			expect(filter.$or[1].startedAt.$lt.getTime()).to.equal(now.getTime() - 1000);
		});
	});

	describe('shouldSkipProvisionTrigger (cheap pre-check)', () => {
		const now = new Date('2026-07-30T12:00:00.000Z');

		it('does not skip when no marker exists (first ever qualifying login)', () => {
			expect(shouldSkipProvisionTrigger(null, now)).to.be.false;
			expect(shouldSkipProvisionTrigger(undefined, now)).to.be.false;
		});

		it('skips a done org', () => {
			expect(shouldSkipProvisionTrigger({ status: 'done', startedAt: new Date(0) }, now)).to.be.true;
		});

		it('skips a fresh pending run but not a stale one', () => {
			const fresh = new Date(now.getTime() - STALE_PENDING_CLAIM_MS / 2);
			const stale = new Date(now.getTime() - STALE_PENDING_CLAIM_MS - 1);
			expect(shouldSkipProvisionTrigger({ status: 'pending', startedAt: fresh }, now)).to.be.true;
			expect(shouldSkipProvisionTrigger({ status: 'pending', startedAt: stale }, now)).to.be.false;
		});

		it('does not skip a failed org (retry on next qualifying login)', () => {
			expect(shouldSkipProvisionTrigger({ status: 'failed', startedAt: new Date(now.getTime() - 1) }, now)).to.be.false;
		});

		it('treats a pending marker with an unreadable startedAt as stale (never wedge the org)', () => {
			expect(shouldSkipProvisionTrigger({ status: 'pending', startedAt: 'not-a-date' as unknown as Date }, now)).to.be.false;
		});
	});

	describe('isDuplicateKeyError', () => {
		it('detects the numeric E11000 code', () => {
			expect(isDuplicateKeyError({ code: 11000 })).to.be.true;
		});

		it('detects an E11000 message without the code', () => {
			expect(isDuplicateKeyError(new Error('E11000 duplicate key error collection: matterchat_org_provisions'))).to.be.true;
		});

		it('rejects other errors and non-errors', () => {
			expect(isDuplicateKeyError({ code: 121 })).to.be.false;
			expect(isDuplicateKeyError(new Error('boom'))).to.be.false;
			expect(isDuplicateKeyError(undefined)).to.be.false;
			expect(isDuplicateKeyError('E11000')).to.be.false;
		});
	});
});
