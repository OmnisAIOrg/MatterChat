import { ajvQuery } from './Ajv';

/**
 * REST validators + endpoint types for Boards REPORTING (M8).
 *
 * `boards.reports.sourceToSettlement` — the closed-loop attribution report
 *   (differentiators.md §7): per marketing source/campaign, leads → signed → the
 *   converted matter's CasePro settlement/demand value, with spend, cost-per-lead,
 *   cost-per-signed, revenue, ROAS and ROI.
 * `boards.reports.overview` — the composed dashboard payload (intake funnel + matters
 *   financial/aging/caseload + source-to-settlement), each section degrading to null.
 *
 * Both are gated server-side by `boards-view-reports`. Result DTOs are declared here
 * (decoupled from the server lib) mirroring `boards-matters.ts`'s report DTOs; CasePro
 * revenue may be partial, signalled by `revenueResolved` / `complete`.
 */

// ---------------------------------------------------------------------------
// GET params — both reports accept an optional ISO 'YYYY-MM-DD' window.
// ---------------------------------------------------------------------------

type BoardsReportsWindowProps = { from?: string; to?: string };

const BoardsReportsWindowSchema = {
	type: 'object',
	properties: {
		from: { type: 'string', nullable: true },
		to: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsReportsSourceToSettlementProps = ajvQuery.compile<BoardsReportsWindowProps>(BoardsReportsWindowSchema);
export const isBoardsReportsOverviewProps = ajvQuery.compile<BoardsReportsWindowProps>(BoardsReportsWindowSchema);

// ---------------------------------------------------------------------------
// Result shapes (mirror apps/meteor/server/lib/boards/reports/crossPipeline.ts)
// ---------------------------------------------------------------------------

export type SourceToSettlementRowDTO = {
	sourceId: string;
	sourceName: string;
	kind?: string;
	channel?: string;
	campaignId?: string;
	campaignName?: string;
	leads: number;
	signed: number;
	conversionPct: number;
	spend: number;
	costPerLead: number;
	costPerSigned: number;
	revenue: number;
	signedAwaitingRevenue: number;
	roas: number;
	roiPct: number;
	revenueResolved: boolean;
};

export type SourceToSettlementResultDTO = {
	rows: SourceToSettlementRowDTO[];
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
	window?: { from?: string; to?: string };
	revenueResolved: boolean;
};

/**
 * The overview's section payloads are large/nested (they wrap the existing leads +
 * matters report shapes, which already have their own DTOs). They are passed through
 * as `unknown` here (null when the section degraded — the dashboard view owns their
 * rendering) while the coverage flags (`sections`, `complete`) stay strongly typed for
 * the partial-data UI.
 */
export type ReportingOverviewDTO = {
	funnel: unknown;
	financial: unknown;
	aging: unknown;
	caseload: unknown;
	sourceToSettlement: SourceToSettlementResultDTO | null;
	sections: {
		funnel: boolean;
		financial: boolean;
		aging: boolean;
		caseload: boolean;
		sourceToSettlement: boolean;
	};
	complete: boolean;
	generatedAt: string;
};

// ---------------------------------------------------------------------------
// Endpoint type map
// ---------------------------------------------------------------------------

export type BoardsReportsEndpoints = {
	'/v1/boards.reports.sourceToSettlement': {
		GET: (params: BoardsReportsWindowProps) => { report: SourceToSettlementResultDTO };
	};
	'/v1/boards.reports.overview': {
		GET: (params: BoardsReportsWindowProps) => { report: ReportingOverviewDTO };
	};
};
