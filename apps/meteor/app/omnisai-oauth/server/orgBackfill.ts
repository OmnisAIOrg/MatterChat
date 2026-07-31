/**
 * MATTERCHAT: startup backfill for org provisioning (2026-07-30 org-readiness
 * audit follow-up). Imported for side effect from ./index.ts. Two idempotent
 * passes at boot, both cheap after the first run (their guard queries match
 * nothing):
 *
 * 1. MARKER SEED — create a 'done' marker in `matterchat_org_provisions` for
 *    every org recorded by the LEGACY per-admin marker
 *    (services.omnisai.provisionedOrgId, only ever written after a successful
 *    run). This is what makes the FIRST deploy of the per-org trigger safe on
 *    the live workspace: org #1 was provisioned under the old scheme, so
 *    without the seed the next admin login would claim and re-run it (harmless
 *    — the import dedups — but pointless and noisy). $setOnInsert-only, so an
 *    existing marker is never touched.
 *
 * 2. FIRM-ID BACKFILL — stamp `customFields.firmId` (the field PR #166's firm
 *    scoping reads) from `services.omnisai.orgId` for existing OIDC-linked
 *    users that predate login-time stamping. The find filter
 *    ({ orgId exists, firmId absent }) IS the guard: after the first run it
 *    matches nothing and the boot cost is one indexless scan of the (small)
 *    users collection. Users with an existing firmId (self-serve firms) are
 *    excluded by the filter — never overwritten.
 *
 * Deliberately NOT gated on Firms_SelfServe_Enabled / Firms_Scoped_Directory:
 * firmId is harmless metadata while the firms feature is off (every scoping
 * query no-ops), and stamping eagerly means flipping the feature on later
 * requires no re-migration.
 */
import { Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../../server/lib/logger/system';
import { seedOrgProvisionMarkerAsDone, stampFirmIdFromOrg } from './orgProvision';

export async function runOrgProvisionBackfill(): Promise<void> {
	// Pass 1: seed per-org markers from the legacy per-admin field.
	try {
		const legacyOrgIds = (await Users.col.distinct('services.omnisai.provisionedOrgId', {
			'services.omnisai.provisionedOrgId': { $exists: true, $ne: '' },
		})) as unknown[];
		for (const orgId of legacyOrgIds) {
			if (typeof orgId !== 'string' || !orgId) {
				continue;
			}
			// eslint-disable-next-line no-await-in-loop
			if (await seedOrgProvisionMarkerAsDone(orgId)) {
				SystemLogger.info({ msg: 'OmnisAI org-provision backfill: seeded done marker from legacy per-admin marker', orgId });
			}
		}
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI org-provision backfill: marker seed failed (non-fatal)', err });
	}

	// Pass 2: stamp customFields.firmId for OIDC-linked users that predate login-time stamping.
	try {
		let stamped = 0;
		const cursor = Users.find(
			{ 'services.omnisai.orgId': { $exists: true, $ne: '' }, 'customFields.firmId': { $exists: false } },
			{ projection: { '_id': 1, 'services.omnisai.orgId': 1 } },
		);
		for await (const user of cursor) {
			const orgId = (user as any)?.services?.omnisai?.orgId;
			if (typeof orgId !== 'string' || !orgId) {
				continue;
			}
			// eslint-disable-next-line no-await-in-loop
			await stampFirmIdFromOrg(user._id, orgId, 'backfill');
			stamped++;
		}
		if (stamped > 0) {
			SystemLogger.info({ msg: 'OmnisAI org-provision backfill: stamped customFields.firmId from services.omnisai.orgId', stamped });
		}
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI org-provision backfill: firmId backfill failed (non-fatal)', err });
	}
}

Meteor.startup(() => {
	void runOrgProvisionBackfill();
});
