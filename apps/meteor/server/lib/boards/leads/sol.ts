import type { ILead } from '@rocket.chat/core-typings';

/**
 * Lead SOL (statute-of-limitations) engine (M6 — depth on Leads).
 *
 * Safety-critical (differentiators.md §4): every lead gets a computed `solDate`
 * so the board can red-flag a lead whose statute is close regardless of pipeline
 * stage. This is the LEAD-side, jurisdiction-default computation; CasePro remains
 * the system of record once a matter exists (the matter SOL engine, M5, owns the
 * post-conversion deadline). Here we compute from the incident date + claim type
 * using Texas defaults, degrading to "unknown" (no throw) when we lack inputs.
 *
 * Texas civil-practice limitations used (Tex. Civ. Prac. & Rem. Code):
 *   - personal injury (default PI / MVA): 2 years            (§16.003)
 *   - wrongful death:                     2 years            (§16.003(b))
 *   - medical malpractice:                2 years            (§74.251)
 *   - property damage:                    2 years            (§16.003)
 *   - breach of (written) contract:       4 years            (§16.004/16.051)
 *   - defamation / libel / slander:       1 year             (§16.002)
 * Default jurisdiction is Texas, 2-year PI — the firm's home venue. A lead's
 * `incident.jurisdictionState` is read for display, but only TX rules ship in M6
 * (other states fall back to the 2yr PI default with `computedFrom:'rules-engine'`).
 */

export type SolComputedFrom = NonNullable<ILead['solComputedFrom']>;

export type LeadSolResult = {
	/** computed statute date, or undefined when we lack an incident date. */
	solDate?: Date;
	/** how the date was derived (mirrors ILead.solComputedFrom). */
	computedFrom: SolComputedFrom;
	/** the limitation period applied, in years (for display / explanation). */
	years?: number;
	/** the normalized claim-type key the rule matched on. */
	claimType?: string;
	/** true when within the at-risk window (default 90 days) of today. */
	atRisk?: boolean;
	/** human reason when no date could be computed. */
	reason?: string;
};

/** Default at-risk window — a lead within this many days of SOL is flagged. */
const AT_RISK_WINDOW_DAYS = 90;

/** TX limitation periods (years) keyed by a normalized claim type. */
const TX_LIMITATION_YEARS: { match: (s: string) => boolean; years: number; key: string }[] = [
	{ key: 'defamation', years: 1, match: (s) => /defamat|libel|slander/.test(s) },
	{ key: 'med-mal', years: 2, match: (s) => /med(ical)?[\s-]?mal|malpractice/.test(s) },
	{ key: 'wrongful-death', years: 2, match: (s) => /wrongful[\s-]?death|death/.test(s) },
	{ key: 'contract', years: 4, match: (s) => /contract|breach/.test(s) },
	{ key: 'property-damage', years: 2, match: (s) => /propert(y|ies)[\s-]?damage/.test(s) },
	// default PI / MVA / slip-and-fall / premises
	{ key: 'personal-injury', years: 2, match: () => true },
];

/** Add whole years to a date (clamps Feb-29 to Feb-28 in non-leap target years). */
function addYears(date: Date, years: number): Date {
	const d = new Date(date.getTime());
	const targetYear = d.getFullYear() + years;
	d.setFullYear(targetYear);
	return d;
}

function daysUntil(date: Date, now: Date): number {
	return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Compute a lead's SOL from its incident block. Pure + total: never throws,
 * returns `{ computedFrom:'rules-engine', reason }` with no `solDate` when the
 * incident date is missing. An explicit `lead.solDate` already stamped by CasePro
 * (`solComputedFrom:'casepro'`) or a human (`'manual'`) is RESPECTED — we only
 * recompute when the existing value is absent or rules-derived.
 */
export function computeLeadSol(lead: ILead, now: Date = new Date()): LeadSolResult {
	// respect an authoritative (CasePro/manual) date already on the lead.
	if (lead.solDate && (lead.solComputedFrom === 'casepro' || lead.solComputedFrom === 'manual')) {
		return {
			solDate: lead.solDate,
			computedFrom: lead.solComputedFrom,
			atRisk: daysUntil(lead.solDate, now) <= AT_RISK_WINDOW_DAYS,
		};
	}

	const incidentDate = lead.incident?.incidentDate;
	if (!incidentDate) {
		return { computedFrom: 'rules-engine', reason: 'no-incident-date' };
	}

	const claimSource = `${lead.incident?.incidentType ?? ''} ${lead.practiceArea ?? ''} ${lead.caseTypeId ?? ''}`.toLowerCase();
	const rule = TX_LIMITATION_YEARS.find((r) => r.match(claimSource)) ?? TX_LIMITATION_YEARS[TX_LIMITATION_YEARS.length - 1];

	const solDate = addYears(new Date(incidentDate), rule.years);
	return {
		solDate,
		computedFrom: 'rules-engine',
		years: rule.years,
		claimType: rule.key,
		atRisk: daysUntil(solDate, now) <= AT_RISK_WINDOW_DAYS,
	};
}
