import type { IActionCaseproWriteback, IActionLitboxRequestFolder, IBoardCard } from '@rocket.chat/core-typings';
import { BoardsActivities } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { caseProClient } from '../../../lib/boards/casepro/client';
import { isLiveTransportConfigured } from '../../../lib/boards/casepro/live';
import type { CaseProRow } from '../../../lib/boards/casepro/transport';
import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * Integration action handlers (M7 — §4.5 / §5.3 "Actions — Integration", P3). CasePro
 * write-backs are TRIPLE-gated:
 *
 *   1. the `Boards_Automation_CasePro_Writeback_Enabled` setting,
 *   2. the `boards-automation-casepro-writeback` permission (acting user for a
 *      button/REST run; the automation's author for a system/scheduled actor),
 *   3. a LIVE CasePro transport (`isLiveTransportConfigured`) — writes are only
 *      EXECUTED when the 'rest' transport + base URL are configured. Without a live
 *      transport the handler keeps the original audit-only behavior: it validates,
 *      records the planned write (`executed:false`) on the activity feed, and returns
 *      `skipped` with `skippedReason:'no-live-transport'`.
 *
 * Gate-fail on 1/2 is `skipped` with `skippedReason:'writeback-disabled'` (per the
 * Foundations decision). The contract is validate → execute: an operation is only
 * executed after its validation passes, and the run records `validated`/`executed`/
 * `caseproRef` (+ `caseproResponse` when executed) for audit.
 *
 * EXECUTION goes through the one `caseProClient` (matters writes ride the same
 * transport verbs the intake write-through uses; auth wiring lives in transport.ts and
 * is owned by the auth-wire lane). `updateField` only writes ALLOW-LISTED matters
 * columns ({@link WRITEBACK_FIELD_ALLOWLIST}). An in-memory idempotency guard drops a
 * re-fire of the SAME card+operation+field+value within {@link WRITEBACK_TTL_MS}
 * (`skippedReason:'duplicate-op'`) so cascade/echo re-triggers can't double-write.
 */

function writebackEnabled(): boolean {
	try {
		return settings.get('Boards_Automation_CasePro_Writeback_Enabled') === true;
	} catch {
		return false;
	}
}

/** Resolve the CasePro matter id this card writes back to (matter-linked cards only). */
function matterIdFor(card: IBoardCard | undefined): string | undefined {
	return card?.link?.kind === 'matter' ? card.link.matterId : undefined;
}

/**
 * The `matters` columns `updateField` may write. Conservative on purpose (the
 * IActionCaseproWriteback contract promises an allow-list): operational columns only —
 * never money, never identity/FK columns. Extend deliberately, with founder sign-off.
 */
const WRITEBACK_FIELD_ALLOWLIST = new Set(['stage_id', 'sub_stage', 'liability_status', 'status', 'description']);

// ---------------------------------------------------------------------------
// Idempotency guard — same card + same op (operation/field/value) within TTL
// executes once; re-fires are `skipped:'duplicate-op'`. In-memory (single-node,
// same caveat as the automation queue §14.1).
// ---------------------------------------------------------------------------

const WRITEBACK_TTL_MS = 5 * 60_000;

const recentOps = new Map<string, number>();

/** true ⇒ this exact op already EXECUTED within the TTL. Records the op when new. */
function isDuplicateOp(key: string, nowTs = Date.now()): boolean {
	for (const [k, ts] of recentOps) {
		if (nowTs - ts > WRITEBACK_TTL_MS) {
			recentOps.delete(k);
		}
	}
	const seen = recentOps.get(key);
	if (seen !== undefined && nowTs - seen <= WRITEBACK_TTL_MS) {
		return true;
	}
	recentOps.set(key, nowTs);
	return false;
}

/** Test hook: clear the idempotency window between cases. */
export function __resetWritebackStateForTests(): void {
	recentOps.clear();
}

export async function handleCaseproWriteback(action: IActionCaseproWriteback, ctx: AutomationContext, index: number) {
	try {
		// Gate 1: master setting.
		if (!writebackEnabled()) {
			return skipped(index, action.type, 'writeback-disabled', 'CasePro write-back disabled (setting)');
		}
		// Gate 2: explicit `boards-automation-casepro-writeback` permission.
		//  - Real-user actor (button/REST run): the acting user must hold it (direct check).
		//  - System/automation actor (scheduled tick / cascade child): no live user is present,
		//    so we require the automation's AUTHOR (`createdBy`) to hold it. This stops a
		//    scheduled/cascaded write-back from running under no human authority just because
		//    the master setting is on (M7 LOW). Deny gracefully (skipped) when there's no
		//    author or the author lacks the permission — never throw.
		const isSystemActor = !ctx.actor || ctx.actor === 'system' || ctx.actor.startsWith('automation:');
		const permActor = isSystemActor ? ctx.automation.createdBy : ctx.actor;
		if (!permActor) {
			return skipped(index, action.type, 'writeback-disabled', 'no actor authorized for CasePro write-back');
		}
		if (!(await hasPermissionAsync(permActor, 'boards-automation-casepro-writeback'))) {
			return skipped(index, action.type, 'writeback-disabled', 'missing boards-automation-casepro-writeback permission');
		}

		const matterId = matterIdFor(ctx.subject.card);
		if (action.operation !== 'createMatterFromLead' && !matterId) {
			return skipped(index, action.type, 'unsupported', `${action.operation} requires a matter-linked card`);
		}

		// Build the validate→execute descriptor (the CasePro op + entity/id/field).
		const caseproRef = buildCaseproRef(action, matterId);

		if (ctx.dryRun) {
			// dry-run validates only (spec §8.2): record the planned op, never execute.
			return { ...planned(index, action.type, `casepro ${action.operation}`), validated: true, caseproRef };
		}

		const { value: rawValue } = interpolateString(String(action.value ?? ''), ctx);

		// Gate 3: live transport. Without one, keep the original audit-only behavior —
		// validate + record the planned write, never execute.
		if (!isLiveTransportConfigured()) {
			await BoardsActivities.log({
				boardId: ctx.boardId,
				...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
				actor: `automation:${ctx.automation._id}`,
				verb: 'automation.ran',
				to: { caseproWriteback: action.operation, ...caseproRef, value: rawValue, executed: false, skippedReason: 'no-live-transport' },
				ts: new Date(),
			});
			return {
				...skipped(index, action.type, 'no-live-transport', `validated casepro ${action.operation} — no live CasePro transport (audit-only)`),
				validated: true,
				executed: false,
				caseproRef,
			};
		}

		// validate_operation: resolve the concrete client call (and its idempotency key)
		// or bail as `unsupported` — an op is only executed after this passes.
		let opKey: string;
		let execute: () => Promise<{ response: CaseProRow; summary: Record<string, unknown> }>;
		switch (action.operation) {
			case 'advanceStage': {
				if (!action.stageId || !matterId) {
					return skipped(index, action.type, 'unsupported', 'advanceStage requires a stageId and a matter-linked card');
				}
				const stageId = action.stageId;
				const id = matterId;
				opKey = `advanceStage:${stageId}`;
				execute = async () => {
					const response = await caseProClient.updateMatter(id, { stage_id: stageId });
					return { response, summary: { id: response.id, stage_id: response.stage_id } };
				};
				break;
			}
			case 'updateField': {
				if (!action.field || !matterId) {
					return skipped(index, action.type, 'unsupported', 'updateField requires a field and a matter-linked card');
				}
				if (!WRITEBACK_FIELD_ALLOWLIST.has(action.field)) {
					return skipped(index, action.type, 'unsupported', `matters column '${action.field}' is not writeback allow-listed`);
				}
				const field = action.field;
				const id = matterId;
				opKey = `updateField:${field}=${rawValue}`;
				execute = async () => {
					const response = await caseProClient.updateMatter(id, { [field]: rawValue });
					return { response, summary: { id: response.id, [field]: response[field] } };
				};
				break;
			}
			case 'createMatterFromLead': {
				const intakeId = ctx.subject.lead?.caseproIntakeId;
				if (!intakeId) {
					return skipped(index, action.type, 'unsupported', 'createMatterFromLead requires a CasePro-linked lead (caseproIntakeId)');
				}
				opKey = `createMatterFromLead:${intakeId}`;
				execute = async () => {
					const { matterId: createdId } = await caseProClient.createMatterFromIntake(intakeId);
					return { response: { id: createdId }, summary: { id: createdId } };
				};
				break;
			}
			default:
				return skipped(index, action.type, 'unsupported', `unknown casepro operation`);
		}

		// Idempotency: the same card+op within the TTL executes once.
		const subjectKey = ctx.subject.card?._id ?? ctx.subject.lead?._id ?? ctx.boardId;
		const dedupeKey = `${subjectKey}:${opKey}`;
		if (isDuplicateOp(dedupeKey)) {
			return {
				...skipped(index, action.type, 'duplicate-op', `casepro ${action.operation} already executed for this card+field within TTL`),
				validated: true,
				executed: false,
				caseproRef,
			};
		}

		// execute_operation — through the one caseProClient. A failure frees the
		// idempotency slot (so a retry may run) and surfaces as an `error` result.
		let summary: Record<string, unknown>;
		try {
			({ summary } = await execute());
		} catch (err) {
			recentOps.delete(dedupeKey);
			throw err;
		}

		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'automation.ran',
			to: { caseproWriteback: action.operation, ...caseproRef, value: rawValue, executed: true, response: summary },
			ts: new Date(),
		});

		return {
			...ok(index, action.type, `executed casepro ${action.operation}`),
			validated: true,
			executed: true,
			caseproRef,
			caseproResponse: summary,
		};
	} catch (err) {
		return errored(index, action.type, err);
	}
}

/** Map the writeback action to the CasePro entity/op descriptor recorded on the run. */
function buildCaseproRef(action: IActionCaseproWriteback, matterId?: string): { entity: string; id?: string; op: string } {
	switch (action.operation) {
		case 'advanceStage':
			return { entity: 'matters', ...(matterId ? { id: matterId } : {}), op: `update:stage_id=${action.stageId ?? ''}` };
		case 'updateField':
			return { entity: 'matters', ...(matterId ? { id: matterId } : {}), op: `update:${action.field ?? ''}` };
		case 'createMatterFromLead':
			return { entity: 'matters', op: 'create' };
		default:
			return { entity: 'matters', op: 'unknown' };
	}
}

export async function handleLitboxRequestFolder(action: IActionLitboxRequestFolder, ctx: AutomationContext, index: number) {
	try {
		const matterId = matterIdFor(ctx.subject.card);
		if (!matterId) {
			return skipped(index, action.type, 'unsupported', 'litboxRequestFolder requires a matter-linked card');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `ensure LitBox folder for matter ${matterId}`);
		}
		// LitBox provisioning is the integrator's seam (matters.litbox_workspace_id). Record
		// the request as an audit signal; the concrete LitBox client call is P3.
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'automation.ran',
			to: { litboxRequestFolder: matterId, requested: true },
			ts: new Date(),
		});
		return ok(index, action.type, `requested LitBox folder for matter ${matterId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}
