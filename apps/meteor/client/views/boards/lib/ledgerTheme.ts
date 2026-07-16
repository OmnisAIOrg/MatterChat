import { useThemeMode } from '@rocket.chat/ui-client';
import type { CSSProperties } from 'react';

/**
 * ledgerTheme — the founder-approved "Ledger-dense" brand tokens for the Boards
 * DEPTH screens (Caseload / Reports / Calendars / Table / Timeline / Gantt /
 * Dashboard / Planner / Inbox). STYLE-ONLY support module: pure constants + a
 * theme-resolving hook — no data flow, no endpoints, no behavior.
 *
 * The tokens mirror MainLayoutStyleTags.tsx (the chat-surface ledger skin):
 *   paper #FAF7EE light / #12161D dark, cards #fffdf6 + #f2efe2 light / #1A2029
 *   dark, khaki strokes, brand green #1B7A2E (links #15692A light / #5BD07E
 *   dark), serif 'Iowan Old Style' captions, tabular-nums figures, and the SOL
 *   heat scale green / amber #e0a63c / red #e35d5d.
 *
 * Dark is a calm dense dark surface — never inverted paper. High-contrast (the
 * a11y theme) resolves to the light (paper) tones, which keep AA contrast.
 * No transitions/animations are defined here, so reduced-motion is respected
 * by construction.
 */

export const LEDGER_SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
export const LEDGER_MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export type LedgerTones = {
	/** page ground */
	paper: string;
	/** primary card surface */
	card: string;
	/** secondary/alternate card surface (row hover, small tags) */
	cardAlt: string;
	/** khaki (light) / slate (dark) structure lines */
	stroke: string;
	/** fainter ruled-paper line (row rules, gridlines) */
	strokeSoft: string;
	/** muted warm ink for captions/metadata */
	inkMuted: string;
	/** brand green — the single accent */
	green: string;
	/** translucent green fill (bars, selected tint) */
	greenSoft: string;
	/** green link/figure color tuned per theme */
	link: string;
	/** semantic risk — amber */
	amber: string;
	amberSoft: string;
	/** semantic risk — red */
	red: string;
	redSoft: string;
	/** "today" cell tint on calendar grids */
	todayTint: string;
};

export const LIGHT_LEDGER: LedgerTones = {
	paper: '#FAF7EE',
	card: '#fffdf6',
	cardAlt: '#f2efe2',
	stroke: '#C9BE9A',
	strokeSoft: 'rgba(150, 130, 80, 0.22)',
	inkMuted: '#6E6852',
	green: '#1B7A2E',
	greenSoft: 'rgba(27, 122, 46, 0.10)',
	link: '#15692A',
	amber: '#e0a63c',
	amberSoft: 'rgba(224, 166, 60, 0.16)',
	red: '#e35d5d',
	redSoft: 'rgba(227, 93, 93, 0.14)',
	todayTint: '#E4F3E8',
};

export const DARK_LEDGER: LedgerTones = {
	paper: '#12161D',
	card: '#1A2029',
	cardAlt: '#202836',
	stroke: '#3A414D',
	strokeSoft: 'rgba(255, 255, 255, 0.07)',
	inkMuted: '#8E96A3',
	green: '#3FA85C',
	greenSoft: 'rgba(63, 168, 92, 0.14)',
	link: '#5BD07E',
	amber: '#e0a63c',
	amberSoft: 'rgba(224, 166, 60, 0.18)',
	red: '#e35d5d',
	redSoft: 'rgba(227, 93, 93, 0.18)',
	todayTint: '#24352A',
};

/** Resolve the active ledger tones from the user's theme (dark stays calm dark; high-contrast → paper). */
export const useLedgerTones = (): LedgerTones => {
	const [, , theme] = useThemeMode();
	return theme === 'dark' ? DARK_LEDGER : LIGHT_LEDGER;
};

/**
 * SOL/deadline heat scale: > 90 days out = green (on plan), <= 90 = amber,
 * <= 30 or already passed = red. Undated falls back to the neutral stroke.
 */
export const solHeatColor = (tones: LedgerTones, days: number | undefined): string => {
	if (days === undefined) {
		return tones.stroke;
	}
	if (days <= 30) {
		return tones.red;
	}
	if (days <= 90) {
		return tones.amber;
	}
	return tones.green;
};

/** Serif "case caption" — page titles, section heads, month captions. */
export const serifCaption: CSSProperties = {
	fontFamily: LEDGER_SERIF,
	fontWeight: 600,
	letterSpacing: '0.005em',
};

/** Tabular figures — every numeric column/metric. */
export const tabularNums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Small-caps mono — column headers / axis labels ("the docket stamp"). */
export const monoLabel = (tones: LedgerTones): CSSProperties => ({
	fontFamily: LEDGER_MONO,
	fontSize: 11,
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: tones.inkMuted,
});

/** A small ledger tag — dense khaki-stroked pill (stage tags, label chips). */
export const smallTag = (tones: LedgerTones): CSSProperties => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: 3,
	padding: '1px 6px',
	borderRadius: 3,
	border: `1px solid ${tones.stroke}`,
	background: tones.cardAlt,
	fontSize: 11,
	lineHeight: '16px',
	whiteSpace: 'nowrap',
});

/** A small semantic pill (risk counts, due chips) tinted by heat color. */
export const heatPill = (color: string, softBg: string): CSSProperties => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: 4,
	padding: '1px 7px',
	borderRadius: 3,
	background: softBg,
	color,
	fontSize: 11,
	lineHeight: '16px',
	fontWeight: 600,
	fontVariantNumeric: 'tabular-nums',
	whiteSpace: 'nowrap',
});

/** The heat dot — a compact SOL indicator. */
export const heatDot = (color: string): CSSProperties => ({
	display: 'inline-block',
	width: 8,
	height: 8,
	borderRadius: '50%',
	background: color,
	flexShrink: 0,
});
