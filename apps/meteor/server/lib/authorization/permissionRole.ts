import { License } from '@rocket.chat/core-services';
import { Permissions, Roles } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from './hasPermission';
import { CONSTANTS, AuthorizationUtils } from '../../../app/authorization/lib';
// MATTERCHAT: firm-grade privilege trail — permission grants/revocations are audited here, the one
// choke point shared by BOTH the REST endpoints (/v1/permissions.addRole, .removeRole) and the
// deprecated DDP methods. Auditing only the DDP wrappers would go dark as callers move to REST.
import { auditPermissionChanged } from '../auditServerEvents/auditAuthorizationChanges';
import { notifyOnPermissionChangedById } from '../notifyListener';

export const addPermissionToRoleMethod = async (uid: string, permissionId: string, role: string): Promise<void> => {
	if (role === 'guest' && !AuthorizationUtils.hasRestrictionsToRole(role) && (await License.hasValidLicense())) {
		AuthorizationUtils.addRolePermissionWhiteList(role, await License.getGuestPermissions());
	}

	if (AuthorizationUtils.isPermissionRestrictedForRole(permissionId, role)) {
		throw new Meteor.Error('error-action-not-allowed', 'Permission is restricted', {
			method: 'authorization:addPermissionToRole',
			action: 'Adding_permission',
		});
	}

	const permission = await Permissions.findOneById(permissionId);

	if (!permission) {
		throw new Meteor.Error('error-invalid-permission', 'Permission does not exist', {
			method: 'authorization:addPermissionToRole',
			action: 'Adding_permission',
		});
	}

	if (!(await Roles.findOneById(role, { projection: { _id: 1 } }))) {
		throw new Meteor.Error('error-invalid-role', 'Role does not exist', {
			method: 'authorization:addPermissionToRole',
			action: 'Adding_permission',
		});
	}

	if (
		!(await hasPermissionAsync(uid, 'access-permissions')) ||
		(permission.level === CONSTANTS.SETTINGS_LEVEL && !(await hasPermissionAsync(uid, 'access-setting-permissions')))
	) {
		throw new Meteor.Error('error-action-not-allowed', 'Adding permission is not allowed', {
			method: 'authorization:addPermissionToRole',
			action: 'Adding_permission',
		});
	}

	if (permission.groupPermissionId) {
		await Permissions.addRole(permission.groupPermissionId, role);
		void notifyOnPermissionChangedById(permission.groupPermissionId);
	}

	await Permissions.addRole(permission._id, role);

	void notifyOnPermissionChangedById(permission._id);

	void auditPermissionChanged(uid, 'granted', permission._id, role).catch(() => undefined);
};

export const removeRoleFromPermissionMethod = async (uid: string, permissionId: string, role: string): Promise<void> => {
	const permission = await Permissions.findOneById(permissionId);

	if (!permission) {
		throw new Meteor.Error('error-permission-not-found', 'Permission not found', {
			method: 'authorization:removeRoleFromPermission',
		});
	}

	if (
		!(await hasPermissionAsync(uid, 'access-permissions')) ||
		(permission.level === CONSTANTS.SETTINGS_LEVEL && !(await hasPermissionAsync(uid, 'access-setting-permissions')))
	) {
		throw new Meteor.Error('error-action-not-allowed', 'Removing permission is not allowed', {
			method: 'authorization:removeRoleFromPermission',
			action: 'Removing_permission',
		});
	}

	if (permission.groupPermissionId) {
		await Permissions.removeRole(permission.groupPermissionId, role);
		void notifyOnPermissionChangedById(permission.groupPermissionId);
	}

	await Permissions.removeRole(permission._id, role);
	void notifyOnPermissionChangedById(permission._id);

	void auditPermissionChanged(uid, 'revoked', permission._id, role).catch(() => undefined);
};
