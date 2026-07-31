import type { IUser } from '@rocket.chat/core-typings';
import type { Updater } from '@rocket.chat/models';
import type { ClientSession } from 'mongodb';

import { saveCustomFieldsWithoutValidation } from './saveCustomFieldsWithoutValidation';
import { validateCustomFields } from './validateCustomFields';
import { trim } from '../../../../lib/utils/stringUtils';
// MATTERCHAT: firm membership is not a user-editable custom field — see the guard's header
import { assertNoFirmOwnedCustomFields } from '../../../../server/lib/firms/firmCustomFields';
import { settings } from '../../../settings/server';

export const saveCustomFields = async function (
	userId: string,
	formData: Record<string, any>,
	options?: { _updater?: Updater<IUser>; session?: ClientSession },
): Promise<void> {
	// MATTERCHAT: must run BEFORE the Accounts_CustomFields early-return below, which
	// otherwise swallows a firmId write and reports success (2026-07-30 smoke defect).
	assertNoFirmOwnedCustomFields(formData, 'saveCustomFields');

	if (trim(settings.get('Accounts_CustomFields')).length === 0) {
		return;
	}

	validateCustomFields(formData);
	return saveCustomFieldsWithoutValidation(userId, formData, options);
};
