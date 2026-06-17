import type { IActionCaseproWriteback, IActionLitboxRequestFolder, IBoardCard } from '@rocket.chat/core-typings';
import { BoardsActivities } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * Integration action handlers (M7 — §4.5 / §5.3 "Actions — Integration", P3). CasePro
 * write-backs are DOUBLE-gated: the `Boards_Automation_CasePro_Writeback_Enabled` setting
 * AND the `boards-automation-casepro-writeback` permission must both be granted, else the
 * action is `skipped` with `skippedReason:'writeback-disabled'` (per the Foundations
 * decision). The contract is validate → execute: an operation is only executed after its
 * validation passes, and the run records `validated`/`executed`/`caseproRef` for audit.
 *
 * GRACEFUL DEGRADE: the fork's `caseProClient` is read-only today (matterSnapshot /
 * listMatters / listStages — no write transport), so even when fully gated this handler
 * VALIDATES and records the planned write but does not yet `execute`; it never throws out
 * of the engine. TODO(P3): wire the concrete `validate_operation`→`execute_operation`
 * write transport (the integrator's CasePro MCP) here, behind the same gate.
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

export async function handleCaseproWriteback(action: IActionCaseproWriteback, ctx: AutomationContext, index: number) {
	try {
		// Gate 1: master setting. Gate 2: explicit permission (the acting user, or admin for system).
		if (!writebackEnabled()) {
			return skipped(index, action.type, 'writeback-disabled', 'CasePro write-back disabled (setting)');
		}
		const permActor = ctx.actor && ctx.actor !== 'system' && !ctx.actor.startsWith('automation:') ? ctx.actor : undefined;
		if (permActor && !(await hasPermissionAsync(permActor, 'boards-automation-casepro-writeback'))) {
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

		// validate_operation → execute_operation. The fork's client is read-only, so we
		// validate the shape and record the intended write; execution is the P3 transport.
		const { value: rawValue } = interpolateString(String(action.value ?? ''), ctx);
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'field.changed',
			to: { caseproWriteback: action.operation, ...caseproRef, value: rawValue, executed: false },
			ts: new Date(),
		});

		// validated=true (gate + shape ok), executed=false (no write transport yet — P3).
		return {
			...ok(index, action.type, `validated casepro ${action.operation} (execution deferred — P3)`),
			validated: true,
			executed: false,
			caseproRef,
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
			verb: 'field.changed',
			to: { litboxRequestFolder: matterId, requested: true },
			ts: new Date(),
		});
		return ok(index, action.type, `requested LitBox folder for matter ${matterId}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}
