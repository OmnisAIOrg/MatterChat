import type { ILead } from '@rocket.chat/core-typings';
import { BoardsLeads, BoardsLists } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../authorization/hasPermission';
import { ensureLeadsBoard } from './service';
import { sourceRoi as marketingSourceRoi, type SourceRoiResult, type SourceRoiOptions } from './marketing';

/**
 * Lead reporting (M6 — intake-lead-management.md §12). Three reports:
 *   - {@link funnel}     — New → Contacted → Qualified → Signed counts +
 *                          conversion % per gate + average time-in-stage,
 *   - {@link sourceRoi}  — delegates to marketing.ts (source/campaign ROI),
 *   - {@link scoreboard} — per intake-specialist: leads handled, contact speed /
 *                          SLA adherence, conversion rate.
 *
 * All math is JS-side (query-then-reduce); CasePro aggregate GROUP BY is broken.
 * Gated by `boards-leads-reports-view`.
 */

/** Resolve the leads-board id + its lead set (optionally a different board). */
async function loadLeads(uid: string, boardId?: string): Promise<{ boardId: string; leads: ILead[] }> {
	const resolvedBoardId = boardId ?? (await ensureLeadsBoard(uid)).board._id;
	const leads = await BoardsLeads.findByBoard(resolvedBoardId).toArray();
	return { boardId: resolvedBoardId, leads };
}

// ---------------------------------------------------------------------------
// funnel
// ---------------------------------------------------------------------------

export type FunnelGate = {
	gate: 'New' | 'Contacted' | 'Qualified' | 'Signed';
	count: number;
	/** conversion % from the PREVIOUS gate (New is the 100% baseline). */
	conversionPct: number;
};

export type FunnelResult = {
	totalLeads: number;
	gates: FunnelGate[];
	/** overall New→Signed conversion %. */
	overallConversionPct: number;
	/** average time (hours) a lead spent before reaching each gate, from capture. */
	avgHoursToContact: number;
	avgHoursToSigned: number;
	/** average time-in-stage (hours) per current intake-stage column. */
	avgTimeInStageHours: { stage: string; avgHours: number; count: number }[];
};

const HOUR_MS = 60 * 60 * 1000;
const avg = (xs: number[]): number => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

/**
 * Intake funnel. "Contacted" = has a slaFirstContactAt (or any logged comm);
 * "Qualified" = qualification.qualified === true; "Signed" = converted. Average
 * time-in-stage is computed from the lead's current column and lastActivityAt.
 */
export async function funnel(uid: string, boardId?: string): Promise<FunnelResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-reports-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.reports.funnel' });
	}
	const { boardId: resolvedBoardId, leads } = await loadLeads(uid, boardId);
	const total = leads.length;

	const contacted = leads.filter((l) => Boolean(l.ownership?.slaFirstContactAt || l.lastContactedAt));
	const qualified = leads.filter((l) => l.qualification?.qualified === true);
	const signed = leads.filter((l) => Boolean(l.convertedAt || l.convertedMatterId));

	const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 1000) / 10 : 0);

	const gates: FunnelGate[] = [
		{ gate: 'New', count: total, conversionPct: 100 },
		{ gate: 'Contacted', count: contacted.length, conversionPct: pct(contacted.length, total) },
		{ gate: 'Qualified', count: qualified.length, conversionPct: pct(qualified.length, contacted.length) },
		{ gate: 'Signed', count: signed.length, conversionPct: pct(signed.length, qualified.length) },
	];

	// time-to metrics from capturedAt.
	const hoursToContact = contacted
		.map((l) => {
			const first = l.ownership?.slaFirstContactAt ?? l.lastContactedAt;
			return first && l.capturedAt ? (new Date(first).getTime() - new Date(l.capturedAt).getTime()) / HOUR_MS : null;
		})
		.filter((h): h is number => h !== null && h >= 0);

	const hoursToSigned = signed
		.map((l) => (l.convertedAt && l.capturedAt ? (new Date(l.convertedAt).getTime() - new Date(l.capturedAt).getTime()) / HOUR_MS : null))
		.filter((h): h is number => h !== null && h >= 0);

	// avg time-in-stage by current column.
	const lists = await BoardsLists.findByBoard(resolvedBoardId).toArray();
	const listTitleById = new Map(lists.map((l) => [l._id, l.title]));
	const stageBuckets = new Map<string, number[]>();
	const now = Date.now();
	for (const l of leads) {
		const title = listTitleById.get(l.statusId) ?? 'Unknown';
		const since = l.lastActivityAt ?? l.capturedAt;
		const hrs = since ? (now - new Date(since).getTime()) / HOUR_MS : 0;
		const bucket = stageBuckets.get(title);
		if (bucket) {
			bucket.push(hrs);
		} else {
			stageBuckets.set(title, [hrs]);
		}
	}
	const avgTimeInStageHours = [...stageBuckets.entries()].map(([stage, hrs]) => ({
		stage,
		avgHours: avg(hrs),
		count: hrs.length,
	}));

	return {
		totalLeads: total,
		gates,
		overallConversionPct: pct(signed.length, total),
		avgHoursToContact: avg(hoursToContact),
		avgHoursToSigned: avg(hoursToSigned),
		avgTimeInStageHours,
	};
}

// ---------------------------------------------------------------------------
// sourceRoi (delegate to marketing.ts)
// ---------------------------------------------------------------------------

/**
 * Source/campaign ROI report — delegates to the marketing service (exported under
 * a distinct name so the barrel re-export doesn't collide with marketing's
 * `sourceRoi`). The REST `marketing.sourceRoi` route calls the marketing one
 * directly; this is the reports-suite alias requested by the spec.
 */
export async function reportsSourceRoi(uid: string, options: SourceRoiOptions = {}): Promise<SourceRoiResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-reports-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.reports.sourceRoi' });
	}
	return marketingSourceRoi(uid, options);
}

// ---------------------------------------------------------------------------
// scoreboard (per intake-specialist)
// ---------------------------------------------------------------------------

export type ScoreboardRow = {
	ownerId: string;
	handled: number; // leads owned
	contacted: number; // leads contacted
	signed: number; // leads converted
	conversionPct: number; // signed / handled
	/** average minutes from capture/assignment to first contact (speed-to-lead). */
	avgFirstContactMinutes: number;
	/** SLA adherence: % of leads whose first contact beat slaDueAt (or not breached). */
	slaAdherencePct: number;
};

export type ScoreboardResult = { rows: ScoreboardRow[]; unassigned: number };

const MIN_MS = 60 * 1000;

/**
 * Intake-specialist scoreboard: per owner, leads handled, contact speed
 * (avg minutes to first contact), SLA adherence %, and conversion rate. Leads
 * with no owner are reported in `unassigned`.
 */
export async function scoreboard(uid: string, boardId?: string): Promise<ScoreboardResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-reports-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.reports.scoreboard' });
	}
	const { leads: allLeads } = await loadLeads(uid, boardId);
	const leads = allLeads.filter((l) => !l.archived);

	const byOwner = new Map<string, ILead[]>();
	let unassigned = 0;
	for (const l of leads) {
		const owner = l.ownership?.ownerId;
		if (!owner) {
			unassigned += 1;
			continue;
		}
		const bucket = byOwner.get(owner);
		if (bucket) {
			bucket.push(l);
		} else {
			byOwner.set(owner, [l]);
		}
	}

	const rows: ScoreboardRow[] = [...byOwner.entries()].map(([ownerId, owned]) => {
		const contacted = owned.filter((l) => Boolean(l.ownership?.slaFirstContactAt || l.lastContactedAt));
		const signed = owned.filter((l) => Boolean(l.convertedAt || l.convertedMatterId));

		const firstContactMins = contacted
			.map((l) => {
				const start = l.ownership?.assignedAt ?? l.capturedAt;
				const first = l.ownership?.slaFirstContactAt ?? l.lastContactedAt;
				return start && first ? (new Date(first).getTime() - new Date(start).getTime()) / MIN_MS : null;
			})
			.filter((m): m is number => m !== null && m >= 0);

		const slaConsidered = owned.filter((l) => l.ownership?.slaDueAt);
		const slaMet = slaConsidered.filter((l) => {
			const first = l.ownership?.slaFirstContactAt;
			const due = l.ownership?.slaDueAt;
			return first && due ? new Date(first).getTime() <= new Date(due).getTime() : l.ownership?.slaBreached !== true;
		});

		const handled = owned.length;
		return {
			ownerId,
			handled,
			contacted: contacted.length,
			signed: signed.length,
			conversionPct: handled ? Math.round((signed.length / handled) * 1000) / 10 : 0,
			avgFirstContactMinutes: avg(firstContactMins),
			slaAdherencePct: slaConsidered.length ? Math.round((slaMet.length / slaConsidered.length) * 1000) / 10 : 100,
		};
	});

	rows.sort((a, b) => b.signed - a.signed || b.handled - a.handled);
	return { rows, unassigned };
}
