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
 *    NOTE (2026-07-30 fixer): on a workspace that never completed a run under
 *    the old scheme the legacy field was never written, so this seed finds
 *    nothing and org #1 DOES get claimed on the first qualifying login. That is
 *    now bounded rather than papered over: a failed run backs off for an hour
 *    before re-arming (FAILED_RETRY_BACKOFF_MS), so an unavailable roster
 *    endpoint no longer means one outbound call per login.
 *
 * 2. FIRM-ID BACKFILL — stamp `customFields.firmId` (the field PR #166's firm
 *    scoping reads) from `services.omnisai.orgId` for existing OIDC-linked
 *    users that predate login-time stamping.
 *
 *    OPT-IN (2026-07-30 fixer): gated on MATTERCHAT_ORG_FIRM_COHORTS. See
 *    orgFirmCohortsEnabled — `Firms_Scoped_Directory` defaults to true and prod
 *    runs `Firms_SelfServe_Enabled=true`, so PR #166's user scoping is already
 *    ARMED and is inert only because nobody carries a firmId. Stamping
 *    unconditionally would split the live workspace into two mutually invisible
 *    cohorts (OIDC users vs. rocket.cat, bots, password/invite accounts and
 *    not-yet-logged-in roster imports) on the deploy itself. Off by default.
 *
 *    When it IS enabled the run is bounded and single-writer: a lock doc in
 *    `matterchat_org_backfill` means one run per deploy rather than one per pod
 *    boot, and the cursor is paged with an explicit `_id` sort + batch limit
 *    instead of iterating a live, self-mutating collection scan.
 */
import { Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { isOrgFirmCohortStampEnabled, seedOrgProvisionMarkerAsDone, stampFirmIdFromOrg } from './orgProvision';
import { db } from '../../../server/database/utils';
import { SystemLogger } from '../../../server/lib/logger/system';

/** Single-writer lock for the firmId backfill. Bump the id to force a re-run after a code change. */
const BACKFILL_LOCK_COLLECTION = 'matterchat_org_backfill';
const FIRMID_BACKFILL_LOCK_ID = 'firmid-backfill-v1';

/** Page size for the users scan — keeps the run bounded on a large collection. */
const BACKFILL_BATCH_SIZE = 500;

type BackfillLock = { _id: string; startedAt: Date; completedAt?: Date; stamped?: number };

/**
 * Claim the backfill lock. `_id` uniqueness IS the lock, so only one pod (and
 * only one boot) ever runs the scan. Returns false when someone already has it.
 */
async function claimFirmIdBackfill(): Promise<boolean> {
	try {
		const res = await db
			.collection<BackfillLock>(BACKFILL_LOCK_COLLECTION)
			.updateOne({ _id: FIRMID_BACKFILL_LOCK_ID }, { $setOnInsert: { startedAt: new Date() } }, { upsert: true });
		return res.upsertedCount > 0;
	} catch (err) {
		// duplicate key = another pod won the race
		SystemLogger.debug({ msg: 'OmnisAI org-provision backfill: lock not acquired', err });
		return false;
	}
}

async function markFirmIdBackfillDone(stamped: number): Promise<void> {
	await db
		.collection<BackfillLock>(BACKFILL_LOCK_COLLECTION)
		.updateOne({ _id: FIRMID_BACKFILL_LOCK_ID }, { $set: { completedAt: new Date(), stamped } });
}

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

			if (await seedOrgProvisionMarkerAsDone(orgId)) {
				SystemLogger.info({ msg: 'OmnisAI org-provision backfill: seeded done marker from legacy per-admin marker', orgId });
			}
		}
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI org-provision backfill: marker seed failed (non-fatal)', err });
	}

	// Pass 2: stamp customFields.firmId for OIDC-linked users that predate login-time
	// stamping. OPT-IN + single-writer + paged (see the module header).
	if (!isOrgFirmCohortStampEnabled()) {
		return;
	}
	if (!(await claimFirmIdBackfill())) {
		return;
	}

	try {
		let stamped = 0;
		let after: string | undefined;
		for (;;) {
			const batch = await Users.find(
				{
					'services.omnisai.orgId': { $exists: true, $ne: '' },
					'customFields.firmId': { $exists: false },
					...(after ? { _id: { $gt: after } } : {}),
				},
				{ projection: { '_id': 1, 'services.omnisai.orgId': 1 }, sort: { _id: 1 }, limit: BACKFILL_BATCH_SIZE },
			).toArray();
			if (batch.length === 0) {
				break;
			}
			for (const user of batch) {
				const orgId = (user as any)?.services?.omnisai?.orgId;
				if (typeof orgId !== 'string' || !orgId) {
					continue;
				}

				await stampFirmIdFromOrg(user._id, orgId, 'backfill');
				stamped++;
			}
			// paging by _id (not by the guard predicate) — the batch documents no longer
			// match the filter after the stamp, so a plain skip/limit would drift
			after = batch[batch.length - 1]._id;
			if (batch.length < BACKFILL_BATCH_SIZE) {
				break;
			}
		}
		await markFirmIdBackfillDone(stamped);
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
