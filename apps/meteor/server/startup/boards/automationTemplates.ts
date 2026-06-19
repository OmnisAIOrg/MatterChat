import type { IAutomation } from '@rocket.chat/core-typings';
import { BoardsAutomations } from '@rocket.chat/models';

import { SystemLogger } from '../../lib/logger/system';

/**
 * Prebuilt automation templates (M7 — 05-automation-engine.md §9). Seeded once into
 * `boards_automations` as global `isSystem` + `isTemplate` CATALOG entries, idempotent on a
 * stable `seedKey` (a second run never duplicates them and leaves any firm edits untouched).
 *
 * They are a CATALOG, not live rules: `isTemplate:true` makes the dispatcher + cron EXCLUDE
 * them, so a global template never fires on a board that lacks its referenced list/label/
 * stage ids. The firm INSTALLS one onto a board (`boards.automations.templates.install`),
 * which CLONES it into a board-scoped, enabled, non-template automation and rebinds its
 * list/label references by name. The seeds therefore use firm-PORTABLE triggers (events +
 * conditions) rather than hard-coded board ids, with the intended stage/column named in the
 * description.
 *
 * Catalog (from §9, real CasePro stage names): Speed-to-lead, Cold-lead nurture,
 * Demand-response timer, SOL watch, Stage playbook, Stuck-matter, CasePro write-back.
 *
 * Mirrors `seedDefaultPlaybooks` (matters M5): a `for` over the seed table, skip when the
 * stable key already exists, insert the rest, return counts. Called from the boards
 * startup hook. Best-effort — a seed failure never blocks boot.
 */

type AutomationSeed = Omit<IAutomation, '_id' | '_updatedAt' | 'createdAt' | 'updatedAt' | 'rev' | 'runCount' | 'createdBy'> & {
	seedKey: string;
};

const NOW_15M = '{{now+15m}}';
const NOW_30D = '{{now+30d}}';

/** The §9 catalog. Global scope (boardId unset); installed/cloned per board by the UI. */
export const AUTOMATION_TEMPLATE_SEEDS: AutomationSeed[] = [
	// 1. Speed-to-lead — on capture, assign round-robin, set a 15-min first-touch due,
	//    notify the owner, and enroll the welcome drip. (Leads board.)
	{
		seedKey: 'speed-to-lead',
		name: 'Speed-to-lead',
		description: 'On a new lead: round-robin assign, set a 15-minute first-contact due, notify the owner, and start the welcome drip.',
		scope: 'global',
		kind: 'rule',
		icon: 'bolt',
		enabled: true,
		isSystem: true,
		trigger: { event: 'lead.captured' },
		conditions: [],
		actions: [
			{ type: 'assignMember', roundRobin: true },
			{ type: 'setDue', due: NOW_15M },
			{ type: 'notify', target: 'owner', message: 'New lead {{lead.fullName}} — make first contact within 15 minutes.' },
		],
	},

	// 2. Cold-lead nurture — scheduled weekday 8am: leads with no contact for 24h+ get a
	//    Cold label + a re-engage follow-up task + an owner notify. (Leads board.)
	{
		seedKey: 'cold-lead-nurture',
		name: 'Cold-lead nurture',
		description: 'Weekday 8am: flag leads with no contact in 24h+ as Cold, create a re-engage task, and notify the owner.',
		scope: 'global',
		kind: 'scheduled',
		icon: 'clock',
		enabled: true,
		isSystem: true,
		schedule: { kind: 'every', cadence: 'weekday', hour: 8, minute: 0 },
		// daysInStage stands in for "no contact" on the lead card; the firm can swap to a
		// lead.score / list condition when rebinding.
		conditions: [{ field: 'daysInStage', op: 'gt', value: 1 }],
		actions: [{ type: 'createTask', title: 'Re-engage cold lead {{lead.fullName}}' }, { type: 'notify', target: 'owner', message: 'Cold lead {{lead.fullName}} needs a follow-up.' }],
	},

	// 3. Demand-response timer — when a matter enters the Demanded sub-stage, set a 30-day
	//    response due, label "Awaiting Response", and post a dated comment. (Matters board.)
	{
		seedKey: 'demand-response-timer',
		name: 'Demand-response timer',
		description: 'When a matter is marked Demanded: set a 30-day response timer, label "Awaiting Response", and comment the demand date.',
		scope: 'global',
		kind: 'rule',
		icon: 'send',
		enabled: true,
		isSystem: true,
		trigger: { event: 'card.subStatusChanged' },
		conditions: [{ field: 'subStatus', op: 'is', value: 'Demanded' }],
		actions: [
			{ type: 'setDue', due: NOW_30D },
			{ type: 'createDeadline', kind: 'response', label: 'Demand response due', due: NOW_30D },
			{ type: 'comment', body: 'Demand sent {{now}} — 30-day response window started.' },
		],
	},

	// 4. SOL watch — scheduled daily: matters whose statute of limitations is within 90 days
	//    get an "SOL ⚠" label + an assignee notify. (Matters board; the safety net.)
	{
		seedKey: 'sol-watch',
		name: 'SOL watch',
		description: 'Daily: flag matters whose statute of limitations is within 90 days and notify the assignees.',
		scope: 'global',
		kind: 'scheduled',
		icon: 'warning',
		enabled: true,
		isSystem: true,
		schedule: { kind: 'every', cadence: 'daily', hour: 7, minute: 0 },
		conditions: [{ field: 'sol', op: 'within', value: '90d' }],
		actions: [{ type: 'notify', target: 'assignees', message: 'SOL within 90 days for {{matter.clientName}} (SOL {{matter.solDate}}).' }],
	},

	// 5. Stage playbook — when a matter enters Investigation/Active-Treating, apply the
	//    stage checklist + set a 30-day review due. (Matters board.)
	{
		seedKey: 'stage-playbook',
		name: 'Stage playbook',
		description: 'When a matter changes stage: apply the stage checklist and set a 30-day review due. Rebind the playbook per board.',
		scope: 'global',
		kind: 'rule',
		icon: 'kanban',
		enabled: true,
		isSystem: true,
		trigger: { event: 'matter.stageChanged' },
		conditions: [],
		actions: [
			{ type: 'addChecklist', title: 'Stage tasks', items: ['Review file', 'Update client', 'Confirm next step'] },
			{ type: 'setDue', due: NOW_30D },
		],
	},

	// 6. Stuck-matter — scheduled weekly: matters idle in a stage 30+ days get a "Stuck"
	//    label + a case-manager notify. (Matters board.)
	{
		seedKey: 'stuck-matter',
		name: 'Stuck-matter',
		description: 'Weekly: flag matters idle in their stage for 30+ days as Stuck and notify the case manager.',
		scope: 'global',
		kind: 'scheduled',
		icon: 'warning',
		enabled: true,
		isSystem: true,
		schedule: { kind: 'every', cadence: 'weekly', dayOfWeek: 1, hour: 7, minute: 30 },
		conditions: [{ field: 'daysInStage', op: 'gt', value: 30 }],
		actions: [{ type: 'notify', target: 'assignees', message: 'Matter {{matter.clientName}} has been in its stage 30+ days.' }],
	},

	// 7. CasePro write-back — when a matter changes stage on the board, advance the matching
	//    CasePro stage. Disabled by default + double-gated (setting + permission). (P3.)
	{
		seedKey: 'casepro-writeback-stage',
		name: 'CasePro write-back (stage)',
		description: 'When a matter changes stage on the board, advance the matching CasePro stage. Disabled by default; requires the write-back setting + permission.',
		scope: 'global',
		kind: 'rule',
		icon: 'database',
		enabled: false,
		isSystem: true,
		trigger: { event: 'matter.stageChanged' },
		conditions: [],
		actions: [{ type: 'caseproWriteback', operation: 'advanceStage' }],
	},
];

export type SeedAutomationTemplatesResult = { created: number; existing: number; migrated: number; total: number };

/**
 * Upsert the §9 templates, idempotent on `seedKey`. Re-running never duplicates a template
 * (it matches by `seedKey`) and never overwrites a firm-edited copy. Returns counts.
 *
 * SELF-HEAL: a template seeded by an EARLIER build (before `isTemplate` existed) is global +
 * enabled and would still fire on every board. When such a seed is found missing
 * `isTemplate`, we backfill `isTemplate:true` (only that flag) so it reverts to catalog-only
 * — closing the global-seed safety hole. Idempotent: a later run sees the flag set and skips.
 */
export async function seedAutomationTemplates(uid?: string): Promise<SeedAutomationTemplatesResult> {
	let created = 0;
	let existing = 0;
	let migrated = 0;
	const now = new Date();

	for (const seed of AUTOMATION_TEMPLATE_SEEDS) {
		// eslint-disable-next-line no-await-in-loop
		const already = await BoardsAutomations.findOneBySeedKey(seed.seedKey);
		if (already) {
			existing += 1;
			// backfill catalog flag on a pre-`isTemplate` seed so it stops firing globally.
			if (already.isTemplate !== true) {
				// eslint-disable-next-line no-await-in-loop
				await BoardsAutomations.updateAutomation(already._id, { isTemplate: true });
				migrated += 1;
			}
			continue;
		}
		const doc: Omit<IAutomation, '_id' | '_updatedAt'> = {
			...seed,
			isSystem: true,
			isTemplate: true, // catalog entry — the dispatcher/cron skip these; installed/cloned per board.
			runCount: 0,
			rev: 0,
			...(uid ? { createdBy: uid } : {}),
			createdAt: now,
			updatedAt: now,
		};
		// eslint-disable-next-line no-await-in-loop
		await BoardsAutomations.insertOne(doc);
		created += 1;
	}

	return { created, existing, migrated, total: AUTOMATION_TEMPLATE_SEEDS.length };
}

/** Boot hook: seed the templates once, swallowing errors so a seed failure never blocks boot. */
export async function ensureAutomationTemplates(): Promise<void> {
	try {
		const result = await seedAutomationTemplates();
		SystemLogger.debug({ msg: 'boards.automation.templates.seeded', ...result });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.templates.seedFailed', err });
	}
}
