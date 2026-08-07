import { API } from '../api';
import { omnisCtx } from './omnisApiContext';
import { recentMattersForUser, resolveRoomMatter, searchMatters } from '../../lib/omnis/matter';

/**
 * The matter-context endpoint every Omnis widget shares.
 *
 * `GET /v1/omnis.matterContext?roomId=` answers the ONE question the shared
 * context rule turns on: does the active screen supply a matter, or must the
 * user be asked?
 *
 *   - Room is matter-linked → `{ bound: <matter> }`. The panel shows a
 *     read-only chip labelled "from this channel" and NO picker.
 *   - Anything else → `{ bound: null, recent: [...] }`. The panel shows the
 *     picker with nothing pre-selected.
 *
 * Note what is deliberately absent: there is no "default" field and no
 * most-recently-used fallback. `recent` is a listing convenience for tier 2 of
 * the picker, and no caller may pre-select from it. Filing a signed fee
 * agreement into the wrong matter is materially worse than one extra click.
 *
 * `GET /v1/omnis.matterSearch?q=` is tier 3 — live search across every matter in
 * the firm, matching name, matter number, or client name. Backed by the existing
 * CasePro client rather than a second path to the CRM.
 */

API.v1.addRoute(
	'omnis.matterContext',
	{ authRequired: true },
	{
		async get() {
			const { roomId } = omnisCtx(this).queryParams as { roomId?: string };

			const bound = roomId ? await resolveRoomMatter(roomId) : null;
			if (bound) {
				// Inside a matter channel the picker is not offered at all, so the
				// recent list would be dead weight.
				return API.v1.success({ bound, recent: [] });
			}

			return API.v1.success({ bound: null, recent: await recentMattersForUser(omnisCtx(this).userId) });
		},
	},
);

API.v1.addRoute(
	'omnis.matterSearch',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 120, intervalTimeInMS: 60000 } },
	{
		async get() {
			const { q, limit } = omnisCtx(this).queryParams as { q?: string; limit?: string };
			const parsedLimit = Math.min(Math.max(Number.parseInt(limit ?? '20', 10) || 20, 1), 50);
			return API.v1.success({ matters: await searchMatters(q ?? '', parsedLimit) });
		},
	},
);
