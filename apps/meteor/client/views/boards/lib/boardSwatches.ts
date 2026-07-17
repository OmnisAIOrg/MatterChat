/**
 * boardSwatches — the ONE curated accent palette for user-pickable colors on
 * boards (card labels + list/column accents; the two pickers must never drift).
 *
 * Derived from the MatterChat brand scale, not the stock Rocket.Chat set (RC
 * blue #1d74f5 / mint #2de0a5 read foreign on the warm-paper ledger surfaces):
 * green is the brand green itself, red/orange are the shared heat red/amber
 * (lib/heatScale.ts), and the rest are muted warm-compatible inks with enough
 * hue spread to keep labels distinguishable. All values are deep enough for
 * the white chip text the label pills render (≈4:1 or better — the old
 * #f3be08 yellow was ~1.6:1).
 *
 * Values are raw CSS hex strings persisted server-side (label.color /
 * list.color), so a palette change only affects NEW picks — existing stored
 * colors keep rendering as saved.
 */

import { HEAT_LIGHT } from './heatScale';

export type BoardSwatch = { id: string; value: string; label: string };

export const BOARD_ACCENT_SWATCHES: BoardSwatch[] = [
	{ id: 'green', value: HEAT_LIGHT.green, label: 'Green' }, // brand green — the anchor
	{ id: 'red', value: HEAT_LIGHT.red, label: 'Red' }, // docket red (heat red)
	{ id: 'orange', value: HEAT_LIGHT.amber, label: 'Orange' }, // warm amber (heat amber)
	{ id: 'yellow', value: '#9C7A10', label: 'Yellow' }, // warm gold ochre
	{ id: 'blue', value: '#2A5D8F', label: 'Blue' }, // muted slate blue
	{ id: 'purple', value: '#5E4B8B', label: 'Purple' }, // muted plum
	{ id: 'gray', value: '#6E6852', label: 'Gray' }, // warm ink gray
];
