// What does white text ACTUALLY sit on in Stage 1?
// Chrome is glass, and glass darkens the sky behind it. Compute the effective
// backdrop and check white against WCAG AA.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const relLum = (hex) => {
	const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastWhite = (hex) => 1.05 / (relLum(hex) + 0.05);

// composite a black (or white) veil at `alpha` over a base colour
const veil = (hex, alpha, over = 0) => {
	const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	const out = ch.map((c) => Math.round(c * (1 - alpha) + over * alpha));
	return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

const verdict = (r) => (r >= 4.5 ? 'AA body' : r >= 3 ? 'AA large only' : 'FAIL');

// brightest stop of each sky = worst case for white text
const SKIES = {
	'clear morning (top)': '#97C39E',
	'working day  (top)': '#73A87C',
	'night/focus  (top)': '#112114',
};

// glass materials, as black-veil equivalents from the spec sheet
const MATERIALS = {
	'bare sky (no glass)': 0,
	'clear  (W .08–.12 fill)': -0.1, // negative = WHITE veil, lightens
	'frosted (grad .24→.09→.15)': 0.16, // mid of the gradient, dark side
	'smoked (dark grad .42→.52)': 0.47,
};

console.log('White text — contrast against the effective backdrop\n');
console.log('material'.padEnd(28), Object.keys(SKIES).map((s) => s.padEnd(22)).join(''));

for (const [mat, a] of Object.entries(MATERIALS)) {
	const row = Object.values(SKIES).map((sky) => {
		const bg = a < 0 ? veil(sky, -a, 255) : veil(sky, a, 0);
		const r = contrastWhite(bg);
		return `${bg} ${r.toFixed(1)}:1 ${verdict(r)}`.padEnd(22);
	});
	console.log(mat.padEnd(28), row.join(''));
}

console.log('\nInk on paper (#2C2A21 on #FAF5EA) — constant in every sky state:');
const ink = relLum('#2C2A21');
const paper = relLum('#FAF5EA');
const r = (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
console.log(`  ${r.toFixed(1)}:1  ${verdict(r)}`);
