import type { ILead, IReferralSource } from '@rocket.chat/core-typings';
import { BoardsLeads, BoardsReferralSources } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../authorization/hasPermission';
import { caseProClient } from '../matters/caseProClient';

/**
 * Marketing source / campaign ROI (M6 — intake-lead-management.md §9). For each
 * source (and embedded campaign) computes: leads, signed (converted), conversion
 * %, cost-per-lead, cost-per-signed, and — joining CasePro case value for the
 * converted matters — revenue and ROAS.
 *
 * Spend comes from `IReferralSource.monthlySpend[]` (source level) and
 * `IReferralCampaign.spendByMonth[]` (campaign level). Revenue comes from the
 * converted leads' CasePro matters (settlement amount, falling back to last
 * demand) read THROUGH the one matters `caseProClient`. ALL sums are computed in
 * JS — CasePro aggregate GROUP BY is broken. Degrades gracefully: an unreachable
 * CasePro yields ROI rows with `revenue:0` rather than throwing.
 */

export type SourceRoiRow = {
	sourceId: string;
	sourceName: string;
	kind?: IReferralSource['kind'];
	channel?: IReferralSource['channel'];
	/** present on campaign-level rows. */
	campaignId?: string;
	campaignName?: string;

	leads: number;
	signed: number;
	conversionPct: number; // 0..100
	spend: number;
	costPerLead: number; // spend / leads (0 when no leads)
	costPerSigned: number; // spend / signed (0 when none signed)
	revenue: number; // Σ CasePro case value for signed leads
	roas: number; // revenue / spend (0 when no spend)
	revenueResolved: boolean; // false if CasePro was unreachable (revenue is partial)
};

export type SourceRoiResult = {
	rows: SourceRoiRow[];
	totals: {
		leads: number;
		signed: number;
		spend: number;
		revenue: number;
		conversionPct: number;
		roas: number;
	};
	/** date window applied (inclusive ISO), if any. */
	window?: { from?: string; to?: string };
	revenueResolved: boolean;
};

export type SourceRoiOptions = {
	/** ISO 'YYYY-MM-DD' bounds on lead capture date. */
	from?: string;
	to?: string;
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

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

/** The CasePro case value for a converted lead's matter (settlement, else demand). */
async function matterValue(matterId: string): Promise<{ value: number; resolved: boolean }> {
	try {
		const snap = await caseProClient.matterSnapshot(matterId);
		if (!snap) {
			return { value: 0, resolved: true };
		}
		const value = snap.settlementAmount ?? snap.lastDemandAmount ?? 0;
		return { value: Number(value) || 0, resolved: true };
	} catch {
		return { value: 0, resolved: false };
	}
}

function inWindow(lead: ILead, from?: string, to?: string): boolean {
	if (!from && !to) {
		return true;
	}
	const day = lead.capturedAt ? new Date(lead.capturedAt).toISOString().slice(0, 10) : undefined;
	if (!day) {
		return true;
	}
	return (!from || day >= from) && (!to || day <= to);
}

/**
 * Compute per-source (and per-campaign) ROI. Gated by
 * `boards-leads-marketing-manage`. Leads are bucketed by
 * `attribution.marketingSourceId` / `.campaignId`; revenue joins each signed
 * lead's CasePro matter value.
 */
export async function sourceRoi(uid: string, options: SourceRoiOptions = {}): Promise<SourceRoiResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-marketing-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.marketing.sourceRoi' });
	}

	const fromMonth = options.from?.slice(0, 7);
	const toMonth = options.to?.slice(0, 7);

	const [sources, allLeads] = await Promise.all([
		BoardsReferralSources.findActive().toArray(),
		BoardsLeads.find({ archived: { $ne: true } }).toArray(),
	]);
	const leads = allLeads.filter((l) => inWindow(l, options.from, options.to));

	// bucket leads by source + campaign.
	const bySource = new Map<string, ILead[]>();
	const byCampaign = new Map<string, ILead[]>(); // key `${sourceId}::${campaignId}`
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
		if (sid) {
			push(bySource, sid, lead);
			const cid = lead.attribution?.campaignId;
			if (cid) {
				push(byCampaign, `${sid}::${cid}`, lead);
			}
		}
	}

	let revenueResolved = true;

	const buildRow = async (
		base: Pick<SourceRoiRow, 'sourceId' | 'sourceName' | 'kind' | 'channel' | 'campaignId' | 'campaignName'>,
		bucket: ILead[],
		spend: number,
	): Promise<SourceRoiRow> => {
		const leadsCount = bucket.length;
		const signedLeads = bucket.filter((l) => Boolean(l.convertedMatterId || l.convertedAt));
		const signed = signedLeads.length;

		// revenue: Σ CasePro case value for signed leads with a matter id.
		let revenue = 0;
		for (const l of signedLeads) {
			if (l.convertedMatterId) {
				const { value, resolved } = await matterValue(l.convertedMatterId);
				revenue += value;
				if (!resolved) {
					revenueResolved = false;
				}
			}
		}

		return {
			...base,
			leads: leadsCount,
			signed,
			conversionPct: leadsCount ? Math.round((signed / leadsCount) * 1000) / 10 : 0,
			spend,
			costPerLead: leadsCount ? Math.round((spend / leadsCount) * 100) / 100 : 0,
			costPerSigned: signed ? Math.round((spend / signed) * 100) / 100 : 0,
			revenue,
			roas: spend ? Math.round((revenue / spend) * 100) / 100 : 0,
			revenueResolved,
		};
	};

	const rows: SourceRoiRow[] = [];
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

	// totals exclude campaign rows (they double-count their parent source's leads).
	const sourceRows = rows.filter((r) => !r.campaignId);
	const totalLeads = sum(sourceRows.map((r) => r.leads));
	const totalSigned = sum(sourceRows.map((r) => r.signed));
	const totalSpend = sum(sourceRows.map((r) => r.spend));
	const totalRevenue = sum(sourceRows.map((r) => r.revenue));

	return {
		rows,
		totals: {
			leads: totalLeads,
			signed: totalSigned,
			spend: totalSpend,
			revenue: totalRevenue,
			conversionPct: totalLeads ? Math.round((totalSigned / totalLeads) * 1000) / 10 : 0,
			roas: totalSpend ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0,
		},
		...(options.from || options.to ? { window: { ...(options.from ? { from: options.from } : {}), ...(options.to ? { to: options.to } : {}) } } : {}),
		revenueResolved,
	};
}
