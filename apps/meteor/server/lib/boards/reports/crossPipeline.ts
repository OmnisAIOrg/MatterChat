import type { ILead, IMatterSnapshot, IReferralSource } from '@rocket.chat/core-typings';
import { BoardsCards, BoardsLeads, BoardsReferralSources } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../authorization/hasPermission';
import { funnel, type FunnelResult } from '../leads/reports';
import { caseProClient } from '../matters/caseProClient';
import { aging, financial, caseload, type AgingReport, type FinancialReport, type CaseloadReport } from '../matters/reports';

/**
 * Cross-pipeline SOURCE-TO-SETTLEMENT report (M8 — differentiators.md §7 "closed
 * loop"). This is the Leads×Matters JOIN deferred from M5/M6: the one report that
 * follows a marketing dollar all the way to the settlement check, which no kanban
 * tool and few legal CRMs deliver.
 *
 * The join, per marketing source / campaign:
 *   1. LEADS    — bucket `boards_leads` by `attribution.marketingSourceId` /
 *                 `.campaignId` (the marketing registry id on the lead).
 *   2. SIGNED   — a lead is "signed/converted" when it carries `convertedMatterId`
 *                 (CasePro matters.id) or a `convertedAt` (the boards_conversions
 *                 gate writes both; we accept either so the report still works if
 *                 only one was recorded).
 *   3. REVENUE  — for each signed lead with a `convertedMatterId`, read the matter's
 *                 CasePro value (`settlementAmount ?? lastDemandAmount`). Prefer the
 *                 CACHED snapshot already on the converted matter's board card
 *                 (`card.link.snapshot`, written by M2's read-through) and only fall back
 *                 to a LIVE `caseProClient.matterSnapshot` when no card snapshot exists —
 *                 so a firm-wide report doesn't fan out one CasePro round-trip per signed
 *                 matter. Settlement is the realized check; last demand is the in-flight estimate.
 *
 * Spend comes from the registry: source-level `IReferralSource.monthlySpend[]` and
 * campaign-level `IReferralCampaign.spendByMonth[]`. From spend + leads + signed +
 * revenue we derive cost-per-lead, cost-per-signed, ROI and ROAS.
 *
 * HARD RULES honored:
 *  - ALL sums are computed query-then-reduce in JS — never CasePro `aggregate_data`
 *    (its GROUP BY is broken).
 *  - Money read from CasePro is numeric-as-string; coerced via `Number(...) || 0`.
 *  - Graceful degrade: an unreachable CasePro never throws — affected rows carry
 *    `revenue:0` and the result's `revenueResolved` flag goes false so the UI can
 *    show a "revenue partial" banner instead of an error.
 *
 * This intentionally does NOT reuse `leads/marketing.ts#sourceRoi` directly: that
 * helper is gated by `boards-leads-marketing-manage` (an intake-ops capability) and
 * omits the unattributed bucket + signed-without-revenue accounting this firm-wide
 * report needs. It mirrors that helper's spend/revenue math so the two stay
 * consistent. Gated here by `boards-view-reports`.
 */

export type SourceToSettlementRow = {
	sourceId: string;
	sourceName: string;
	kind?: IReferralSource['kind'];
	channel?: IReferralSource['channel'];
	/** present on campaign-level rows (the parent source row omits it). */
	campaignId?: string;
	campaignName?: string;

	leads: number;
	signed: number;
	conversionPct: number; // signed / leads, 0..100
	spend: number;
	costPerLead: number; // spend / leads (0 when no leads)
	costPerSigned: number; // spend / signed (0 when none signed)
	revenue: number; // Σ CasePro settlement (else last demand) for signed leads
	/** signed leads whose CasePro value could not be resolved (unreachable / no value yet). */
	signedAwaitingRevenue: number;
	roas: number; // revenue / spend (0 when no spend)
	roiPct: number; // (revenue - spend) / spend * 100 (0 when no spend)
	revenueResolved: boolean; // false if any of this row's matter reads failed
};

export type SourceToSettlementResult = {
	rows: SourceToSettlementRow[];
	/**
	 * Leads with NO marketing-source attribution. They still count in the funnel
	 * (and their signed revenue is still followed) but have no spend, so they sit in
	 * their own bucket rather than distorting any source's ROI.
	 */
	unattributed: {
		leads: number;
		signed: number;
		conversionPct: number;
		revenue: number;
		signedAwaitingRevenue: number;
	};
	totals: {
		leads: number;
		signed: number;
		spend: number;
		revenue: number;
		conversionPct: number;
		costPerLead: number;
		costPerSigned: number;
		roas: number;
		roiPct: number;
	};
	/** date window applied (inclusive ISO 'YYYY-MM-DD'), if any. */
	window?: { from?: string; to?: string };
	/** false when ANY CasePro matter read failed — revenue figures are partial. */
	revenueResolved: boolean;
};

export type SourceToSettlementOptions = {
	/** ISO 'YYYY-MM-DD' bounds on lead capture date. */
	from?: string;
	to?: string;
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pct1 = (n: number, d: number): number => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Sum a monthly-spend series, optionally clamped to the 'YYYY-MM' window. */
function sumSpend(series: { month: string; amount: number }[] | undefined, fromMonth?: string, toMonth?: string): number {
	if (!series?.length) {
		return 0;
	}
	return sum(
		series
			.filter((s) => (!fromMonth || s.month >= fromMonth) && (!toMonth || s.month <= toMonth))
			.map((s) => Number(s.amount) || 0),
	);
}

/** True when the lead reached the signed/converted gate (either field is enough). */
function isSigned(lead: ILead): boolean {
	return Boolean(lead.convertedMatterId || lead.convertedAt);
}

/** Whether a lead's capture date falls within the optional window. */
function inWindow(lead: ILead, from?: string, to?: string): boolean {
	if (!from && !to) {
		return true;
	}
	const day = lead.capturedAt ? new Date(lead.capturedAt).toISOString().slice(0, 10) : undefined;
	if (!day) {
		// undated leads are never excluded by a window filter.
		return true;
	}
	return (!from || day >= from) && (!to || day <= to);
}

/** Extract the case value from a snapshot: settlement (realized), else last demand, else 0. */
function valueFromSnapshot(snap: Pick<IMatterSnapshot, 'settlementAmount' | 'lastDemandAmount'>): number {
	// CasePro money is numeric-as-string — coerce via Number(...) || 0.
	const raw = snap.settlementAmount ?? snap.lastDemandAmount ?? 0;
	return Number(raw) || 0;
}

/**
 * The cached snapshot already on the converted matter's board card, if any. A matter may
 * have more than one linked card (mirror/copy), so we take the first one that carries a
 * `link.snapshot`. Best-effort — a lookup failure just falls through to the live read.
 */
async function cachedMatterSnapshot(matterId: string): Promise<IMatterSnapshot | undefined> {
	try {
		const cards = await BoardsCards.findByMatterId(matterId).toArray();
		for (const card of cards) {
			if (card.link?.kind === 'matter' && card.link.snapshot) {
				return card.link.snapshot;
			}
		}
	} catch {
		// fall back to the live read below.
	}
	return undefined;
}

/**
 * The CasePro case value for one converted matter: settlement (the realized check),
 * else the last demand (best in-flight estimate), else 0. Prefers the CACHED snapshot on
 * the matter's board card (M2 read-through) so the firm-wide report avoids a CasePro
 * round-trip per matter; only reads LIVE through the matters `caseProClient` when no card
 * snapshot exists. Never throws — a failed live read returns `resolved:false` so callers
 * can flag the row's revenue as partial. A cached hit is always `resolved:true`.
 */
async function matterValue(matterId: string): Promise<{ value: number; resolved: boolean }> {
	const cached = await cachedMatterSnapshot(matterId);
	if (cached) {
		return { value: valueFromSnapshot(cached), resolved: true };
	}
	try {
		const snap = await caseProClient.matterSnapshot(matterId);
		if (!snap) {
			// reachable but no such matter — resolved, just zero value.
			return { value: 0, resolved: true };
		}
		return { value: valueFromSnapshot(snap), resolved: true };
	} catch {
		return { value: 0, resolved: false };
	}
}

/**
 * Accumulated revenue for a bucket of signed leads. Memoizes per matterId so a matter
 * referenced by more than one lead (rare, but possible across re-captures) is read
 * once. Tracks how many signed leads still have no resolved value.
 */
async function bucketRevenue(
	signedLeads: ILead[],
	cache: Map<string, { value: number; resolved: boolean }>,
): Promise<{ revenue: number; awaiting: number; resolved: boolean }> {
	let revenue = 0;
	let awaiting = 0;
	let resolved = true;
	for (const lead of signedLeads) {
		const matterId = lead.convertedMatterId;
		if (!matterId) {
			// converted but no matter id recorded — revenue can't be followed.
			awaiting += 1;
			continue;
		}
		let entry = cache.get(matterId);
		if (!entry) {
			entry = await matterValue(matterId);
			cache.set(matterId, entry);
		}
		if (!entry.resolved) {
			resolved = false;
			awaiting += 1;
			continue;
		}
		if (entry.value > 0) {
			revenue += entry.value;
		} else {
			awaiting += 1;
		}
	}
	return { revenue, awaiting, resolved };
}

/**
 * Source-to-settlement report. Gated by `boards-view-reports`. Joins every active
 * marketing source (and its embedded campaigns) to its leads, signed cases, and the
 * settlement/demand value of those signed cases' CasePro matters.
 */
export async function sourceToSettlement(
	uid: string,
	options: SourceToSettlementOptions = {},
): Promise<SourceToSettlementResult> {
	if (!(await hasPermissionAsync(uid, 'boards-view-reports'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.reports.sourceToSettlement' });
	}

	const fromMonth = options.from?.slice(0, 7);
	const toMonth = options.to?.slice(0, 7);

	const [sources, allLeads] = await Promise.all([
		BoardsReferralSources.findActive().toArray(),
		BoardsLeads.find({ archived: { $ne: true } }).toArray(),
	]);
	const leads = allLeads.filter((l) => inWindow(l, options.from, options.to));

	// bucket leads by marketing source + campaign; collect the unattributed remainder.
	const bySource = new Map<string, ILead[]>();
	const byCampaign = new Map<string, ILead[]>(); // key `${sourceId}::${campaignId}`
	const unattributedLeads: ILead[] = [];
	const push = (map: Map<string, ILead[]>, key: string, lead: ILead): void => {
		const bucket = map.get(key);
		if (bucket) {
			bucket.push(lead);
		} else {
			map.set(key, [lead]);
		}
	};
	for (const lead of leads) {
		const sid = lead.attribution?.marketingSourceId;
		if (!sid) {
			unattributedLeads.push(lead);
			continue;
		}
		push(bySource, sid, lead);
		const cid = lead.attribution?.campaignId;
		if (cid) {
			push(byCampaign, `${sid}::${cid}`, lead);
		}
	}

	// shared matter-value cache so a matter referenced by several buckets is read once.
	const valueCache = new Map<string, { value: number; resolved: boolean }>();
	let revenueResolved = true;

	const buildRow = async (
		base: Pick<SourceToSettlementRow, 'sourceId' | 'sourceName' | 'kind' | 'channel' | 'campaignId' | 'campaignName'>,
		bucket: ILead[],
		spend: number,
	): Promise<SourceToSettlementRow> => {
		const leadsCount = bucket.length;
		const signedLeads = bucket.filter(isSigned);
		const signed = signedLeads.length;

		const { revenue, awaiting, resolved } = await bucketRevenue(signedLeads, valueCache);
		if (!resolved) {
			revenueResolved = false;
		}

		return {
			...base,
			leads: leadsCount,
			signed,
			conversionPct: pct1(signed, leadsCount),
			spend: round2(spend),
			costPerLead: leadsCount ? round2(spend / leadsCount) : 0,
			costPerSigned: signed ? round2(spend / signed) : 0,
			revenue: round2(revenue),
			signedAwaitingRevenue: awaiting,
			roas: spend ? round2(revenue / spend) : 0,
			roiPct: spend ? Math.round(((revenue - spend) / spend) * 1000) / 10 : 0,
			revenueResolved: resolved,
		};
	};

	const rows: SourceToSettlementRow[] = [];
	for (const source of sources) {
		const srcLeads = bySource.get(source._id) ?? [];
		const srcSpend = sumSpend(source.monthlySpend, fromMonth, toMonth);
		rows.push(
			await buildRow(
				{
					sourceId: source._id,
					sourceName: source.name,
					...(source.kind ? { kind: source.kind } : {}),
					...(source.channel ? { channel: source.channel } : {}),
				},
				srcLeads,
				srcSpend,
			),
		);

		for (const campaign of source.campaigns ?? []) {
			const key = `${source._id}::${campaign.id}`;
			const campLeads = byCampaign.get(key) ?? [];
			const campSpend = sumSpend(campaign.spendByMonth, fromMonth, toMonth);
			rows.push(
				await buildRow(
					{
						sourceId: source._id,
						sourceName: source.name,
						...(source.kind ? { kind: source.kind } : {}),
						...(source.channel ? { channel: source.channel } : {}),
						campaignId: campaign.id,
						campaignName: campaign.name,
					},
					campLeads,
					campSpend,
				),
			);
		}
	}

	// sort source rows to the top by revenue then ROAS; keep each source's campaigns
	// directly under it (campaign rows share the parent's sourceId).
	rows.sort((a, b) => {
		if (a.sourceId !== b.sourceId) {
			return b.revenue - a.revenue || a.sourceName.localeCompare(b.sourceName);
		}
		// same source: parent (no campaignId) first, then campaigns by revenue.
		if (!a.campaignId) {
			return -1;
		}
		if (!b.campaignId) {
			return 1;
		}
		return b.revenue - a.revenue;
	});

	// unattributed bucket (no spend, so no CPL/ROI — just funnel + followed revenue).
	const unattributedSigned = unattributedLeads.filter(isSigned);
	const unattributedRev = await bucketRevenue(unattributedSigned, valueCache);
	if (!unattributedRev.resolved) {
		revenueResolved = false;
	}

	// totals: source-level rows + the unattributed bucket. Campaign rows are EXCLUDED
	// (they double-count their parent source's leads/signed/revenue).
	const sourceRows = rows.filter((r) => !r.campaignId);
	const totalLeads = sum(sourceRows.map((r) => r.leads)) + unattributedLeads.length;
	const totalSigned = sum(sourceRows.map((r) => r.signed)) + unattributedSigned.length;
	const totalSpend = sum(sourceRows.map((r) => r.spend)); // unattributed has no spend
	const totalRevenue = sum(sourceRows.map((r) => r.revenue)) + unattributedRev.revenue;

	return {
		rows,
		unattributed: {
			leads: unattributedLeads.length,
			signed: unattributedSigned.length,
			conversionPct: pct1(unattributedSigned.length, unattributedLeads.length),
			revenue: round2(unattributedRev.revenue),
			signedAwaitingRevenue: unattributedRev.awaiting,
		},
		totals: {
			leads: totalLeads,
			signed: totalSigned,
			spend: round2(totalSpend),
			revenue: round2(totalRevenue),
			conversionPct: pct1(totalSigned, totalLeads),
			costPerLead: totalLeads ? round2(totalSpend / totalLeads) : 0,
			costPerSigned: totalSigned ? round2(totalSpend / totalSigned) : 0,
			roas: totalSpend ? round2(totalRevenue / totalSpend) : 0,
			roiPct: totalSpend ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 1000) / 10 : 0,
		},
		...(options.from || options.to
			? { window: { ...(options.from ? { from: options.from } : {}), ...(options.to ? { to: options.to } : {}) } }
			: {}),
		revenueResolved,
	};
}

// ---------------------------------------------------------------------------
// overview — the Boards reporting dashboard payload (one call, many sections)
// ---------------------------------------------------------------------------

/**
 * Composed reporting overview for the Boards Dashboard view. Stitches the four
 * existing pillar reports into one fetch so the dashboard renders without four
 * round-trips:
 *   - intake funnel        (leads/reports#funnel),
 *   - matters financial    (matters/reports#financial),
 *   - matters aging        (matters/reports#aging),
 *   - matters caseload     (matters/reports#caseload),
 *   - source-to-settlement (this module, the closed-loop attribution report).
 *
 * Each section is independently best-effort: a section whose underlying report
 * throws (e.g. the caller has no matters board yet, or CasePro is unreachable) comes
 * back `null` rather than failing the whole dashboard — the UI hides that card and
 * shows the rest. `sections` lists which pillars resolved, for the "partial data"
 * banner. Gated by `boards-view-reports`.
 *
 * Note the inner reports each re-check their own permission; we gate up-front too so
 * an unauthorized caller gets one clean 403 instead of five empty sections.
 */
export type ReportingOverview = {
	funnel: FunnelResult | null;
	financial: FinancialReport | null;
	aging: AgingReport | null;
	caseload: CaseloadReport | null;
	sourceToSettlement: SourceToSettlementResult | null;
	/** which sections resolved (true) vs degraded to null (false). */
	sections: {
		funnel: boolean;
		financial: boolean;
		aging: boolean;
		caseload: boolean;
		sourceToSettlement: boolean;
	};
	/** false when ANY section degraded — the dashboard shows a "partial" note. */
	complete: boolean;
	generatedAt: Date;
};

/** Run a section report best-effort; a throw degrades the section to null. */
async function section<T>(run: () => Promise<T>): Promise<T | null> {
	try {
		return await run();
	} catch {
		// a single pillar failing must never blank the whole dashboard.
		return null;
	}
}

export async function overview(uid: string, options: SourceToSettlementOptions = {}): Promise<ReportingOverview> {
	if (!(await hasPermissionAsync(uid, 'boards-view-reports'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.reports.overview' });
	}

	const [funnelRes, financialRes, agingRes, caseloadRes, s2sRes] = await Promise.all([
		section(() => funnel(uid)),
		section(() => financial(uid)),
		section(() => aging(uid)),
		section(() => caseload(uid)),
		section(() => sourceToSettlement(uid, options)),
	]);

	const sections = {
		funnel: funnelRes !== null,
		financial: financialRes !== null,
		aging: agingRes !== null,
		caseload: caseloadRes !== null,
		sourceToSettlement: s2sRes !== null,
	};

	return {
		funnel: funnelRes,
		financial: financialRes,
		aging: agingRes,
		caseload: caseloadRes,
		sourceToSettlement: s2sRes,
		sections,
		complete: Object.values(sections).every(Boolean),
		generatedAt: new Date(),
	};
}
