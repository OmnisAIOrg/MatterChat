import type {
	IActionCaseproWriteback,
	IActionLitboxRequestFolder,
	IAutomationActionResult,
	IBoardCard,
	ILead,
} from '@rocket.chat/core-typings';
import { BoardsActivities, BoardsLeads } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { caseProClient, caseProMode } from '../../../lib/boards/casepro';
import type { IntakePatchInput } from '../../../lib/boards/casepro';
import { pushStage } from '../../../lib/boards/leads/caseproSync';
import { convertToMatter } from '../../../lib/boards/leads/service';
import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * Integration action handlers (M7 — §4.5 / §5.3 "Actions — Integration", P3). CasePro
 * write-backs are TRIPLE-gated, in order:
 *
 *   1. the `Boards_Automation_CasePro_Writeback_Enabled` setting — else `skipped` with
 *      `skippedReason:'writeback-disabled'` (per the Foundations decision);
 *   2. the `boards-automation-casepro-writeback` permission — checked against the acting
 *      user for a real-user (button/REST) run, and against the automation's author
 *      (`createdBy`) for a system/automation actor (scheduled tick / cascade child) so a
 *      non-interactive write-back still runs under a real human's authority;
 *   3. the unified CasePro enablement — `caseProMode().enabled` false means the
 *      integration is off and EVERY write must no-op: `skipped` with
 *      `skippedReason:'casepro-disabled'`.
 *
 * The contract is validate → execute: an operation is only executed after its validation
 * passes, and the run records `validated`/`executed`/`caseproRef` for audit. Execution is
 * REAL — `caseProClient` exposes a write transport for the intake pillar, and each
 * operation is wired to it:
 *
 *   - `advanceStage`   → `caseProClient.updateIntakeStage` (an explicit `stageId` is the
 *     CasePro `intake_stages.id`; with no `stageId` the lead's CURRENT column is mirrored
 *     via the canonical `pushStage` column→stage binding — the seeded "matching stage"
 *     template);
 *   - `updateField`    → `caseProClient.updateIntake`, restricted to the
 *     {@link INTAKE_PATCH_FIELDS} whitelist (the scalar `IntakePatchInput` columns);
 *   - `createMatterFromLead` → the leads-service `convertToMatter`, which wraps
 *     `caseProClient.createMatterFromIntake` PLUS all conversion bookkeeping (POA gate,
 *     matter-card bind, `markConverted`, activity log, `lead.converted` event, drip stop)
 *     so the automation path is identical to the manual convert flow. An
 *     already-converted lead is `skipped` with `skippedReason:'already-converted'` —
 *     never double-created.
 *
 * CasePro `matters` rows still have NO write transport on the fork's client, so a
 * matter-linked card records `skipped:'unsupported'`; write-backs target the lead/intake
 * pillar. A handler never throws out of the engine — a write failure after validation is
 * recorded as `{ status:'error', validated:true, executed:false }`.
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

/** The subject lead: prefer the dispatcher-resolved lead, else follow the card's lead link. */
async function leadFor(ctx: AutomationContext): Promise<ILead | undefined> {
	if (ctx.subject.lead) {
		return ctx.subject.lead;
	}
	const { card } = ctx.subject;
	if (card?.link?.kind === 'lead') {
		return (await BoardsLeads.findOneById(card.link.leadId)) ?? undefined;
	}
	return undefined;
}

/**
 * The `updateField` whitelist: the only CasePro intake columns an automation may patch.
 * Mirrors the SCALAR fields of `IntakePatchInput` (the existing `buildIntakePatch`
 * validation surface) — object fields (`form_data` / `custom_fields`) are deliberately
 * NOT single-field patchable. Accepts both the camelCase patch key and the raw CasePro
 * column name as the action's `field`.
 */
type IntakeFieldTarget = { column: string; patch: (value: string) => IntakePatchInput };

const intakeStatus: IntakeFieldTarget = { column: 'intake_status', patch: (v) => ({ intakeStatus: v }) };
const status: IntakeFieldTarget = { column: 'status', patch: (v) => ({ status: v }) };
const caseTypeId: IntakeFieldTarget = { column: 'case_type_id', patch: (v) => ({ caseTypeId: v }) };
const intakeStageId: IntakeFieldTarget = { column: 'intake_stage_id', patch: (v) => ({ intakeStageId: v }) };
const source: IntakeFieldTarget = { column: 'source', patch: (v) => ({ source: v }) };
const incidentDate: IntakeFieldTarget = { column: 'incident_date', patch: (v) => ({ incidentDate: v }) };
const litboxWorkspaceId: IntakeFieldTarget = { column: 'litbox_workspace_id', patch: (v) => ({ litboxWorkspaceId: v }) };

const INTAKE_PATCH_FIELDS: Record<string, IntakeFieldTarget> = {
	intakeStatus,
	intake_status: intakeStatus,
	status,
	caseTypeId,
	case_type_id: caseTypeId,
	intakeStageId,
	intake_stage_id: intakeStageId,
	source,
	incidentDate,
	incident_date: incidentDate,
	litboxWorkspaceId,
	litbox_workspace_id: litboxWorkspaceId,
};

type CaseproRef = NonNullable<IAutomationActionResult['caseproRef']>;

type WritebackExecuted = {
	ref: CaseproRef;
	detail: string;
	/** extra keys merged into the `automation.ran` activity `to` payload. */
	audit?: Record<string, unknown>;
};

type PreparedWriteback =
	| { skip: NonNullable<IAutomationActionResult['skippedReason']>; detail: string }
	| { ref: CaseproRef; plan: string; execute: () => Promise<WritebackExecuted> };

/**
 * Validate the operation against the subject and, when valid, produce the concrete
 * executor bound to the real `caseProClient` write path. `actingUid` is the resolved
 * permission actor (the real user, or the automation's author for system actors) — the
 * board-role-gated service calls run under that user's authority.
 */
async function prepareWriteback(action: IActionCaseproWriteback, ctx: AutomationContext, actingUid: string): Promise<PreparedWriteback> {
	const lead = await leadFor(ctx);
	if (!lead) {
		return {
			skip: 'unsupported',
			detail: matterIdFor(ctx.subject.card)
				? `${action.operation}: CasePro matter writes have no transport yet — write-back targets lead/intake cards`
				: `${action.operation} requires a lead-linked subject`,
		};
	}

	if (action.operation === 'createMatterFromLead') {
		// Idempotency guard: an already-converted lead must NEVER double-create a matter.
		if (lead.convertedMatterId || lead.convertedAt) {
			return {
				skip: 'already-converted',
				detail: `lead #${lead.refNo} already converted${lead.convertedMatterId ? ` to matter ${lead.convertedMatterId}` : ''}`,
			};
		}
		if (!lead.caseproIntakeId) {
			return { skip: 'unsupported', detail: 'createMatterFromLead: lead has no CasePro intake link to convert' };
		}
		const intakeId = lead.caseproIntakeId;
		return {
			ref: { entity: 'matters', op: 'create' },
			plan: `create matter from lead #${lead.refNo} (intake ${intakeId})`,
			execute: async () => {
				// The leads service owns ALL conversion bookkeeping (POA-column gate,
				// createMatterFromIntake, matter-card bind, markConverted, activity logs,
				// `lead.converted` event, drip stop) — call it so the automation path stays
				// byte-identical to the manual convert flow. Its guards throw Meteor.Error,
				// which the caller records as an error result (never thrown into the engine).
				const res = await convertToMatter(actingUid, lead._id);
				return {
					ref: { entity: 'matters', id: res.matterId, op: 'create' },
					detail: `created CasePro matter ${res.matterId} from lead #${lead.refNo}`,
					audit: { matterId: res.matterId, matterCardId: res.matterCard._id, mattersBoardId: res.mattersBoardId, intakeId },
				};
			},
		};
	}

	if (!lead.caseproIntakeId) {
		return { skip: 'unsupported', detail: `${action.operation}: lead has no CasePro intake link` };
	}
	const intakeId = lead.caseproIntakeId;

	if (action.operation === 'advanceStage') {
		const explicitStage = typeof action.stageId === 'string' && action.stageId ? action.stageId : undefined;
		return {
			ref: {
				entity: 'intake_questionnaires',
				id: intakeId,
				op: `update:intake_stage_id${explicitStage ? `=${explicitStage}` : ' (mirror column)'}`,
			},
			plan: explicitStage
				? `advance intake ${intakeId} to stage ${explicitStage}`
				: `mirror lead #${lead.refNo}'s column to its CasePro intake stage`,
			execute: async () => {
				if (explicitStage) {
					await caseProClient.updateIntakeStage(intakeId, explicitStage);
					return {
						ref: { entity: 'intake_questionnaires', id: intakeId, op: `update:intake_stage_id=${explicitStage}` },
						detail: `advanced intake ${intakeId} to stage ${explicitStage}`,
						audit: { intakeStageId: explicitStage },
					};
				}
				// No stageId configured (the seeded "advance the MATCHING stage" template):
				// mirror the lead's current column through the canonical caseproSync pushStage
				// (column→intake_stage_id binding + by-name fallback + its own audit row).
				const res = await pushStage(actingUid, lead, lead.statusId);
				if (!res.synced) {
					throw new Error(`stage mirror not synced: ${res.reason ?? 'unknown'}`);
				}
				const stageId = res.intake?.stageId;
				return {
					ref: { entity: 'intake_questionnaires', id: intakeId, op: `update:intake_stage_id${stageId ? `=${stageId}` : ''}` },
					detail: `mirrored lead #${lead.refNo}'s column to CasePro intake stage${stageId ? ` ${stageId}` : ''}`,
					audit: stageId ? { intakeStageId: stageId } : {},
				};
			},
		};
	}

	if (action.operation === 'updateField') {
		const target = action.field ? INTAKE_PATCH_FIELDS[action.field] : undefined;
		if (!target) {
			return { skip: 'unsupported', detail: `updateField: field "${action.field ?? ''}" is not on the intake patch whitelist` };
		}
		const raw = typeof action.value === 'string' ? interpolateString(action.value, ctx).value : action.value;
		const value = raw === null || raw === undefined || raw === '' ? undefined : String(raw);
		if (!value) {
			return { skip: 'unsupported', detail: `updateField ${target.column}: no value to write` };
		}
		const ref: CaseproRef = { entity: 'intake_questionnaires', id: intakeId, op: `update:${target.column}` };
		return {
			ref,
			plan: `set intake ${intakeId} ${target.column} = ${value}`,
			execute: async () => {
				await caseProClient.updateIntake(intakeId, target.patch(value));
				return { ref, detail: `set intake ${intakeId} ${target.column} = ${value}`, audit: { field: target.column, value } };
			},
		};
	}

	return {
		skip: 'unsupported',
		detail: `unknown caseproWriteback operation "${(action as { operation?: string }).operation ?? ''}"`,
	};
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
		// Gate 3: unified CasePro enablement — integration off ⇒ every write no-ops.
		if (!caseProMode().enabled) {
			return skipped(index, action.type, 'casepro-disabled', 'CasePro integration disabled');
		}

		// Validate: resolve the subject + operation into a concrete write (or a recorded skip).
		const prepared = await prepareWriteback(action, ctx, permActor);
		if ('skip' in prepared) {
			return skipped(index, action.type, prepared.skip, prepared.detail);
		}

		if (ctx.dryRun) {
			// dry-run validates only (spec §8.2): record the planned op, never execute.
			return { ...planned(index, action.type, `casepro ${action.operation}: ${prepared.plan}`), validated: true, caseproRef: prepared.ref };
		}

		// Execute against the real caseProClient write transport (validate → execute).
		try {
			const executed = await prepared.execute();
			await BoardsActivities.log({
				boardId: ctx.boardId,
				...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
				actor: `automation:${ctx.automation._id}`,
				verb: 'automation.ran',
				to: { caseproWriteback: action.operation, ...executed.ref, executed: true, ...(executed.audit ?? {}) },
				ts: new Date(),
			});
			return { ...ok(index, action.type, executed.detail), validated: true, executed: true, caseproRef: executed.ref };
		} catch (err) {
			// the write failed AFTER validation — record it; never throw into the engine.
			return { ...errored(index, action.type, err), validated: true, executed: false, caseproRef: prepared.ref };
		}
	} catch (err) {
		return errored(index, action.type, err);
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
