import { Box, Button, ButtonGroup, Icon } from '@rocket.chat/fuselage';
import { useMethod, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	DAY_MS,
	ZOOM_DAY_WIDTH,
	buildGanttModel,
	dependencyEdges,
	monthBands,
	startOfDay,
	type BarPalette,
	type GanttRow,
	type GanttZoom,
} from './ganttModel';
import { getCardTypeIcon } from '../../lib/icons';
import { LEDGER_MONO, LEDGER_SERIF, monoLabel, useLedgerTones, type LedgerTones } from '../../lib/ledgerTheme';
import { asTime, fmtDate, type SerializedBoard, type SerializedCard } from '../lib/viewModel';

/**
 * GanttChart — a true, hand-built Gantt for the Omnis Boards Timeline view.
 *
 * Reads the same `boards.views.cards` rows the list timeline uses, and draws:
 *   • a sticky month time-axis (Day / Week / Month zoom),
 *   • one row per card with a bar spanning startDate→dueDate (single-day bar when
 *     only one date is set; a diamond for `isMilestone` cards),
 *   • a progress fill (checklist completion) and priority/overdue/done colouring,
 *   • finish-to-start dependency arrows from `relations` (`blocks`),
 *   • drag-to-reschedule (move the whole bar) and edge-resize (change start/due),
 *     committed via `POST /v1/boards.card.update` with an optimistic local override.
 *
 * No third-party Gantt dependency — geometry lives in the pure `ganttModel` so the
 * feature stays MIT/proprietary and themed to the fork.
 *
 * LEDGER-DENSE SKIN (style-only): paper ground, khaki structure/grid lines,
 * serif month bands + small-caps mono axis labels, dense rows, and the ledger
 * bar palette — green is the primary series, amber/red reserved for risk
 * (high priority / overdue), done recedes to khaki. The bar-state PRIORITY
 * ORDER (completed → overdue → priority → default) mirrors ganttModel's
 * `barPalette`; only the colors are remapped here. Gantt math untouched.
 */

// Ledger remap of ganttModel.barPalette — same decision order, brand colors.
const ledgerBarPalette = (row: GanttRow, tones: LedgerTones): BarPalette => {
	if (row.completed) {
		return { fill: tones.strokeSoft, accent: tones.stroke };
	}
	if (row.overdue) {
		return { fill: tones.redSoft, accent: tones.red };
	}
	switch (row.card.priority) {
		case 'urgent':
			return { fill: tones.redSoft, accent: tones.red };
		case 'high':
			return { fill: tones.amberSoft, accent: tones.amber };
		case 'low':
			return { fill: tones.strokeSoft, accent: tones.stroke };
		case 'medium':
		default:
			return { fill: tones.greenSoft, accent: tones.green };
	}
};

type GanttChartProps = {
	board: SerializedBoard;
	cards: SerializedCard[];
	onOpenCard: (cardId: string) => void;
};

type DragMode = 'move' | 'resize-start' | 'resize-end';

type DragState = { cardId: string; mode: DragMode; startMs: number; endMs: number };

type DragContext = {
	cardId: string;
	mode: DragMode;
	startClientX: number;
	origStartMs: number;
	origEndMs: number;
	origCardStartMs?: number;
	origCardDueMs?: number;
	hasStart: boolean;
	hasDue: boolean;
	dayWidth: number;
	maxMovedPx: number;
	// frozen visible range for clamping the dragged bar so it can't escape the chart
	rangeStartMs: number;
	rangeEndMs: number;
};

const GUTTER = 248;
// Ledger density: tighter rows/bars (pure spacing — all geometry derives from these constants).
const ROW_H = 30;
const HEADER_H = 40;
const BAR_H = 16;
const BAR_TOP = (ROW_H - BAR_H) / 2;
const CLICK_SLOP_PX = 4;

const GanttChart = ({ board, cards, onOpenCard }: GanttChartProps): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const dispatchToast = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const cardUpdate = useMethod('boards.cardUpdate');

	const [zoom, setZoom] = useState<GanttZoom>('week');
	const [localOverrides, setLocalOverrides] = useState<Record<string, { startDate?: string; dueDate?: string }>>({});
	const [drag, setDrag] = useState<DragState | null>(null);
	const dragRef = useRef<DragContext | null>(null);
	// Per-card token so a settling mutation only clears its OWN optimistic override
	// (a newer drag on the same card bumps the token and keeps its override).
	const overrideTokenRef = useRef<Record<string, number>>({});

	const clearOverrideIfCurrent = useCallback((cardId: string, token: number): void => {
		if (overrideTokenRef.current[cardId] !== token) {
			return;
		}
		setLocalOverrides((prev) => {
			const next = { ...prev };
			delete next[cardId];
			return next;
		});
	}, []);

	const { mutate } = useMutation({
		mutationFn: (vars: { cardId: string; patch: { startDate?: Date; dueDate?: Date }; token: number }) =>
			cardUpdate({ cardId: vars.cardId, patch: vars.patch }),
		onSuccess: async (_data, vars) => {
			// Refresh the Gantt's own view AND the board / table / card-drawer views.
			await queryClient.invalidateQueries({ queryKey: ['boards', 'views', 'cards', board._id] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', board._id] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', vars.cardId] });
			clearOverrideIfCurrent(vars.cardId, vars.token);
		},
		onError: (error, vars) => {
			clearOverrideIfCurrent(vars.cardId, vars.token);
			dispatchToast({ type: 'error', message: error });
		},
	});

	// Apply optimistic overrides before building the model so a just-dragged bar
	// holds its new position until the refetch lands.
	const effectiveCards = useMemo(() => {
		if (Object.keys(localOverrides).length === 0) {
			return cards;
		}
		return cards.map((card) => (localOverrides[card._id] ? { ...card, ...localOverrides[card._id] } : card));
	}, [cards, localOverrides]);

	const model = useMemo(() => buildGanttModel(effectiveCards), [effectiveCards]);
	const edges = useMemo(() => dependencyEdges(model.rows), [model.rows]);
	const indexById = useMemo(() => new Map(model.rows.map((r, i) => [r.card._id, i])), [model.rows]);

	const dayWidth = ZOOM_DAY_WIDTH[zoom];
	const chartWidth = model.totalDays * dayWidth;
	const bodyHeight = Math.max(model.rows.length * ROW_H, ROW_H);
	const xOf = useCallback((ms: number) => ((ms - model.rangeStartMs) / DAY_MS) * dayWidth, [model.rangeStartMs, dayWidth]);

	const bands = useMemo(() => monthBands(model.rangeStartMs, model.rangeEndMs), [model.rangeStartMs, model.rangeEndMs]);
	const todayX = useMemo(() => {
		const t0 = startOfDay(Date.now());
		if (t0 < model.rangeStartMs || t0 > model.rangeEndMs) {
			return undefined;
		}
		return xOf(t0);
	}, [model.rangeStartMs, model.rangeEndMs, xOf]);

	// --- drag-to-reschedule -------------------------------------------------

	const onDragMove = useCallback((e: PointerEvent) => {
		const ctx = dragRef.current;
		if (!ctx) {
			return;
		}
		const dx = e.clientX - ctx.startClientX;
		ctx.maxMovedPx = Math.max(ctx.maxMovedPx, Math.abs(dx));
		const dxDays = Math.round(dx / ctx.dayWidth);
		// Clamp only the DISPLAYED bar to the frozen range so it can't slide under the
		// sticky gutter / off-chart; the committed value (computed in onDragSettle from
		// the original card date) is intentionally unclamped — the range re-expands on refetch.
		const clamp = (ms: number): number => Math.max(ctx.rangeStartMs, Math.min(ctx.rangeEndMs, ms));
		let startMs = ctx.origStartMs;
		let endMs = ctx.origEndMs;
		if (ctx.mode === 'move') {
			startMs = clamp(ctx.origStartMs + dxDays * DAY_MS);
			endMs = clamp(ctx.origEndMs + dxDays * DAY_MS);
		} else if (ctx.mode === 'resize-end') {
			endMs = clamp(Math.max(ctx.origStartMs + DAY_MS, ctx.origEndMs + dxDays * DAY_MS));
		} else {
			startMs = clamp(Math.min(ctx.origEndMs - DAY_MS, ctx.origStartMs + dxDays * DAY_MS));
		}
		setDrag({ cardId: ctx.cardId, mode: ctx.mode, startMs, endMs });
	}, []);

	const onDragSettle = useCallback(
		(e: PointerEvent) => {
			window.removeEventListener('pointermove', onDragMove);
			window.removeEventListener('pointerup', onDragSettle);
			window.removeEventListener('pointercancel', onDragSettle);
			const ctx = dragRef.current;
			dragRef.current = null;
			setDrag(null);
			// pointercancel (OS / gesture takeover): abandon the gesture — no commit, no click.
			if (!ctx || e.type === 'pointercancel') {
				return;
			}
			const dxDays = Math.round((e.clientX - ctx.startClientX) / ctx.dayWidth);
			// A press with no real movement is a click → open the card.
			if (ctx.maxMovedPx < CLICK_SLOP_PX && dxDays === 0) {
				onOpenCard(ctx.cardId);
				return;
			}
			if (dxDays === 0) {
				return;
			}

			const shift = dxDays * DAY_MS;
			const patch: { startDate?: Date; dueDate?: Date } = {};
			const override: { startDate?: string; dueDate?: string } = {};
			// Commit Date objects (DDP serializes them); keep ISO strings for the optimistic display override.
			const apply = (key: 'startDate' | 'dueDate', ms: number): void => {
				const d = new Date(ms);
				patch[key] = d;
				override[key] = d.toISOString();
			};
			if (ctx.mode === 'move') {
				if (ctx.hasStart && ctx.origCardStartMs !== undefined) {
					apply('startDate', ctx.origCardStartMs + shift);
				}
				if (ctx.hasDue && ctx.origCardDueMs !== undefined) {
					apply('dueDate', ctx.origCardDueMs + shift);
				}
			} else if (ctx.mode === 'resize-end' && ctx.origCardDueMs !== undefined) {
				let dueMs = ctx.origCardDueMs + shift;
				if (ctx.origCardStartMs !== undefined) {
					dueMs = Math.max(dueMs, ctx.origCardStartMs + DAY_MS);
				}
				apply('dueDate', dueMs);
			} else if (ctx.mode === 'resize-start' && ctx.origCardStartMs !== undefined) {
				let newStartMs = ctx.origCardStartMs + shift;
				if (ctx.origCardDueMs !== undefined) {
					newStartMs = Math.min(newStartMs, ctx.origCardDueMs - DAY_MS);
				}
				apply('startDate', newStartMs);
			}

			if (!patch.startDate && !patch.dueDate) {
				return;
			}
			const token = (overrideTokenRef.current[ctx.cardId] ?? 0) + 1;
			overrideTokenRef.current[ctx.cardId] = token;
			setLocalOverrides((prev) => ({ ...prev, [ctx.cardId]: { ...prev[ctx.cardId], ...override } }));
			mutate({ cardId: ctx.cardId, patch, token });
		},
		[mutate, onDragMove, onOpenCard],
	);

	const beginDrag = useCallback(
		(e: React.PointerEvent<HTMLElement>, row: GanttRow, mode: DragMode) => {
			if (e.button !== 0) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			dragRef.current = {
				cardId: row.card._id,
				mode,
				startClientX: e.clientX,
				origStartMs: row.startMs,
				origEndMs: row.endMs,
				origCardStartMs: asTime(row.card.startDate),
				origCardDueMs: asTime(row.card.dueDate),
				hasStart: row.hasStart,
				hasDue: row.hasDue,
				dayWidth,
				maxMovedPx: 0,
				rangeStartMs: model.rangeStartMs,
				rangeEndMs: model.rangeEndMs,
			};
			setDrag({ cardId: row.card._id, mode, startMs: row.startMs, endMs: row.endMs });
			window.addEventListener('pointermove', onDragMove);
			window.addEventListener('pointerup', onDragSettle);
			window.addEventListener('pointercancel', onDragSettle);
		},
		[dayWidth, model.rangeStartMs, model.rangeEndMs, onDragMove, onDragSettle],
	);

	// Safety net: if the component unmounts mid-drag, drop the window listeners.
	useEffect(
		() => () => {
			window.removeEventListener('pointermove', onDragMove);
			window.removeEventListener('pointerup', onDragSettle);
			window.removeEventListener('pointercancel', onDragSettle);
		},
		[onDragMove, onDragSettle],
	);

	// --- render -------------------------------------------------------------

	const zoomButtons: { id: GanttZoom; label: string }[] = [
		{ id: 'day', label: t('Boards_Gantt_Zoom_Day', { defaultValue: 'Day' }) },
		{ id: 'week', label: t('Boards_Gantt_Zoom_Week', { defaultValue: 'Week' }) },
		{ id: 'month', label: t('Boards_Gantt_Zoom_Month', { defaultValue: 'Month' }) },
	];

	const renderBar = (row: GanttRow): ReactElement | null => {
		const active = drag?.cardId === row.card._id ? drag : null;
		const isDragged = active !== null;
		const startMs = active ? active.startMs : row.startMs;
		const endMs = active ? active.endMs : row.endMs;
		const palette = ledgerBarPalette(row, tones);
		const tooltip = `${row.card.title}${row.hasStart ? ` · ${fmtDate(row.card.startDate)}` : ''}${
			row.hasDue ? ` → ${fmtDate(row.card.dueDate)}` : ''
		}`;

		if (row.kind === 'milestone') {
			const cx = xOf(startMs) + dayWidth / 2;
			return (
				<Box
					key={row.card._id}
					title={tooltip}
					onPointerDown={(e) => beginDrag(e, row, 'move')}
					position='absolute'
					style={{
						left: cx - 7,
						top: ROW_H / 2 - 7,
						width: 14,
						height: 14,
						transform: 'rotate(45deg)',
						background: palette.accent,
						borderRadius: 2,
						cursor: 'grab',
						touchAction: 'none',
					}}
				/>
			);
		}

		const left = xOf(startMs);
		const width = Math.max(6, xOf(endMs) - left);
		const progressW = Math.max(0, Math.min(1, row.progress)) * width;
		const isSpan = row.kind === 'span';

		return (
			<Box
				key={row.card._id}
				title={tooltip}
				onPointerDown={(e) => beginDrag(e, row, 'move')}
				position='absolute'
				display='flex'
				alignItems='center'
				style={{
					left,
					top: BAR_TOP,
					width,
					height: BAR_H,
					background: palette.fill,
					border: `1px solid ${palette.accent}`,
					borderRadius: 4,
					cursor: 'grab',
					overflow: 'hidden',
					touchAction: 'none',
					opacity: isDragged ? 0.85 : 1,
				}}
			>
				{/* progress fill */}
				<Box
					position='absolute'
					style={{ left: 0, top: 0, bottom: 0, width: progressW, background: palette.accent, opacity: 0.45, pointerEvents: 'none' }}
				/>
				{/* edge resize handles (spans only) */}
				{isSpan && (
					<>
						<Box
							onPointerDown={(e) => beginDrag(e, row, 'resize-start')}
							position='absolute'
							style={{ left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', touchAction: 'none' }}
						/>
						<Box
							onPointerDown={(e) => beginDrag(e, row, 'resize-end')}
							position='absolute'
							style={{ right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', touchAction: 'none' }}
						/>
					</>
				)}
			</Box>
		);
	};

	const empty = model.rows.length === 0 && model.undated.length === 0;

	return (
		<Box pi={24} pb={16} display='flex' flexDirection='column' style={{ minWidth: 0, background: tones.paper }}>
			{/* toolbar */}
			<Box display='flex' alignItems='center' justifyContent='space-between' mbe={12} style={{ gap: '12px', flexWrap: 'wrap' }}>
				<Box display='flex' alignItems='center' fontScale='c1' style={{ gap: '14px', flexWrap: 'wrap', color: tones.inkMuted }}>
					<Box display='flex' alignItems='center' style={{ gap: '5px' }}>
						<Box style={{ width: 10, height: 10, borderRadius: 3, background: tones.green }} />{' '}
						{t('Boards_Gantt_Legend_Scheduled', { defaultValue: 'Scheduled' })}
					</Box>
					<Box display='flex' alignItems='center' style={{ gap: '5px' }}>
						<Box style={{ width: 10, height: 10, borderRadius: 3, background: tones.red }} />{' '}
						{t('Boards_Gantt_Legend_Overdue', { defaultValue: 'Overdue' })}
					</Box>
					<Box display='flex' alignItems='center' style={{ gap: '5px' }}>
						<Box style={{ width: 10, height: 10, borderRadius: 3, background: tones.stroke }} />{' '}
						{t('Boards_Gantt_Legend_Done', { defaultValue: 'Done' })}
					</Box>
					<Box display='flex' alignItems='center' style={{ gap: '5px' }}>
						<Box style={{ width: 10, height: 10, transform: 'rotate(45deg)', background: tones.green }} />{' '}
						{t('Boards_Gantt_Legend_Milestone', { defaultValue: 'Milestone' })}
					</Box>
				</Box>
				<ButtonGroup small>
					{zoomButtons.map((z) => (
						<Button key={z.id} small primary={zoom === z.id} onClick={() => setZoom(z.id)}>
							{z.label}
						</Button>
					))}
				</ButtonGroup>
			</Box>

			{empty ? (
				<Box fontScale='c1' color='hint'>
					{t('Boards_Gantt_Empty', { defaultValue: 'No cards with a start or due date yet. Add dates to a card to plot it here.' })}
				</Box>
			) : (
				<Box
					style={{
						overflow: 'auto',
						maxHeight: '70vh',
						border: `1px solid ${tones.stroke}`,
						borderRadius: 6,
						position: 'relative',
						background: tones.card,
						userSelect: drag ? 'none' : undefined,
					}}
				>
					<Box style={{ width: GUTTER + chartWidth, position: 'relative' }}>
						{/* sticky header: corner + month bands */}
						<Box display='flex' style={{ position: 'sticky', top: 0, zIndex: 5, height: HEADER_H, background: tones.card }}>
							<Box
								style={{
									width: GUTTER,
									flexShrink: 0,
									position: 'sticky',
									left: 0,
									zIndex: 6,
									background: tones.card,
									borderInlineEnd: `1px solid ${tones.stroke}`,
									borderBlockEnd: `1px solid ${tones.stroke}`,
									...monoLabel(tones),
								}}
								display='flex'
								alignItems='center'
								pi={12}
							>
								{t('Boards_Gantt_Task', { defaultValue: 'Task' })}
							</Box>
							<Box display='flex' style={{ width: chartWidth, borderBlockEnd: `1px solid ${tones.stroke}` }}>
								{bands.map((b) => (
									<Box
										key={b.startMs}
										display='flex'
										alignItems='center'
										justifyContent='center'
										fontScale='c2'
										color='default'
										style={{
											width: b.days * dayWidth,
											flexShrink: 0,
											borderInlineStart: `1px solid ${tones.strokeSoft}`,
											fontFamily: LEDGER_SERIF,
											fontWeight: 600,
										}}
									>
										{b.label}
									</Box>
								))}
							</Box>
						</Box>

						{/* body */}
						<Box style={{ position: 'relative' }}>
							{/* grid + today marker (behind rows) */}
							<Box
								style={{
									position: 'absolute',
									left: GUTTER,
									top: 0,
									width: chartWidth,
									height: bodyHeight,
									zIndex: 0,
									pointerEvents: 'none',
								}}
							>
								{Array.from({ length: Math.ceil(model.totalDays / 7) + 1 }).map((_, i) => (
									<Box
										key={i}
										style={{
											position: 'absolute',
											left: i * 7 * dayWidth,
											top: 0,
											bottom: 0,
											width: 1,
											background: tones.strokeSoft,
										}}
									/>
								))}
								{todayX !== undefined && (
									<Box
										style={{
											position: 'absolute',
											left: todayX,
											top: 0,
											bottom: 0,
											width: 2,
											background: tones.green,
											opacity: 0.6,
										}}
									/>
								)}
							</Box>

							{/* rows */}
							{model.rows.map((row) => (
								<Box key={row.card._id} display='flex' style={{ height: ROW_H, position: 'relative', zIndex: 1 }}>
									<Box
										role='button'
										tabIndex={0}
										onClick={() => onOpenCard(row.card._id)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												onOpenCard(row.card._id);
											}
										}}
										display='flex'
										alignItems='center'
										style={{
											width: GUTTER,
											flexShrink: 0,
											position: 'sticky',
											left: 0,
											zIndex: 2,
											gap: '8px',
											cursor: 'pointer',
											background: tones.card,
											borderInlineEnd: `1px solid ${tones.stroke}`,
											borderBlockEnd: `1px solid ${tones.strokeSoft}`,
										}}
										pi={12}
									>
										<Icon name={getCardTypeIcon(row.card.cardType)} size='x16' style={{ color: tones.inkMuted }} />
										<Box fontScale='c1' color='default' withTruncatedText flexGrow={1}>
											{row.card.title}
										</Box>
										{row.card.cardNumber ? (
											<Box style={{ flexShrink: 0, fontFamily: LEDGER_MONO, fontSize: 10, color: tones.inkMuted }}>
												#{row.card.cardNumber}
											</Box>
										) : null}
									</Box>
									<Box
										style={{
											width: chartWidth,
											position: 'relative',
											borderBlockEnd: `1px solid ${tones.strokeSoft}`,
										}}
									>
										{renderBar(row)}
									</Box>
								</Box>
							))}

							{/* dependency arrows (above bars, non-interactive) */}
							{edges.length > 0 && (
								<svg
									width={chartWidth}
									height={bodyHeight}
									style={{ position: 'absolute', left: GUTTER, top: 0, zIndex: 3, pointerEvents: 'none', overflow: 'visible' }}
								>
									<defs>
										<marker id='omnis-gantt-arrow' markerWidth='8' markerHeight='8' refX='6' refY='3' orient='auto'>
											<path d='M0,0 L6,3 L0,6 Z' fill={tones.inkMuted} />
										</marker>
										<marker id='omnis-gantt-arrow-conflict' markerWidth='8' markerHeight='8' refX='6' refY='3' orient='auto'>
											<path d='M0,0 L6,3 L0,6 Z' fill={tones.red} />
										</marker>
									</defs>
									{edges.map((edge) => {
										const fromIdx = indexById.get(edge.fromId);
										const toIdx = indexById.get(edge.toId);
										if (fromIdx === undefined || toIdx === undefined) {
											return null;
										}
										const fromRow = model.rows[fromIdx];
										const toRow = model.rows[toIdx];
										const x1 = xOf(fromRow.endMs);
										const y1 = fromIdx * ROW_H + ROW_H / 2;
										const x2 = xOf(toRow.startMs);
										const y2 = toIdx * ROW_H + ROW_H / 2;
										const conflict = x2 < x1;
										return (
											<path
												key={`${edge.fromId}->${edge.toId}`}
												d={`M ${x1} ${y1} C ${x1 + 26} ${y1}, ${x2 - 26} ${y2}, ${x2} ${y2}`}
												fill='none'
												stroke={conflict ? tones.red : tones.inkMuted}
												strokeWidth={1.5}
												strokeDasharray={conflict ? '4 3' : undefined}
												markerEnd={`url(#omnis-gantt-arrow${conflict ? '-conflict' : ''})`}
											/>
										);
									})}
								</svg>
							)}
						</Box>
					</Box>
				</Box>
			)}

			{/* undated cards */}
			{model.undated.length > 0 && (
				<Box mbs={16}>
					<Box mbe={8} style={monoLabel(tones)}>
						{t('Boards_Gantt_Undated', { defaultValue: 'Undated' })} ({model.undated.length})
					</Box>
					<Box display='flex' style={{ gap: '6px', flexWrap: 'wrap' }}>
						{model.undated.map((card) => (
							<Box
								key={card._id}
								role='button'
								tabIndex={0}
								onClick={() => onOpenCard(card._id)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										onOpenCard(card._id);
									}
								}}
								display='flex'
								alignItems='center'
								pi={8}
								pb={4}
								style={{
									cursor: 'pointer',
									gap: '6px',
									maxWidth: 220,
									background: tones.card,
									border: `1px solid ${tones.stroke}`,
									borderRadius: 4,
								}}
							>
								<Icon name={getCardTypeIcon(card.cardType)} size='x14' style={{ color: tones.inkMuted }} />
								<Box fontScale='c1' color='default' withTruncatedText>
									{card.title}
								</Box>
							</Box>
						))}
					</Box>
				</Box>
			)}
		</Box>
	);
};

export default GanttChart;
