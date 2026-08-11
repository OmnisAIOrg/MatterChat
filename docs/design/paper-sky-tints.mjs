/**
 * Paper & Sky — tint family generator
 * ====================================
 * Run:  node docs/design/paper-sky-tints.mjs
 *
 * The tint system from the G1 sheet (Green / Blue / Indigo / Amber / Rosé /
 * Graphite) is produced by rotating the hand-tuned GREEN ramps in OKLCH while
 * holding lightness and chroma. Holding L is what makes this cheap: contrast is
 * a function of luminance, so every tint inherits green's already-validated
 * numbers instead of needing its own audit.
 *
 * What it reports per tint:
 *   - the four sky ramps, ready to paste as CSS custom properties
 *   - sRGB gamut clipping (some hues cannot hold green's chroma)
 *   - white-on-smoked contrast at each sky's brightest stop, the worst case
 *
 * A tint that clips is not automatically rejected — it means the emitted hexes
 * are no longer exactly what OKLCH asked for, so it wants a designer's eye
 * before shipping. A tint that drops below AA is rejected outright.
 */

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const chan = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (ch) => `#${ch.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const oklch = (hex) => {
	const [r, g, b] = chan(hex).map((c) => s2l(c / 255));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
};

const fromOklch = (L, C, hDeg) => {
	const h = (hDeg * Math.PI) / 180;
	const A = C * Math.cos(h);
	const B = C * Math.sin(h);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	return { hex: toHex(lin.map((v) => l2s(v) * 255)), clipped: lin.some((v) => l2s(v) < -0.002 || l2s(v) > 1.002) };
};

const relLum = (hex) => {
	const [r, g, b] = chan(hex).map((c) => s2l(c / 255));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const veil = (hex, a) => toHex(chan(hex).map((c) => c * (1 - a)));
const cw = (hex) => 1.05 / (relLum(hex) + 0.05);

/** The shipped green, hand-tuned to the comps. Every other tint derives from it. */
const GREEN = {
	'clear morning': ['#7AD397', '#2FA55E', '#14813F', '#0A5029'],
	'working day': ['#5FC182', '#1E9350', '#0B6E33', '#07411F'],
	'deadline dusk': ['#3E9E63', '#136B3B', '#0A4A26', '#052D16'],
	'night / focus': ['#12241A', '#0C1912', '#070E09', '#040705'],
};

/** hue in OKLCH degrees; chromaScale trims saturation (graphite goes near-neutral) */
const TINTS = [
	{ name: 'Green', hue: null, chromaScale: 1, note: 'MatterChat default — shipped, hand-tuned' },
	{ name: 'Blue', hue: 245, chromaScale: 1, note: 'matches the loader / CentralAuth sky' },
	{ name: 'Indigo', hue: 285, chromaScale: 1, note: '' },
	{ name: 'Amber', hue: 75, chromaScale: 1, note: '' },
	{ name: 'Rosé', hue: 15, chromaScale: 1, note: '' },
	{ name: 'Graphite', hue: 240, chromaScale: 0.1, note: 'near-neutral; the quiet option' },
];

const SMOKED = 0.52; // sidebar panel, pinned to the dark end of the smoked range

let rejected = 0;
for (const tint of TINTS) {
	const lines = [];
	let clips = 0;
	let worst = Infinity;

	for (const [state, ramp] of Object.entries(GREEN)) {
		const out = ramp.map((hex) => {
			if (tint.hue === null) return { hex, clipped: false };
			const { L, C } = oklch(hex);
			return fromOklch(L, C * tint.chromaScale, tint.hue);
		});
		if (out.some((o) => o.clipped)) clips++;
		const r = cw(veil(out[0].hex, SMOKED));
		worst = Math.min(worst, r);
		lines.push(`    ${state.padEnd(15)} ${out.map((o) => o.hex).join(' ')}   ${r.toFixed(1)}:1`);
	}

	const pass = worst >= 4.5;
	if (!pass) rejected++;
	const flags = [clips ? `${clips}/4 states clip sRGB — wants a designer pass` : 'in gamut', pass ? 'AA everywhere' : `FAILS AA (worst ${worst.toFixed(1)}:1)`];

	console.log(`\n${tint.name}${tint.note ? '  — ' + tint.note : ''}`);
	console.log(`  ${flags.join(' · ')}`);
	console.log(lines.join('\n'));
}

console.log(
	`\n${TINTS.length} tints · ${TINTS.length - rejected} clear AA on smoked glass in every sky state.`,
);
console.log('Contrast is inherited: rotating hue holds lightness, and contrast follows luminance.\n');
if (rejected) process.exit(1);
