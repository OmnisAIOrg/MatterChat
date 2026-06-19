import type { IMatterSnapshot } from '@rocket.chat/core-typings';

import { caseProClient } from '../matters/caseProClient';

/**
 * Shared, short-TTL in-process memo for the matters-snapshot set the lead intake
 * checks fan out over (M6 — load reduction for conflict + dedupe, see
 * intake-lead-management.md §5).
 *
 * Both `runConflictCheck` and `checkDuplicates` previously did the SAME expensive
 * fan-out independently — `caseProClient.listMatters({ limit: 200 })` then a
 * `Promise.all` of up to 200 `matterSnapshot()` reads — and LeadPanel fires BOTH on
 * every card open (~400 CasePro reads per open). This memo collapses that to ONE
 * fetch per lead-open, reused by both checks (and by every other lead opened inside
 * the TTL window).
 *
 * HARD RULES preserved:
 *   - CasePro is read ONLY through the single matters `caseProClient` (queryAll under
 *     the hood); we never open a second client.
 *   - Degrades GRACEFULLY: a CasePro failure rejects the in-flight promise and is NOT
 *     cached (so the next call retries), and callers keep their existing try/catch →
 *     'unknown' / omit-matter-candidates paths. This module never throws on its own.
 *   - The fan-out stays CAPPED at `MAX_MATTERS_SCANNED`; results are not sorted here
 *     (each caller sorts its own match list).
 */

/** Cap the snapshot fan-out so a huge org never makes the checks pathological. */
export const MAX_MATTERS_SCANNED = 200;

/** Memo lifetime. Long enough that the two checks on one card-open share a fetch (and
 * back-to-back card opens reuse it), short enough that stage/party edits surface fast. */
const TTL_MS = 60 * 1000;

type MemoEntry = {
	expiresAt: number;
	promise: Promise<IMatterSnapshot[]>;
};

let memo: MemoEntry | undefined;

/**
 * Do the actual capped fan-out: list matters, then resolve each snapshot (per-matter
 * failures are swallowed to a null and dropped), returning the non-null snapshots.
 * A list-level failure propagates so the caller's catch sees an unreachable CasePro.
 */
async function fetchSnapshots(): Promise<IMatterSnapshot[]> {
	const { matters } = await caseProClient.listMatters({ limit: MAX_MATTERS_SCANNED });
	const slice = matters.slice(0, MAX_MATTERS_SCANNED);
	const snapshots = await Promise.all(
		slice.map(async (m) => {
			try {
				return await caseProClient.matterSnapshot(m.matterId);
			} catch {
				return null;
			}
		}),
	);
	return snapshots.filter((s): s is IMatterSnapshot => Boolean(s));
}

/**
 * Return the shared matters-snapshot set, fetching at most once per TTL window. The
 * in-flight promise is cached immediately so two near-simultaneous callers (conflict
 * + dedupe on the same card open) share ONE fetch. A rejected fetch is evicted so the
 * next call retries rather than caching the failure (graceful degradation).
 *
 * May reject if CasePro is unreachable — callers MUST keep their existing try/catch.
 */
export async function getMattersSnapshots(): Promise<IMatterSnapshot[]> {
	const now = Date.now();
	if (memo && memo.expiresAt > now) {
		return memo.promise;
	}

	const promise = fetchSnapshots();
	memo = { expiresAt: now + TTL_MS, promise };
	// evict on failure so we don't serve (or keep) a cached rejection.
	promise.catch(() => {
		if (memo?.promise === promise) {
			memo = undefined;
		}
	});
	return promise;
}

/** Drop the memo (tests / forced refresh). */
export function clearMattersSnapshotsMemo(): void {
	memo = undefined;
}
