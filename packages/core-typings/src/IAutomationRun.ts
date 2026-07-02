import type { BoardAutomationTriggerEvent } from './IAutomation';
import type { IRocketChatRecord } from './IRocketChatRecord';

/**
 * Append-only execution journal for the automation engine (Tier 3, collection
 * `boards_automation_runs`). One doc per fired automation (rule / button /
 * scheduled / sequence step). Db-only, never trashed — it is the structured
 * machine record that backs the run-log/audit view and the loop-guard
 * accounting, complementing the human `boards_activities` feed
 * (`actor:'automation:<id>'`). See 05-automation-engine.md §4.4 / §11.
 */

export type AutomationRunStatus = 'ok' | 'partial' | 'error' | 'skipped' | 'dry-run';

export type AutomationActionStatus = 'ok' | 'error' | 'skipped';

/** Per-action outcome within a run (position-indexed into automation.actions[]). */
export interface IAutomationActionResult {
	index: number;
	type: string; // BoardAutomationActionType (copied as string)
	ok: boolean;
	status: AutomationActionStatus;
	detail?: string; // human summary, e.g. "moved Intake → Treating"
	error?: string;
	skippedReason?:
		| 'loop-depth'
		| 'per-card-budget'
		| 'writeback-disabled'
		| 'disabled'
		| 'condition'
		| 'unsupported'
		| 'no-live-transport' // gates passed but no live CasePro transport configured — validated + audited, not executed
		| 'duplicate-op'; // idempotency guard: same card+field op already executed within the TTL
	// integration audit (CasePro write-backs)
	validated?: boolean; // validate_operation passed
	executed?: boolean; // execute_operation ran
	caseproRef?: { entity: string; id?: string; op: string };
	/** raw row the executed write returned (audit; absent unless executed). */
	caseproResponse?: Record<string, unknown>;
}

export interface IAutomationRun extends IRocketChatRecord {
	automationId: string;
	automationName?: string; // denormalized for the run-log without a join
	boardId?: string;
	kind?: string; // copy of automation.kind
	event?: BoardAutomationTriggerEvent | 'schedule' | 'manual'; // what fired it
	cardId?: string; // subject card (if any)
	leadId?: string;
	actor: string; // user _id | 'system' (scheduled/cron) | 'automation:<id>' (cascade)

	status: AutomationRunStatus;
	loopDepth: number; // loop-guard depth at fire time
	startedAt: Date;
	finishedAt?: Date;
	durationMs?: number;

	actionsRun: IAutomationActionResult[];
	error?: string; // top-level failure (engine error, not a single action)
}
