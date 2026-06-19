import type { ILead } from '@rocket.chat/core-typings';

import { getMattersSnapshots } from './mattersSnapshotMemo';

/**
 * Conflict-of-interest check (M6 — intake-lead-management.md §5). On (or before)
 * intake, fuzzy-match the new lead's party names — the prospective CLIENT and any
 * named ADVERSE parties — against the firm's existing CasePro parties (existing
 * clients, defendants, insurers). A new lead whose adverse party is an existing
 * client (or vice-versa) is a conflict the firm must clear before proceeding.
 *
 * CasePro is read THROUGH the single matters `caseProClient` (the one client; we
 * never open a second). We enumerate matters and read each matter snapshot's
 * client + team display names — the only party names the typed read surface
 * exposes — and fuzzy-compare. Degrades GRACEFULLY: any CasePro error returns a
 * `verdict:'unknown'` banner (never throws), so capture is never blocked by an
 * unreachable CRM.
 */

export type ConflictVerdict = 'clear' | 'review' | 'conflict' | 'unknown';

export type ConflictMatch = {
	/** the lead-side name that matched (our client or an adverse party). */
	queryName: string;
	/** which side of the lead the query name came from. */
	querySide: 'client' | 'adverse';
	/** the existing CasePro party/matter name it matched. */
	matchedName: string;
	/** the CasePro matter the matched name belongs to. */
	matterId?: string;
	matterName?: string;
	/** 0..1 similarity (token + substring blend). */
	similarity: number;
};

export type ConflictCheckResult = {
	verdict: ConflictVerdict;
	/** short banner string for the lead card UI. */
	banner: string;
	matches: ConflictMatch[];
	/** how many existing matters were scanned (for the "scanned N matters" footnote). */
	scanned: number;
	/** set when CasePro could not be read (verdict 'unknown'). */
	reason?: string;
};

/** Treat names >= this similarity as a hit. */
const MATCH_THRESHOLD = 0.82;

const STOPWORDS = new Set(['the', 'a', 'an', 'inc', 'llc', 'llp', 'co', 'corp', 'company', 'and', 'of']);

/** Normalize a person/entity name for comparison: lowercase, strip punctuation/stopwords. */
export function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[.,'"`]/g, '')
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((tok) => tok && !STOPWORDS.has(tok))
		.join(' ')
		.trim();
}

/** Token Jaccard blended with a containment bonus — cheap fuzzy name similarity. */
export function nameSimilarity(a: string, b: string): number {
	const na = normalizeName(a);
	const nb = normalizeName(b);
	if (!na || !nb) {
		return 0;
	}
	if (na === nb) {
		return 1;
	}
	const ta = new Set(na.split(' '));
	const tb = new Set(nb.split(' '));
	let inter = 0;
	for (const t of ta) {
		if (tb.has(t)) {
			inter += 1;
		}
	}
	const union = new Set([...ta, ...tb]).size;
	const jaccard = union ? inter / union : 0;
	const containment = na.includes(nb) || nb.includes(na) ? 0.5 : 0;
	return Math.min(1, jaccard + containment);
}

/** Collect the lead-side names to check, tagged by side. */
function leadPartyNames(lead: ILead): { name: string; side: 'client' | 'adverse' }[] {
	const out: { name: string; side: 'client' | 'adverse' }[] = [];
	const c = lead.contact ?? {};
	const clientName = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
	if (clientName) {
		out.push({ name: clientName, side: 'client' });
	}
	// adverse parties are not first-class on the lead yet; mine the description for an
	// explicit "vs/against/defendant" hint when present (best-effort, never required).
	const desc = lead.incident?.incidentDescription ?? '';
	const adverse = desc.match(/(?:vs\.?|versus|against|defendant[:\s]+)\s*([A-Z][A-Za-z .,'&-]{2,60})/);
	if (adverse?.[1]) {
		out.push({ name: adverse[1].trim(), side: 'adverse' });
	}
	return out;
}

/**
 * Run the conflict check for a lead. Returns matches + a banner verdict:
 *   - 'conflict': a strong hit where the adverse side overlaps an existing client
 *     (or our client is an existing adverse) — the firm must clear it,
 *   - 'review':   a strong name hit that may be the same person re-contacting,
 *   - 'clear':    scanned, no hits,
 *   - 'unknown':  CasePro unreachable (capture proceeds, banner says "not checked").
 */
export async function runConflictCheck(lead: ILead): Promise<ConflictCheckResult> {
	const queries = leadPartyNames(lead);
	if (!queries.length) {
		return { verdict: 'clear', banner: 'No party names to check', matches: [], scanned: 0 };
	}

	const existing: { name: string; matterId?: string; matterName?: string }[] = [];
	let scanned = 0;
	try {
		// shared, short-TTL memo: ONE capped fan-out reused by the dedupe check on the
		// same card open (and by back-to-back opens) instead of a second ~200-read sweep.
		const snapshots = await getMattersSnapshots();
		for (const snap of snapshots) {
			scanned += 1;
			if (snap.clientName) {
				existing.push({ name: snap.clientName, matterId: snap.matterId, matterName: snap.matterName });
			}
			for (const member of snap.team ?? []) {
				if (member?.name) {
					existing.push({ name: member.name, matterId: snap.matterId, matterName: snap.matterName });
				}
			}
		}
	} catch (err) {
		return {
			verdict: 'unknown',
			banner: 'Conflict check unavailable — CasePro not reachable',
			matches: [],
			scanned: 0,
			reason: err instanceof Error ? err.message : 'casepro-unreachable',
		};
	}

	const matches: ConflictMatch[] = [];
	for (const q of queries) {
		for (const e of existing) {
			const similarity = nameSimilarity(q.name, e.name);
			if (similarity >= MATCH_THRESHOLD) {
				matches.push({
					queryName: q.name,
					querySide: q.side,
					matchedName: e.name,
					...(e.matterId ? { matterId: e.matterId } : {}),
					...(e.matterName ? { matterName: e.matterName } : {}),
					similarity,
				});
			}
		}
	}

	matches.sort((a, b) => b.similarity - a.similarity);

	// an adverse-side hit is a true positional conflict; a client-side hit is "review".
	const hasAdverseHit = matches.some((m) => m.querySide === 'adverse');
	const verdict: ConflictVerdict = matches.length === 0 ? 'clear' : hasAdverseHit ? 'conflict' : 'review';
	const banner =
		verdict === 'clear'
			? `No conflicts found (scanned ${scanned} matters)`
			: verdict === 'conflict'
				? `Potential CONFLICT: adverse party matches an existing matter`
				: `Possible match to ${matches.length} existing part${matches.length === 1 ? 'y' : 'ies'} — review`;

	return { verdict, banner, matches, scanned };
}
