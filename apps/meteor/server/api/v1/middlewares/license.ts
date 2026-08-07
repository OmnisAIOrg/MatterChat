/**
 * MATTERCHAT: MIT replacement for the EE route-license middleware
 * (was imported from ee/app/api-enterprise/server/middlewares/license; the EE tree is removed).
 *
 * Routes may declare `license: [...modules]` in their options (see definition.ts). On a pure-MIT
 * MatterChat no premium module is ever active (the community-edition license service reports
 * hasModule() === false for everything), so any route still declaring a license requirement —
 * they were all EE routes, now deleted — responds 403 rather than crashing the router setup.
 * Routes without a license requirement pass straight through.
 */
import type { LicenseImp } from '@rocket.chat/license';
import type { MiddlewareHandler } from 'hono';

import { API } from '../../api';
import type { TypedOptions } from '../../definition';
import type { HonoContext } from '../../router';

export const license =
	(options: TypedOptions, licenseService: LicenseImp): MiddlewareHandler =>
	async (c: HonoContext, next) => {
		if (!options.license?.length) {
			return next();
		}

		const missing = options.license.filter((module) => !licenseService.hasModule(module));
		if (missing.length) {
			const failure = API.v1.forbidden('This endpoint requires a premium license [error-unauthorized]');
			return c.json(failure.body, failure.statusCode);
		}

		return next();
	};
