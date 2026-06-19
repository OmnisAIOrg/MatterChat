import type { IBoardCard, IBoardList, IMatterSnapshot } from '@rocket.chat/core-typings';
import { BoardsCards, BoardsDeadlines, BoardsActivities } from '@rocket.chat/models';

import { ensureMattersBoard } from './service';

/**
 * Matters reporting (M5 — see matters-case-management.md §8 caseload, §9 reporting).
 *
 * Every aggregate is computed query-then-sum in JS over the cached `IMatterSnapshot`
 * carried on each matter card's `link` (never CasePro `aggregate_data`, which is
 * broken — HARD RULE 1). Snapshot money is already coerced to numbers by the snapshot
 * assembler; we treat a missing field as 0 and never throw on a gap.
 *
 * "Days in stage" is derived from the most recent `card.moved` activity into the
 * card's current list (or the card's creation time if it has never moved).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** SOL is "at risk" when the open SOL deadline is within this many days. */
const SOL_AT_RISK_DAYS = 90;

/** Matters idle in a stage longer than this are flagged "stuck". */
const STUCK_MATTER_DAYS = 30;

type MatterCard = IBoardCard & { link: Extract<IBoardCard['link'], { kind: 'matter' }> };

/** Coerce a possibly-missing snapshot number to a finite number (0 fallback). */
function n(value: number | undefined | null): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Snapshot off a matter card's link, if present. */
function snapshotOf(card: MatterCard): IMatterSnapshot | undefined {
	return card.link.snapshot;
}

/**
 * Load the caller's matters board, its lists, and its open matter cards in one place
 * so each report shares the same source set. Returns lists keyed by id for stage
 * resolution. Never throws on an empty board.
 */
async function loadMatterCards(uid: string): Promise<{
	boardId: string;
	lists: IBoardList[];
	listsById: Map<string, IBoardList>;
	cards: MatterCard[];
}> {
	const { board, lists } = await ensureMattersBoard(uid);
	const all = await BoardsCards.findByBoard(board._id).toArray();
	const cards = all.filter((c): c is MatterCard => c.cardType === 'matter' && c.link?.kind === 'matter' && !c.archived);
	const listsById = new Map(lists.map((l) => [l._id, l]));
	return { boardId: board._id, lists, listsById, cards };
}

/**
 * Days a card has spent in its current list. Reads the most recent `card.moved`
 * activity whose `to.listId` equals the card's current list; falls back to the
 * card's createdAt. Best-effort — any read failure yields 0.
 */
async function daysInStage(card: MatterCard, now: Date): Promise<number> {
	let since = card.createdAt;
	try {
		const activities = await BoardsActivities.findByCard(card._id, { limit: 50 }).toArray();
		const lastMove = activities.find(
			(a) => a.verb === 'card.moved' && (a.to as { listId?: string } | undefined)?.listId === card.listId,
		);
		if (lastMove?.ts) {
			since = lastMove.ts;
		}
	} catch {
		// fall back to createdAt
	}
	return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS));
}

// ---------------------------------------------------------------------------
// caseload — open matters grouped by assignee
// ---------------------------------------------------------------------------

export type CaseloadRow = {
	assigneeId: string;
	openMatters: number;
	stageMix: Record<string, number>; // stageName -> count
	solAtRisk: number;
	avgDaysInStage: number;
};

/** The three matter-team role classes the per-role caseload rolls up to (matters §8). */
export type CaseloadRoleClass = 'attorney' | 'paralegal' | 'case-manager' | 'other';

export type CaseloadRoleRow = {
	role: CaseloadRoleClass;
	/** the snapshot team member (users.id string or resolved name) holding this role. */
	memberId: string;
	openMatters: number;
	solAtRisk: number;
};

export type CaseloadReport = {
	boardId: string;
	totalOpen: number;
	unassigned: number;
	rows: CaseloadRow[];
	/**
	 * Per-role breakdown from the cached snapshot team data (matters §8 attorney /
	 * paralegal / case-manager). Empty when no matter snapshot carries team roles —
	 * in which case callers use the flat `rows` view (documented degradation).
	 */
	byRole: CaseloadRoleRow[];
	/** false when no snapshot team data was available, so the UI hides the role view. */
	roleDataAvailable: boolean;
};

/**
 * Classify a CasePro matter-team role LABEL (e.g. "Principal Attorney", "Senior Case
 * Manager", "Paralegal") into one of the three caseload role classes. The labels come
 * from `MATTER_TEAM_ROLE_COLUMNS` in the snapshot assembler. Unmatched roles
 * (e.g. "Auditor", "BRA Coordinator") fall into 'other'.
 */
function classifyRole(label: string): CaseloadRoleClass {
	const l = label.toLowerCase();
	if (l.includes('case manager')) {
		return 'case-manager';
	}
	if (l.includes('attorney')) {
		return 'attorney';
	}
	if (l.includes('paralegal') || l.includes('legal assistant')) {
		return 'paralegal';
	}
	return 'other';
}

/**
 * Caseload: open matters grouped by assignee with stage mix, SOL-at-risk count, and
 * average aging (the flat view). A matter with multiple assignees counts toward each;
 * a matter with none rolls into `unassigned`.
 *
 * matters §8 additionally wants a per-ROLE breakdown (attorney / paralegal /
 * case-manager). The flat `card.assignees` array has no role information, so the role
 * view is derived from the cached `IMatterSnapshot.team` (CasePro matter team-role
 * columns). When NO snapshot carries team roles we degrade to the flat view only
 * (`byRole` empty, `roleDataAvailable:false`) — never throwing, mirroring the snapshot
 * graceful-degradation rule.
 */
export async function caseload(uid: string): Promise<CaseloadReport> {
	const now = new Date();
	const { boardId, listsById, cards } = await loadMatterCards(uid);

	// pre-compute SOL-at-risk card ids in one board-wide deadline scan.
	const atRisk = await solAtRiskCardIds(boardId, now);

	const byAssignee = new Map<string, { open: number; stageMix: Record<string, number>; solAtRisk: number; ageSum: number }>();
	let unassigned = 0;

	// per-role tally keyed by `${roleClass}::${memberId}` from snapshot team data.
	const byRole = new Map<string, { role: CaseloadRoleClass; memberId: string; open: number; solAtRisk: number }>();
	let sawTeamData = false;

	for (const card of cards) {
		const stageName = listsById.get(card.listId)?.title ?? card.listId;
		const age = await daysInStage(card, now);
		const cardAtRisk = atRisk.has(card._id);

		// ----- flat view (by assignee) -----
		const assignees = card.assignees?.length ? card.assignees : [];
		if (!assignees.length) {
			unassigned += 1;
		} else {
			for (const a of assignees) {
				const row = byAssignee.get(a) ?? { open: 0, stageMix: {}, solAtRisk: 0, ageSum: 0 };
				row.open += 1;
				row.stageMix[stageName] = (row.stageMix[stageName] ?? 0) + 1;
				row.ageSum += age;
				if (cardAtRisk) {
					row.solAtRisk += 1;
				}
				byAssignee.set(a, row);
			}
		}

		// ----- per-role view (from the cached snapshot team) -----
		const team = snapshotOf(card)?.team ?? [];
		for (const member of team) {
			if (!member?.name) {
				continue;
			}
			sawTeamData = true;
			const role = classifyRole(member.role ?? '');
			const key = `${role}::${member.name}`;
			const r = byRole.get(key) ?? { role, memberId: member.name, open: 0, solAtRisk: 0 };
			r.open += 1;
			if (cardAtRisk) {
				r.solAtRisk += 1;
			}
			byRole.set(key, r);
		}
	}

	const rows: CaseloadRow[] = [...byAssignee.entries()].map(([assigneeId, r]) => ({
		assigneeId,
		openMatters: r.open,
		stageMix: r.stageMix,
		solAtRisk: r.solAtRisk,
		avgDaysInStage: r.open ? Math.round(r.ageSum / r.open) : 0,
	}));
	rows.sort((a, b) => b.openMatters - a.openMatters);

	const roleRows: CaseloadRoleRow[] = [...byRole.values()].map((r) => ({
		role: r.role,
		memberId: r.memberId,
		openMatters: r.open,
		solAtRisk: r.solAtRisk,
	}));
	// sort by role class then by load desc, so attorneys group first.
	const ROLE_ORDER: CaseloadRoleClass[] = ['attorney', 'paralegal', 'case-manager', 'other'];
	roleRows.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.openMatters - a.openMatters);

	return { boardId, totalOpen: cards.length, unassigned, rows, byRole: roleRows, roleDataAvailable: sawTeamData };
}

/** Card ids carrying an open SOL deadline due within the at-risk window. */
async function solAtRiskCardIds(boardId: string, now: Date): Promise<Set<string>> {
	const horizon = new Date(now.getTime() + SOL_AT_RISK_DAYS * DAY_MS);
	const open = await BoardsDeadlines.findByBoard(boardId).toArray();
	const ids = new Set<string>();
	for (const d of open) {
		if (d.kind === 'SOL' && d.dueDate <= horizon) {
			ids.add(d.cardId);
		}
	}
	return ids;
}

// ---------------------------------------------------------------------------
// aging — per-stage time-in-stage + stuck matters
// ---------------------------------------------------------------------------

export type AgingStageRow = {
	listId: string;
	stageName: string;
	count: number;
	avgDaysInStage: number;
	p90DaysInStage: number; // 90th-percentile aging
	stuck: number; // matters idle > STUCK_MATTER_DAYS
};

export type StuckMatter = {
	cardId: string;
	matterId: string;
	title: string;
	stageName: string;
	daysInStage: number;
	assignees: string[];
};

export type AgingReport = {
	boardId: string;
	stages: AgingStageRow[];
	stuckMatters: StuckMatter[];
};

/**
 * Pipeline aging: per-stage counts with average + 90th-percentile days-in-stage, plus
 * the stuck-matter list (idle longer than the stuck threshold). Stages with no open
 * matter are still emitted (count 0) so the board renders every column.
 */
export async function aging(uid: string): Promise<AgingReport> {
	const now = new Date();
	const { boardId, lists, listsById, cards } = await loadMatterCards(uid);

	// bucket ages by list
	const agesByList = new Map<string, number[]>();
	const stuckMatters: StuckMatter[] = [];

	for (const card of cards) {
		const age = await daysInStage(card, now);
		const bucket = agesByList.get(card.listId) ?? [];
		bucket.push(age);
		agesByList.set(card.listId, bucket);

		if (age > STUCK_MATTER_DAYS) {
			stuckMatters.push({
				cardId: card._id,
				matterId: card.link.matterId,
				title: card.title,
				stageName: listsById.get(card.listId)?.title ?? card.listId,
				daysInStage: age,
				assignees: card.assignees ?? [],
			});
		}
	}

	const stages: AgingStageRow[] = [...lists]
		.sort((a, b) => a.position - b.position)
		.map((list) => {
			const ages = agesByList.get(list._id) ?? [];
			return {
				listId: list._id,
				stageName: list.title,
				count: ages.length,
				avgDaysInStage: avg(ages),
				p90DaysInStage: percentile(ages, 90),
				stuck: ages.filter((a) => a > STUCK_MATTER_DAYS).length,
			};
		});

	stuckMatters.sort((a, b) => b.daysInStage - a.daysInStage);

	return { boardId, stages, stuckMatters };
}

function avg(values: number[]): number {
	if (!values.length) {
		return 0;
	}
	return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/** Nearest-rank percentile (p in 0..100) over a numeric array; 0 for empty input. */
function percentile(values: number[], p: number): number {
	if (!values.length) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length);
	const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[idx];
}

// ---------------------------------------------------------------------------
// financial — demand outstanding, settled value, projected fees
// ---------------------------------------------------------------------------

export type FinancialReport = {
	boardId: string;
	matterCount: number;
	demandOutstanding: number; // Σ lastDemandAmount on non-settled matters
	settledValue: number; // Σ settlementAmount
	totalBilled: number; // Σ totalBilled
	totalBalance: number; // Σ totalBalance
	projectedFees: number; // settledValue * default contingency fee
	settledMatters: number;
	feePct: number; // the contingency rate used for projectedFees
};

/** Default PI contingency fee used to project fees off settled value (1/3). */
const DEFAULT_FEE_PCT = 1 / 3;

/**
 * Case financials across the matters board: total demand outstanding (sum of last
 * demand on matters not yet settled), settled value, billed/balance totals, and
 * projected fees (settled value × the default contingency rate). All sums are taken
 * over the cached snapshots in JS — never CasePro aggregate_data.
 */
export async function financial(uid: string): Promise<FinancialReport> {
	const { boardId, cards } = await loadMatterCards(uid);

	let demandOutstanding = 0;
	let settledValue = 0;
	let totalBilled = 0;
	let totalBalance = 0;
	let settledMatters = 0;

	for (const card of cards) {
		const snap = snapshotOf(card);
		if (!snap) {
			continue;
		}
		const settlement = n(snap.settlementAmount);
		totalBilled += n(snap.totalBilled);
		totalBalance += n(snap.totalBalance);
		if (settlement > 0) {
			settledValue += settlement;
			settledMatters += 1;
		} else {
			// outstanding demand only counts on matters not yet settled.
			demandOutstanding += n(snap.lastDemandAmount);
		}
	}

	return {
		boardId,
		matterCount: cards.length,
		demandOutstanding,
		settledValue,
		totalBilled,
		totalBalance,
		projectedFees: Math.round(settledValue * DEFAULT_FEE_PCT),
		settledMatters,
		feePct: DEFAULT_FEE_PCT,
	};
}

// ---------------------------------------------------------------------------
// stuckMatters — standalone helper reused by the cron's weekly sweep
// ---------------------------------------------------------------------------

/**
 * Standalone stuck-matter scan (idle > STUCK_MATTER_DAYS in the current stage), reused
 * by the weekly cron. Same derivation as `aging().stuckMatters`. Read-only.
 */
export async function stuckMatters(uid: string): Promise<StuckMatter[]> {
	const { stuckMatters: stuck } = await aging(uid);
	return stuck;
}
