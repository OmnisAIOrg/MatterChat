/**
 * "Ledger-dense" shared style tokens — the founder-approved MatterChat visual language
 * (see the chat-surface restyle in client/views/root/MainLayout/MainLayoutStyleTags.tsx),
 * extended app-wide (My Day / Boards / Matter Workspace / LitBox Files).
 *
 * SINGLE SOURCE OF TRUTH: every color here is a `var(--mc-ledger-*)` / `var(--mc-sol-*)`
 * reference. The actual per-theme values (warm paper in light, calm dense dark in dark)
 * are declared once in MainLayoutStyleTags.tsx alongside the chat-surface ledger palette
 * — same values, one language, no drift. The literal fallbacks below are the LIGHT theme
 * values, used only when the branded palette is absent (the stock high-contrast theme).
 *
 * FORK-SAFE: this is a new fork-owned file; consumers are all fork-owned components.
 */

import type { HeatLevel } from './heatScale';
import { HEAT_VARS } from './heatScale';
import { daysUntil, solRiskVariant } from '../card/matter/matterFormatters';

/** The serif "case caption" stack — identical to the chat restyle's room-title stack. */
export const LEDGER_SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

/** Warm paper ground (light) / calm dense dark surface (dark — never inverted paper). */
export const LEDGER_PAPER = 'var(--mc-ledger-paper, #FAF7EE)';

/** The paper card face (#fffdf6 light / #1A2029 dark) — matches the chat message-card tint. */
export const LEDGER_CARD = 'var(--mc-ledger-card, #FFFDF6)';

/** The deeper warm card tint (#f2efe2 light / #182420 dark) — the chat "own message" tint. */
export const LEDGER_CARD_TINT = 'var(--mc-ledger-card-tint, #F2EFE2)';

/** Khaki rule (light) / slate rule (dark) — hairline borders + the "no data" heat color. */
export const LEDGER_RULE = 'var(--mc-ledger-rule, #C9BE9A)';

/** Green as the ACTION/accent color only (links, live counts) — theme-corrected contrast. */
export const LEDGER_ACCENT = 'var(--mc-ledger-accent, #15692A)';

/** Serif "case caption" heading style (matter names, section greetings). */
export const LEDGER_CAPTION_STYLE = {
	fontFamily: LEDGER_SERIF,
	fontWeight: 600,
	letterSpacing: '0.005em',
} as const;

/** Compact small-caps mono-ish label (column headers, stat labels, section eyebrows). */
export const LEDGER_LABEL_STYLE = {
	fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: '11px',
	fontWeight: 600,
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
} as const;

/** Dense tabular figures — every numeral column/row in the ledger language. */
export const LEDGER_NUMERIC_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * SOL heat — green >90d / amber ≤90d / red ≤30d (or passed). Thresholds come from the
 * Matter Workspace's own SOL math (matterFormatters SOL_WARNING_DAYS/SOL_DANGER_DAYS),
 * so My Day, Boards and the panel always agree.
 */
export type SolHeat = HeatLevel;

// The shared heat scale (lib/heatScale.ts), in its theme-following CSS-var flavor.
export const SOL_HEAT_COLORS: Record<SolHeat, string> = HEAT_VARS;

/** Heat for an ISO/Date SOL value; `undefined` when the matter has no SOL on file. */
export const solHeatForDate = (solDate?: string | Date): SolHeat | undefined => {
	const days = daysUntil(solDate);
	if (days === undefined) {
		return undefined;
	}
	const risk = solRiskVariant(days);
	if (risk === 'danger') {
		return 'red';
	}
	if (risk === 'warning') {
		return 'amber';
	}
	return 'green';
};

/** The heat color for a matter's SOL — khaki rule color when no SOL is on file. */
export const solHeatColor = (solDate?: string | Date): string => {
	const heat = solHeatForDate(solDate);
	return heat ? SOL_HEAT_COLORS[heat] : LEDGER_RULE;
};
