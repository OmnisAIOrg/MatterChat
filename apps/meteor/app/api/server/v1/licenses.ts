/**
 * MATTERCHAT: MIT licenses REST surface, replacing the EE routes (were ee/server/api/licenses.ts,
 * removed with the Enterprise tree).
 *
 * The admin client (useLicense in @rocket.chat/ui-client, the administration menu, subscription
 * page) unconditionally fetches GET /v1/licenses.info at load. On a pure-MIT MatterChat the
 * truthful answer is a permanent community edition: no license, no active modules, nothing
 * prevented, no limits enforced. Serving that (instead of a 404) keeps every premium surface
 * cleanly hidden and the admin UI functional.
 *
 * licenses.maxActiveUsers is included for the admin users screens: unlimited (null max).
 * licenses.add / licenses.requestSeatsLink are deliberately NOT implemented — they only exist
 * behind premium upsell surfaces that are hidden when hasValidLicense is false.
 */
import type { LicenseInfo, LicenseLimitKind } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';
import { ajv, isLicensesInfoProps } from '@rocket.chat/rest-typings';

import { API } from '../api';

const PERMISSIVE_SUCCESS = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

const COMMUNITY_LICENSE_INFO: LicenseInfo = {
	license: undefined,
	activeModules: [],
	externalModules: [],
	// No action is ever prevented and no limit is ever enforced on a community workspace.
	// The Records are keyed by LicenseLimitKind; premium screens that would read them are
	// hidden when hasValidLicense is false, so empty objects are safe here.
	preventedActions: {} as Record<LicenseLimitKind, boolean>,
	limits: {} as LicenseInfo['limits'],
	tags: [],
	trial: false,
	hasValidLicense: false,
};

API.v1.get(
	'licenses.info',
	{
		authRequired: true,
		query: isLicensesInfoProps,
		response: {
			200: PERMISSIVE_SUCCESS,
		},
	},
	async function action() {
		return API.v1.success({ license: COMMUNITY_LICENSE_INFO });
	},
);

API.v1.get(
	'licenses.maxActiveUsers',
	{
		authRequired: true,
		response: {
			200: PERMISSIVE_SUCCESS,
		},
	},
	async function action() {
		return API.v1.success({
			maxActiveUsers: null,
			activeUsers: await Users.getActiveLocalUserCount(),
		});
	},
);
