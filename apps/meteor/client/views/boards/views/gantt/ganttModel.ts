import { asTime, isOverdue, type SerializedCard } from '../lib/viewModel';

/**
 * ganttModel — PURE (no React, no I/O) geometry + presentation helpers for the
 * Omnis Boards Gantt timeline. Hand-built (no third-party Gantt lib) so it stays
 * MIT/proprietary and themed to the fork; this module is the testable core that
 * `GanttChart.tsx` renders.
 *
 * Date fields arrive serialized (ISO strings) — `asTime` coerces both string and
 * Date. All math is in epoch-ms with a single DAY_MS unit; the component maps ms
 * → px via the active zoom's pixels-per-day.
 */

export const DAY_MS = 86_400_000;

export type GanttZoom = 'day' | 'week' | 'month';

/** Pixels per calendar day at each zoom level. */
export const ZOOM_DAY_WIDTH: Record<GanttZoom, number> = {
	day: 36,
	week: 16,
	month: 5,
};

/**
 * span      — has both start + due: a real bar (supports move + edge resize).
 * point     — only one date: a single-day bar (supports move only).
 * milestone — `isMilestone`: a diamond at its anchor date (supports move only).
 */
export type GanttBarKind = 'span' | 'point' | 'milestone';

export type GanttRow = {
	card: SerializedCard;
	/** bar start (inclusive), epoch-ms. */
	startMs: number;
	/** bar end (exclusive — startOfDay(due)+DAY for spans), epoch-ms. */
	endMs: number;
	/** the single date a point/milestone sits on (epoch-ms). */
	anchorMs: number;
	kind: GanttBarKind;
	/** 0..1 completion (checklist items, or done flags). */
	progress: number;
	overdue: boolean;
	completed: boolean;
	/** whether the card actually carries each date (drives which patches commit). */
	hasStart: boolean;
	hasDue: boolean;
};

export type GanttEdge = { fromId: string; toId: string };

export type GanttModel = {
	rows: GanttRow[];
	undated: SerializedCard[];
	rangeStartMs: number;
	rangeEndMs: number;
	totalDays: number;
};

export type MonthBand = { startMs: number; label: string; days: number };

export type BarPalette = { fill: string; accent: string };

/** Local midnight for an epoch-ms. */
export const startOfDay = (ms: number): number => {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

/** 0..1 completion: explicit done flags win, else checklist item ratio. */
export const cardProgress = (card: SerializedCard): number => {
	if (card.completed || card.dueComplete) {
		return 1;
	}
	const items = (card.checklists ?? []).flatMap((cl) => cl.items ?? []);
	if (items.length === 0) {
		return 0;
	}
	const done = items.filter((it) => it.done).length;
	return done / items.length;
};

/**
 * Resolve a card to a Gantt row, or `undefined` when it has no usable date.
 * Bars are day-aligned and inclusive of the due day (end is exclusive midnight
 * of the day after due).
 */
export const cardToRow = (card: SerializedCard): GanttRow | undefined => {
	const startMs = asTime(card.startDate);
	const dueMs = asTime(card.dueDate);

	const base = {
		card,
		progress: cardProgress(card),
		overdue: isOverdue(card.dueDate, card.dueComplete),
		completed: Boolean(card.completed || card.dueComplete),
		hasStart: startMs !== undefined,
		hasDue: dueMs !== undefined,
	};

	// Span: both dates and not a milestone → a real bar (end exclusive, min one day).
	if (startMs !== undefined && dueMs !== undefined && !card.isMilestone) {
		const s = startOfDay(startMs);
		const e = Math.max(s + DAY_MS, startOfDay(dueMs) + DAY_MS);
		return { ...base, kind: 'span', startMs: s, endMs: e, anchorMs: dueMs };
	}

	// Otherwise a single anchor date → a milestone diamond, or a one-day point bar.
	const anchorMs = dueMs ?? startMs;
	if (anchorMs === undefined) {
		return undefined;
	}
	const day = startOfDay(anchorMs);
	const kind: GanttBarKind = card.isMilestone ? 'milestone' : 'point';
	return { ...base, kind, startMs: day, endMs: day + DAY_MS, anchorMs };
};

/**
 * Build the full model: dated rows (sorted by start, then anchor), the undated
 * remainder, and a padded date range that comfortably contains every bar. Falls
 * back to a window around `nowMs` when nothing is dated.
 */
export const buildGanttModel = (cards: SerializedCard[], paddingDays = 2, nowMs: number = Date.now()): GanttModel => {
	const rows: GanttRow[] = [];
	const undated: SerializedCard[] = [];

	for (const card of cards) {
		const row = cardToRow(card);
		if (row) {
			rows.push(row);
		} else {
			undated.push(card);
		}
	}

	rows.sort((a, b) => a.startMs - b.startMs || a.anchorMs - b.anchorMs);

	let min: number;
	let max: number;
	if (rows.length === 0) {
		const today = startOfDay(nowMs);
		min = today - 7 * DAY_MS;
		max = today + 21 * DAY_MS;
	} else {
		min = Math.min(...rows.map((r) => r.startMs));
		max = Math.max(...rows.map((r) => r.endMs));
	}

	const rangeStartMs = startOfDay(min) - paddingDays * DAY_MS;
	const rangeEndMs = startOfDay(max) + (paddingDays + 1) * DAY_MS;
	const totalDays = Math.max(1, Math.round((rangeEndMs - rangeStartMs) / DAY_MS));

	return { rows, undated, rangeStartMs, rangeEndMs, totalDays };
};

/**
 * Finish-to-start dependency edges between rows that are BOTH on the chart.
 * Read from the `blocks` side only (the service keeps `blocks`/`blocked-by`
 * mirrored, so this yields each edge exactly once: predecessor → successor).
 */
export const dependencyEdges = (rows: GanttRow[]): GanttEdge[] => {
	const onChart = new Set(rows.map((r) => r.card._id));
	const edges: GanttEdge[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		for (const rel of row.card.relations ?? []) {
			if (rel.type !== 'blocks' || !onChart.has(rel.cardId)) {
				continue;
			}
			const key = `${row.card._id}->${rel.cardId}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			edges.push({ fromId: row.card._id, toId: rel.cardId });
		}
	}
	return edges;
};

/** Month header bands clamped to the visible range (for the time axis). */
export const monthBands = (rangeStartMs: number, rangeEndMs: number): MonthBand[] => {
	const bands: MonthBand[] = [];
	const start = new Date(rangeStartMs);
	let cur = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
	while (cur < rangeEndMs) {
		const d = new Date(cur);
		const next = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
		const bandStart = Math.max(cur, rangeStartMs);
		const bandEnd = Math.min(next, rangeEndMs);
		const days = Math.max(0, Math.round((bandEnd - bandStart) / DAY_MS));
		if (days > 0) {
			bands.push({ startMs: bandStart, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), days });
		}
		cur = next;
	}
	return bands;
};

/**
 * Bar colours keyed to state, in priority order: completed → overdue → card
 * priority → default. Translucent fills read correctly on both light and dark
 * themes; the accent is used for the progress fill, border, and milestone.
 */
export const barPalette = (row: GanttRow): BarPalette => {
	if (row.completed) {
		return { fill: 'rgba(20, 134, 96, 0.16)', accent: '#148660' };
	}
	if (row.overdue) {
		return { fill: 'rgba(224, 43, 43, 0.16)', accent: '#e02b2b' };
	}
	switch (row.card.priority) {
		case 'urgent':
			return { fill: 'rgba(224, 43, 43, 0.14)', accent: '#e8503a' };
		case 'high':
			return { fill: 'rgba(243, 140, 57, 0.18)', accent: '#f38c39' };
		case 'medium':
			return { fill: 'rgba(9, 90, 210, 0.14)', accent: '#095ad2' };
		case 'low':
			return { fill: 'rgba(108, 114, 122, 0.16)', accent: '#6c727a' };
		default:
			return { fill: 'rgba(9, 90, 210, 0.12)', accent: '#5a8bd6' };
	}
};
