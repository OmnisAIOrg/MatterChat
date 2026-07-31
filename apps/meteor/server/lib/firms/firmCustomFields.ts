import { Meteor } from 'meteor/meteor';

import { findFirmOwnedCustomFieldKeys } from './firmsHelpers';

/**
 * MATTERCHAT: guard for the generic custom-fields write path.
 *
 * Firm membership lives in `user.customFields.firmId` (+ firmName / firmRole /
 * firmIdSource) and is written ONLY by the firms service — `firms.create`,
 * invite redemption (`adoptUserIntoFirm`), `firms.setUserFirm`, and the OmnisAI
 * org stamp — each of which writes through the Users model directly.
 *
 * Stock `saveCustomFields` is the wrong door for it, twice over:
 *
 *  1. It validates the payload against the admin-authored `Accounts_CustomFields`
 *     schema and DROPS every key the schema does not declare — silently, and it
 *     returns early doing nothing at all when the setting is empty (the default).
 *     `POST users.update {data:{customFields:{firmId:'…'}}}` therefore answered
 *     `success: true` while the user doc never gained a firmId (2026-07-30 smoke
 *     run). An operator "moving" someone between firms got a green checkmark and
 *     no change.
 *  2. If an admin ever DID declare a `firmId` custom field, the same code path is
 *     reachable by every user through `users.updateOwnBasicInfo` /
 *     `saveUserProfile` — self-assignment into any other firm, which is exactly
 *     the boundary PR #166's scoping relies on.
 *
 * So: refuse loudly and name the supported route instead.
 */
export const assertNoFirmOwnedCustomFields = (formData: unknown, method: string): void => {
	const keys = findFirmOwnedCustomFieldKeys(formData);
	if (keys.length === 0) {
		return;
	}
	throw new Meteor.Error(
		'error-firm-custom-fields-readonly',
		`Firm membership fields (${keys.join(', ')}) cannot be set through custom fields. Use the firms.setUserFirm endpoint (admin only).`,
		{ method, fields: keys },
	);
};
