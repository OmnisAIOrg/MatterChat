/**
 * Boards M8 — cross-pipeline reports client barrel.
 *
 * SourceToSettlement is the differentiators.md §7 closed-loop attribution
 * dashboard (leads → signed → settlement), gated by `boards-view-reports`.
 * It lives at its own route `/boards/reports/source-to-settlement`; the
 * matters/leads pipelines keep their own M5/M6 report routes.
 */
export { default as SourceToSettlement } from './SourceToSettlement';
