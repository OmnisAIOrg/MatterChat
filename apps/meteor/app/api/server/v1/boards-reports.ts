import {
	ajv,
	isBoardsReportsSourceToSettlementProps,
	isBoardsReportsOverviewProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import { sourceToSettlement, overview } from '../../../../server/lib/boards/reports';
import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
import { API } from '../api';

/**
 * REST surface for Boards REPORTING (M8).
 *
 * `boards.reports.sourceToSettlement` — the closed-loop attribution report
 *   (differentiators.md §7): marketing source/campaign → leads → signed → the
 *   converted matter's CasePro settlement/demand value.
 * `boards.reports.overview` — the composed reporting dashboard (intake funnel +
 *   matters financial/aging/caseload + source-to-settlement), each section nullable.
 *
 * Both are gated by `boards-view-reports` at the route (defense-in-depth; the lib
 * functions self-gate too) and accept an optional ISO 'YYYY-MM-DD' window. Permissive
 * success schema (report payloads are large/nested) mirrors boards-matters.ts.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

API.v1.get(
	'boards.reports.sourceToSettlement',
	{
		authRequired: true,
		query: isBoardsReportsSourceToSettlementProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId; // authRequired guarantees presence; Meteor.userId() is unavailable in this REST context
		if (!(await hasPermissionAsync(uid, 'boards-view-reports'))) {
			return API.v1.unauthorized();
		}
		const { from, to } = this.queryParams;
		const report = await sourceToSettlement(uid, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
		return API.v1.success({ report });
	},
);

API.v1.get(
	'boards.reports.overview',
	{
		authRequired: true,
		query: isBoardsReportsOverviewProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const uid = this.userId; // authRequired guarantees presence; Meteor.userId() is unavailable in this REST context
		if (!(await hasPermissionAsync(uid, 'boards-view-reports'))) {
			return API.v1.unauthorized();
		}
		const { from, to } = this.queryParams;
		const report = await overview(uid, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
		return API.v1.success({ report });
	},
);
