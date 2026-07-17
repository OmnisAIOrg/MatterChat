import type { ReactElement } from 'react';

import { LEDGER_MONO, useLedgerTones } from './ledgerTheme';
import type { LedgerTones } from './ledgerTheme';

/**
 * LedgerPageStyleTag — the shared ledger-dense TABLE/CARD skin for the Boards
 * list/report screens that render stock Fuselage tables and cards (Boards home,
 * Templates, Referrals, Marketing ROI, Intake reports, Source-to-settlement).
 *
 * The Wave 2 redesign skinned the depth screens (Caseload / Reports / Calendars)
 * with per-file ruled-table CSS (see matters/caseload/Caseload.tsx) — this tag
 * is the same treatment, hoisted so every remaining stock-white sibling reaches
 * parity without duplicating the block six times. STYLE-ONLY: scoped under the
 * `.mcLedgerPage` class that only those screens add; no behavior, endpoint, or
 * data flow is touched. Token values come from useLedgerTones (single source of
 * truth — do not drift from ledgerTheme.ts / MainLayoutStyleTags.tsx).
 *
 * `.rcx-table` / `.rcx-table__cell` / `.rcx-card` are stable Fuselage classes
 * (same reliance as BoardsChromeStyleTags — re-verify on a Fuselage upgrade).
 */
const buildLedgerPageCss = (t: LedgerTones): string => `
/* Tables read as one dense ruled-paper card: card face, khaki structure line,
   tight tabular cells, mono "docket stamp" column headers, quiet row hover. */
.mcLedgerPage .rcx-table {
	background: ${t.card};
	border: 1px solid ${t.stroke};
	border-radius: 6px;
}
.mcLedgerPage .rcx-table__cell {
	padding-block: 5px;
	padding-inline: 8px;
	font-variant-numeric: tabular-nums;
	border-block-end: 1px solid ${t.strokeSoft};
	background: transparent;
}
.mcLedgerPage thead .rcx-table__cell {
	font-family: ${LEDGER_MONO};
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: ${t.inkMuted};
	border-block-end: 1px solid ${t.stroke};
}
.mcLedgerPage tbody tr:hover .rcx-table__cell {
	background: ${t.cardAlt};
}

/* Fuselage Cards (the Boards-home board grid) — paper card face, hairline
   stroke instead of the stock floating shadow, denser padding. */
.mcLedgerPage .rcx-card {
	background: ${t.card};
	border: 1px solid ${t.strokeSoft};
	box-shadow: none;
	padding: 12px;
}
.mcLedgerPage .rcx-card:hover {
	border-color: ${t.stroke};
	background: ${t.cardAlt};
}
`;

/**
 * Static, theme-derived constant string (no user input) — same
 * dangerouslySetInnerHTML precedent as BoardsChromeStyleTags.
 */
export const LedgerPageStyleTag = (): ReactElement => {
	const tones = useLedgerTones();
	return <style dangerouslySetInnerHTML={{ __html: buildLedgerPageCss(tones) }} />;
};

export default LedgerPageStyleTag;
