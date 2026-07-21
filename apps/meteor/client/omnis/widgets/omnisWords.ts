/**
 * Word-of-the-Day source for the sidebar clock widget. Ships a curated list and rotates the
 * STARTING word by day-of-year so each day leads with a fresh "word of the day", then the widget
 * cycles through the rest. Fully self-contained (no backend dependency) — the standalone
 * word-of-day service can be swapped in later by pointing `<word-clock-widget>.words` at its API.
 */
export type OmnisWord = { word: string; pos: string; def: string };

const WORDS: OmnisWord[] = [
	{ word: 'Facetious', pos: 'adj.', def: 'Treating serious issues with deliberately inappropriate humor.' },
	{ word: 'Ephemeral', pos: 'adj.', def: 'Lasting for a very short time; fleeting.' },
	{ word: 'Sonder', pos: 'n.', def: 'The realization that each passerby has a life as vivid as your own.' },
	{ word: 'Petrichor', pos: 'n.', def: 'The pleasant, earthy smell after rain falls on dry ground.' },
	{ word: 'Limerence', pos: 'n.', def: 'The euphoric, all-consuming early state of being in love.' },
	{ word: 'Vellichor', pos: 'n.', def: 'The strange wistfulness of used bookstores.' },
	{ word: 'Perspicacious', pos: 'adj.', def: 'Having a ready insight into and understanding of things.' },
	{ word: 'Sanguine', pos: 'adj.', def: 'Optimistic or positive, especially in an apparently bad situation.' },
	{ word: 'Alacrity', pos: 'n.', def: 'Brisk and cheerful readiness.' },
	{ word: 'Equanimity', pos: 'n.', def: 'Calmness and composure, especially in a difficult situation.' },
	{ word: 'Ineffable', pos: 'adj.', def: 'Too great or extreme to be expressed in words.' },
	{ word: 'Mellifluous', pos: 'adj.', def: 'Sweet or musical; pleasant to hear.' },
	{ word: 'Serendipity', pos: 'n.', def: 'The occurrence of happy events by chance.' },
	{ word: 'Ubiquitous', pos: 'adj.', def: 'Present, appearing, or found everywhere.' },
	{ word: 'Quixotic', pos: 'adj.', def: 'Extremely idealistic; unrealistic and impractical.' },
	{ word: 'Ebullient', pos: 'adj.', def: 'Cheerful and full of energy.' },
	{ word: 'Halcyon', pos: 'adj.', def: 'Denoting a period of time that was idyllically happy and peaceful.' },
	{ word: 'Nadir', pos: 'n.', def: 'The lowest point in the fortunes of a person or organization.' },
	{ word: 'Panacea', pos: 'n.', def: 'A solution or remedy for all difficulties or diseases.' },
	{ word: 'Redolent', pos: 'adj.', def: 'Strongly reminiscent or suggestive of something.' },
	{ word: 'Susurrus', pos: 'n.', def: 'A whispering or rustling sound.' },
	{ word: 'Ineluctable', pos: 'adj.', def: 'Unable to be resisted or avoided; inescapable.' },
	{ word: 'Defenestrate', pos: 'v.', def: 'To throw someone or something out of a window.' },
	{ word: 'Cromulent', pos: 'adj.', def: 'Acceptable or adequate, if unremarkable.' },
	{ word: 'Numinous', pos: 'adj.', def: 'Having a strong religious or spiritual quality; awe-inspiring.' },
	{ word: 'Obstreperous', pos: 'adj.', def: 'Noisy and difficult to control.' },
	{ word: 'Pellucid', pos: 'adj.', def: 'Translucently clear; easily understood.' },
	{ word: 'Riparian', pos: 'adj.', def: 'Relating to or situated on the banks of a river.' },
	{ word: 'Zephyr', pos: 'n.', def: 'A soft, gentle breeze.' },
	{ word: 'Effulgent', pos: 'adj.', def: 'Shining brightly; radiant.' },
	{ word: 'Sagacious', pos: 'adj.', def: 'Having or showing keen mental discernment and good judgment.' },
	{ word: 'Tenebrous', pos: 'adj.', def: 'Dark; shadowy or obscure.' },
];

/** Days since the Unix epoch (UTC), stable per calendar day — the daily-rotation key. */
function dayIndex(): number {
	return Math.floor(Date.now() / 86_400_000);
}

/** The full list, rotated so today's word-of-the-day is first; the widget cycles through the rest. */
export function omnisWordsForToday(): OmnisWord[] {
	const start = dayIndex() % WORDS.length;
	return [...WORDS.slice(start), ...WORDS.slice(0, start)];
}
