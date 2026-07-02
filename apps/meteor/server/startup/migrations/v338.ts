import { Permissions } from '@rocket.chat/models';

import { addMigration } from '../../lib/migrations';

// CasePro live wire — backfill the boards-casepro-* permission grants on EXISTING installs.
//
// Same mechanics as v337 (legal-roles backfill): constant/permissions.ts only applies to
// permission docs that do not exist yet, and the four boards-casepro-* permissions already
// exist on any workspace that booted a Boards build — so the widened grants
// (partner on all four; attorney on view was already seeded) need a one-time $addToSet.
//
// Grant model (mirrors the enforcement added on the boards.casepro.* / leads sync REST
// surface in this same change):
//   - boards-casepro-view            → admin, partner, attorney (+ case-manager from seed)
//   - boards-casepro-sync            → admin, partner
//   - boards-casepro-write           → admin, partner
//   - boards-manage-casepro-settings → admin, partner
//
// SAFETY: $addToSet only — never overwrites an admin's hand-edited grants; re-running is a
// no-op; missing permission ids are skipped (updateOne without upsert matches nothing).

const caseProGrants: Record<string, string[]> = {
	'boards-casepro-view': ['partner', 'attorney'],
	'boards-casepro-sync': ['partner'],
	'boards-casepro-write': ['partner'],
	'boards-manage-casepro-settings': ['partner'],
};

addMigration({
	version: 338,
	name: 'Grant the boards-casepro-* permissions to the legal leadership roles (partner/attorney)',
	async up() {
		for (const [permissionId, roles] of Object.entries(caseProGrants)) {
			await Permissions.updateOne({ _id: permissionId }, { $addToSet: { roles: { $each: roles } } });
		}
	},
});
