import { Box } from '@rocket.chat/fuselage';
import { useThemeMode } from '@rocket.chat/ui-client';
import type { CSSProperties, ReactElement } from 'react';

/**
 * "Ledger-dense" style helpers for the card-detail chrome (Wave 2 — leads +
 * card drawer). The same brand language MainLayoutStyleTags applies to the chat
 * surface — warm paper in light / calm dense dark, khaki rules, brand green as
 * the ACTION color, serif "case caption" names, tabular figures — expressed as
 * component-level constants for the card drawer, where the chat-surface token
 * overrides don't reach. STYLE ONLY: nothing here reads or mutates data.
 *
 * Token provenance (keep in sync with MainLayoutStyleTags.tsx):
 *   paper  #FAF7EE light / #12161D dark        (surfaceRoom)
 *   cards  #f2efe2 light / #1A2029 dark        (cardOwnBg / cardOtherBg)
 *   rules  khaki rgba(150,130,80,…) / slate     (ruledLines / railOther)
 *   green  #15692A light / #5BD07E dark         (link greens; base #1B7A2E)
 *   heat   green / amber #e0a63c / red #e35d5d  (SOL heat)
 */

export type LedgerHeat = 'green' | 'amber' | 'red';

export type LedgerTone = {
	dark: boolean;
	/** Paper (light) / calm dark surface behind the drawer content. */
	paper: string;
	/** Warm card fill for comment/quote blocks. */
	card: string;
	/** Khaki hairline (light) / slate hairline (dark) — the "ledger rule". */
	rule: string;
	/** Muted small-caps section-head ink. */
	head: string;
	/** Brand green — action/progress accents (link-green flavor per theme). */
	green: string;
	/** SOL heat — warning / danger. */
	amber: string;
	red: string;
};

const LIGHT_TONE: LedgerTone = {
	dark: false,
	paper: '#FAF7EE',
	card: '#f2efe2',
	rule: 'rgba(150, 130, 80, 0.30)',
	head: '#6E6650',
	green: '#15692A',
	amber: '#e0a63c',
	red: '#e35d5d',
};

const DARK_TONE: LedgerTone = {
	dark: true,
	paper: '#12161D',
	card: '#1A2029',
	rule: '#2E3540',
	head: '#8C94A3',
	green: '#5BD07E',
	amber: '#e0a63c',
	red: '#e35d5d',
};

// High-contrast (a11y) stays essentially stock, mirroring the `branded` gate in
// MainLayoutStyleTags: no tinted surfaces, and a plain dark hairline for rules.
const HIGH_CONTRAST_TONE: LedgerTone = {
	...LIGHT_TONE,
	paper: 'transparent',
	card: 'transparent',
	rule: 'rgba(0, 0, 0, 0.4)',
};

/** Theme-following ledger tone (light / dark; high-contrast ≈ stock surfaces). */
export const useLedgerTone = (): LedgerTone => {
	const [, , theme] = useThemeMode();
	if (theme === 'dark') {
		return DARK_TONE;
	}
	return theme === 'light' ? LIGHT_TONE : HIGH_CONTRAST_TONE;
};

export const SERIF_STACK = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

/** "Case caption" — serif name/title treatment (mirrors the room-header caption). */
export const serifCaption: CSSProperties = {
	fontFamily: SERIF_STACK,
	fontWeight: 600,
	letterSpacing: '0.005em',
};

/** Lining figures that align in columns — money, scores, counters, timestamps. */
export const tabularFigures: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Compact small-caps section head. */
export const ledgerHead = (tone: LedgerTone): CSSProperties => ({
	fontSize: 11,
	lineHeight: '16px',
	fontWeight: 700,
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: tone.head,
});

/** Khaki hairline under a section head / between dense rows (no layout shift). */
export const ledgerRule = (tone: LedgerTone): CSSProperties => ({
	boxShadow: `inset 0 -1px 0 0 ${tone.rule}`,
});

export const heatColor = (tone: LedgerTone, heat: LedgerHeat): string => {
	if (heat === 'red') {
		return tone.red;
	}
	return heat === 'amber' ? tone.amber : tone.green;
};

/**
 * Compact heat chip — leading dot + hairline border + faint fill in the heat
 * color; the label ink stays default for contrast (heat reads as the accent).
 */
export const heatChipStyle = (tone: LedgerTone, heat: LedgerHeat): CSSProperties => {
	const color = heatColor(tone, heat);
	return {
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '1px 6px',
		borderRadius: 4,
		fontSize: 11,
		lineHeight: '16px',
		border: `1px solid ${color}`,
		backgroundColor: `${color}${tone.dark ? '2b' : '1f'}`,
		whiteSpace: 'nowrap',
		...tabularFigures,
	};
};

/** The heat chip's leading dot — render as `<span aria-hidden='true' style={heatDotStyle(color)} />`. */
export const heatDotStyle = (color: string): CSSProperties => ({
	width: 6,
	height: 6,
	borderRadius: 3,
	backgroundColor: color,
	flexShrink: 0,
});

/** Thin ledger progress rule — green fill on a khaki track (visual only; the
 * adjacent "{done}/{total}" text carries the information). */
export const LedgerProgress = ({ percent, tone }: { percent: number; tone: LedgerTone }): ReactElement => (
	<Box aria-hidden='true' style={{ height: 3, borderRadius: 2, backgroundColor: tone.rule, overflow: 'hidden' }}>
		<Box
			style={{
				height: '100%',
				width: `${Math.min(100, Math.max(0, percent))}%`,
				borderRadius: 2,
				backgroundColor: tone.green,
			}}
		/>
	</Box>
);
