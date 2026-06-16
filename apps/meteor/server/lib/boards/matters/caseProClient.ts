import type { ICaseProClient } from './caseProClientTypes';

/**
 * Re-export of the parallel-built CasePro client (subsystem 04), typed against the
 * local `ICaseProClient` contract this phase consumes.
 *
 * The integrator owns the concrete module at `../casepro/client`; it must export a
 * `caseProClient` value implementing `matterSnapshot` / `listMatters` / `listStages`.
 * We import it here once so the rest of the matters service depends on a single,
 * locally-typed handle (and so a missing parallel module surfaces as ONE import error
 * to wire, not many).
 */
// eslint-disable-next-line import/no-unresolved
export { caseProClient } from '../casepro/client';

// Re-export the contract types for convenience to service/method/REST callers.
export type {
	ICaseProClient,
	CaseProStage,
	CaseProMatterListItem,
	CaseProListMattersOpts,
	CaseProListMattersResult,
} from './caseProClientTypes';

/** Compile-time assertion that the imported value satisfies our contract. */
export type CaseProClientHandle = ICaseProClient;
