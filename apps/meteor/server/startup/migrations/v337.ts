import { Permissions } from '@rocket.chat/models';

import { addMigration } from '../../lib/migrations';

// MatterChat legal roles (partner / attorney / paralegal) — backfill permission grants on
// EXISTING installs.
//
// The role records themselves are seeded on every start by upsertPermissions.ts (idempotent),
// but the permission grants in constant/permissions.ts only apply to permission docs that do
// not exist yet: `Permissions.create(id, roles)` returns early when the _id is already in the
// DB. Every core permission below already exists on a live workspace, so without this
// migration the new roles would show up with zero grants outside fresh databases.
//
// SAFETY: $addToSet only — never overwrites an admin's hand-edited grants, and re-running is a
// no-op. Missing permission ids are skipped (updateOne without upsert matches nothing).

const legalRoleGrants: Record<string, string[]> = {
	// Partner — firm leadership (admin-tier workspace + room powers).
	'access-permissions': ['partner'],
	'view-room-administration': ['partner'],
	'view-user-administration': ['partner'],
	'add-user-to-any-c-room': ['partner'],
	'add-user-to-any-p-room': ['partner'],
	'archive-room': ['partner'],
	'ban-user': ['partner'],
	'delete-c': ['partner'],
	'delete-p': ['partner'],
	'delete-message': ['partner'],
	'edit-message': ['partner'],
	'edit-room': ['partner'],
	'mute-user': ['partner'],
	'remove-user': ['partner'],
	'set-leader': ['partner'],
	'set-moderator': ['partner'],
	'set-owner': ['partner'],
	'set-readonly': ['partner'],
	'boards-view': ['partner'],
	'boards-create': ['partner'],
	'boards-admin': ['partner'],

	// Attorney — create + participate; room-level powers come per-room via the `owner`
	// subscription role on channels they create (deliberately NOT granted globally).
	'create-c': ['partner', 'attorney'],
	'create-p': ['partner', 'attorney'],
	'pin-message': ['partner', 'attorney'],
	'mention-all': ['partner', 'attorney'],

	// Paralegal — view/participate only (no create/delete/admin).
	'view-c-room': ['partner', 'attorney', 'paralegal'],
	'view-p-room': ['partner', 'attorney', 'paralegal'],
	'view-joined-room': ['partner', 'attorney', 'paralegal'],
	'preview-c-room': ['partner', 'attorney', 'paralegal'],
	'delete-own-message': ['partner', 'attorney', 'paralegal'],
};

addMigration({
	version: 337,
	name: 'Grant core permissions to the MatterChat legal roles (partner/attorney/paralegal)',
	async up() {
		for await (const [permissionId, roles] of Object.entries(legalRoleGrants)) {
			await Permissions.updateOne({ _id: permissionId }, { $addToSet: { roles: { $each: roles } } });
		}
	},
});
