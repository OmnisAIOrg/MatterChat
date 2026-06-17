import type { ILead, ILeadQualification } from '@rocket.chat/core-typings';

import { computeLeadSol } from './sol';

/**
 * Rule-based lead scoring (M6 — intake-lead-management.md §5). Produces a 0-100
 * score plus the per-rule breakdown the card chip + qualify panel render. Pure +
 * total: never throws, never reads CasePro — it scores from the lead's own data
 * so it can run on capture, on edit, or in a drip-step. AI-assisted scoring
 * (Claude) is a later phase; this is the deterministic floor it will blend with.
 *
 * Weighting (sums to 100 at full marks): incident type (20), injuries (20),
 * treatment (15), liability clarity (20), SOL runway (15), source quality (10).
 * Each factor contributes 0..max; the total is clamped to [0,100]. The breakdown
 * is the audited rationale carried into `ILeadQualification.scoreBreakdown` and
 * pushed to CasePro `form_data` by the qualify write-through.
 */

export type ScoreFactor = { ruleId: string; label: string; points: number };

export type ComputeScoreResult = {
	score: number; // 0..100
	factors: ScoreFactor[];
	/** convenience qualification block ready to persist (qualified derived at >=50). */
	qualification: ILeadQualification;
};

const QUALIFY_THRESHOLD = 50;

/** High-value PI incident types score full; nuisance/unknown score low. */
const HIGH_VALUE_INCIDENT = /18[\s-]?wheel|commercial|truck|dram|catastroph|wrongful[\s-]?death|drunk|dui/;
const STRONG_INCIDENT = /mva|motor[\s-]?vehicle|auto|collision|rear[\s-]?end|premises|slip|dog[\s-]?bite/;

/** Treatment signals — more treatment (and ongoing) => higher specials => higher value. */
const STRONG_TREATMENT = /surger|surg|hospital|er|emergency|inpatient|injection|mri|fracture|broken|herniat/;
const SOME_TREATMENT = /chiro|physical[\s-]?therap|pt|urgent[\s-]?care|treatment|doctor|clinic/;

const SERIOUS_INJURY = /fracture|broken|herniat|tbi|brain|spinal|amputat|burn|paralys|death|surgery/;

function scoreIncidentType(lead: ILead): ScoreFactor {
	const t = `${lead.incident?.incidentType ?? ''} ${lead.practiceArea ?? ''}`.toLowerCase();
	let points = 6; // baseline for any classified incident
	let label = 'Incident type: standard';
	if (!t.trim()) {
		points = 2;
		label = 'Incident type: unspecified';
	} else if (HIGH_VALUE_INCIDENT.test(t)) {
		points = 20;
		label = 'Incident type: high-value';
	} else if (STRONG_INCIDENT.test(t)) {
		points = 14;
		label = 'Incident type: strong PI';
	}
	return { ruleId: 'incident-type', label, points };
}

function scoreInjuries(lead: ILead): ScoreFactor {
	const injuries = lead.incident?.injuries ?? [];
	const blob = injuries.join(' ').toLowerCase();
	let points = 0;
	let label = 'Injuries: none reported';
	if (injuries.length) {
		if (SERIOUS_INJURY.test(blob)) {
			points = 20;
			label = 'Injuries: serious';
		} else {
			points = 10;
			label = 'Injuries: soft-tissue / minor';
		}
	}
	return { ruleId: 'injuries', label, points };
}

function scoreTreatment(lead: ILead): ScoreFactor {
	const blob = `${(lead.incident?.injuries ?? []).join(' ')} ${lead.incident?.incidentDescription ?? ''}`.toLowerCase();
	let points = 3;
	let label = 'Treatment: unknown';
	if (STRONG_TREATMENT.test(blob)) {
		points = 15;
		label = 'Treatment: significant';
	} else if (SOME_TREATMENT.test(blob)) {
		points = 9;
		label = 'Treatment: ongoing';
	}
	return { ruleId: 'treatment', label, points };
}

function scoreLiability(lead: ILead): ScoreFactor {
	// liability clarity is read from the description; clear-fault keywords score high.
	const blob = `${lead.incident?.incidentDescription ?? ''}`.toLowerCase();
	let points = 8; // neutral default
	let label = 'Liability: unclear';
	if (/rear[\s-]?end|ran (a )?(red|stop)|cited|ticket|at[\s-]?fault|admitted|drunk|dui|police report/.test(blob)) {
		points = 20;
		label = 'Liability: clear';
	} else if (/dispute|comparativ|partial|both|unclear|no police|he said/.test(blob)) {
		points = 4;
		label = 'Liability: disputed';
	}
	return { ruleId: 'liability', label, points };
}

function scoreSolRunway(lead: ILead, now: Date): ScoreFactor {
	const sol = computeLeadSol(lead, now);
	if (!sol.solDate) {
		return { ruleId: 'sol-runway', label: 'SOL runway: unknown', points: 7 };
	}
	const days = Math.ceil((sol.solDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
	if (days < 0) {
		return { ruleId: 'sol-runway', label: 'SOL runway: EXPIRED', points: 0 };
	}
	if (days <= 90) {
		return { ruleId: 'sol-runway', label: 'SOL runway: < 90 days (urgent)', points: 6 };
	}
	if (days <= 365) {
		return { ruleId: 'sol-runway', label: 'SOL runway: < 1 year', points: 12 };
	}
	return { ruleId: 'sol-runway', label: 'SOL runway: ample', points: 15 };
}

function scoreSourceQuality(lead: ILead): ScoreFactor {
	const channel = `${lead.attribution?.source ?? ''} ${lead.attribution?.utm?.medium ?? ''}`;
	const hasReferrer = Boolean(lead.attribution?.referralSourceId || lead.attribution?.referredByName);
	let points = 5;
	let label = 'Source: standard';
	if (hasReferrer) {
		points = 10;
		label = 'Source: referral (high trust)';
	} else if (/organic|word/i.test(String(channel))) {
		points = 8;
		label = 'Source: organic';
	} else if (/paid|lsa|search|social|tv|radio/i.test(String(channel))) {
		points = 6;
		label = 'Source: paid';
	}
	return { ruleId: 'source-quality', label, points };
}

/**
 * Compute the lead's score. Returns the clamped 0-100 total, the factor
 * breakdown, and a ready-to-persist `ILeadQualification` (qualified when the
 * score meets the threshold). Caller decides whether to persist (via
 * `qualifyLead`) — this is a pure computation.
 */
export function computeScore(lead: ILead, now: Date = new Date()): ComputeScoreResult {
	const factors: ScoreFactor[] = [
		scoreIncidentType(lead),
		scoreInjuries(lead),
		scoreTreatment(lead),
		scoreLiability(lead),
		scoreSolRunway(lead, now),
		scoreSourceQuality(lead),
	];

	const raw = factors.reduce((sum, f) => sum + f.points, 0);
	const score = Math.max(0, Math.min(100, Math.round(raw)));

	const qualification: ILeadQualification = {
		score,
		scoreBreakdown: factors,
		qualified: score >= QUALIFY_THRESHOLD,
	};

	return { score, factors, qualification };
}
