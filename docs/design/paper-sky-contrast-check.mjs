/**
 * Paper & Sky — contrast and gamut checker
 * =========================================
 * Run:  node docs/design/paper-sky-contrast-check.mjs
 *
 * Every contrast number quoted in PAPER-AND-SKY-THEME.md comes from this file.
 * If you change a sky ramp or a glass material, re-run it and update the spec —
 * do not eyeball it. The theme puts white text on a background that MOVES, so
 * "looks fine on my screen" is not evidence.
 *
 * What it checks:
 *   1. Each sky ramp's brightest stop, which is the worst case for white text.
 *   2. White text against each glass material composited over that stop.
 *   3. Ink on paper, which should be constant across every sky state.
 *   4. (--rotate) the OKLCH hue-rotation experiment that produced the sage ramp,
 *      kept for provenance — see the "Deriving the green ramp" section.
 *
 * The rule it enforces: white body text needs a cumulative backdrop darkening of
 * >= ~45% over the sky. Clear glass LIGHTENS, so it is worse than bare sky.
 */

// ---------------------------------------------------------------- colour math

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (ch) => `#${ch.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const relLum = (hex) => {
	const [r, g, b] = channels(hex).map((c) => s2l(c / 255));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
	const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/** Composite a veil over a base. alpha > 0 darkens (black), alpha < 0 lightens (white). */
const veil = (hex, alpha) => {
	const over = alpha < 0 ? 255 : 0;
	const a = Math.abs(alpha);
	return toHex(channels(hex).map((c) => c * (1 - a) + over * a));
};

const verdict = (r) => (r >= 4.5 ? 'AA body' : r >= 3 ? 'AA large' : 'FAIL   ');

// ---------------------------------------------------------------- the system

const WHITE = '#FFFFFF';
const PAPER = '#FAF5EA';
const INK = '#2C2A21';

/** Four-stop vertical ramps at 0 / 38 / 74 / 100%. Stop 0 is the brightest. */
const SKIES = {
	'clear morning': ['#7AD397', '#2FA55E', '#14813F', '#0A5029'],
	'working day': ['#5FC182', '#1E9350', '#0B6E33', '#07411F'],
	'deadline dusk': ['#3E9E63', '#136B3B', '#0A4A26', '#052D16'],
	'night / focus': ['#12241A', '#0C1912', '#070E09', '#040705'],
};

/** Glass materials as their net veil over the sky. From the G1 spec sheet. */
const MATERIALS = {
	'bare sky': 0,
	'clear': -0.1, // fill W .08-.12 — LIGHTENS
	'frosted': 0.16, // gradient .24 -> .09 -> .15, dark side
	'smoked': 0.47, // dark gradient .42 -> .52
};

// ---------------------------------------------------------------- report

console.log('\nWhite text vs. the effective backdrop, at each sky\'s BRIGHTEST stop\n');
process.stdout.write('material'.padEnd(12));
for (const name of Object.keys(SKIES)) process.stdout.write(name.padEnd(24));
console.log();

let failures = 0;
for (const [material, alpha] of Object.entries(MATERIALS)) {
	process.stdout.write(material.padEnd(12));
	for (const ramp of Object.values(SKIES)) {
		const bg = veil(ramp[0], alpha);
		const r = contrast(WHITE, bg);
		if (material === 'smoked' && r < 4.5) failures++;
		process.stdout.write(`${bg} ${r.toFixed(1).padStart(4)}:1 ${verdict(r)}`.padEnd(24));
	}
	console.log();
}

const inkPaper = contrast(INK, PAPER);
console.log(`\nInk on paper — ${INK} on ${PAPER}: ${inkPaper.toFixed(1)}:1 ${verdict(inkPaper)}`);
console.log('  Constant in every sky state. This is why body copy is on paper.\n');

if (failures) {
	console.error(`FAIL: smoked glass dropped below AA in ${failures} sky state(s). White chrome text is unsafe.`);
	process.exit(1);
}
console.log('PASS: white chrome text clears AA on smoked glass in every sky state.');
console.log('      Clear and frosted are body-text-unsafe on bright skies, as designed.\n');

// ---------------------------------------------------------------- provenance

if (process.argv.includes('--rotate')) {
	const oklch = (hex) => {
		const [r, g, b] = channels(hex).map((c) => s2l(c / 255));
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
		const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
		const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
		const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
		const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
		return { L, C: Math.hypot(A, B) };
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
		return {
			hex: toHex(lin.map((v) => l2s(v) * 255)),
			clipped: lin.some((v) => l2s(v) < -0.002 || l2s(v) > 1.002),
		};
	};

	// The loader's shipped blue day ramp — CentralAuth / workspace-loader.
	const BLUE = ['#8FBCE0', '#4A84BC', '#1F5B92', '#0D3559'];
	console.log('Provenance — rotating the loader\'s blue ramp to green hue 149:\n');
	for (const boost of [1.0, 1.4, 1.8]) {
		const out = BLUE.map((hex) => {
			const { L, C } = oklch(hex);
			return fromOklch(L, C * boost, 149);
		});
		const clip = out.some((o) => o.clipped) ? '  ** clips sRGB **' : '';
		console.log(`  chroma x${boost.toFixed(1)}  ${out.map((o) => o.hex).join(' ')}${clip}`);
	}
	console.log('\n  x1.0 is in gamut but reads sage, not the design. Boosting to reach the');
	console.log('  mockups clips, and the clipped mid-stops go crude. Hence: hand-tuned.\n');
}
