// sRGB <-> OKLCH, to hue-rotate the shipped blue sky ramp into green
// while holding lightness (L) and chroma (C) exactly.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function hexToOklch(hex) {
	const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
	const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
	const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);

	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

	return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

function oklchToHex(L, C, hDeg) {
	const h = (hDeg * Math.PI) / 180;
	const A = C * Math.cos(h);
	const B = C * Math.sin(h);

	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

	const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	const clamp = (v) => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)));
	const [R, G, Bl] = [clamp(r), clamp(g), clamp(b)];
	// flag out-of-gamut before clamping swallowed it
	const clipped = [r, g, b].some((v) => linearToSrgb(v) < -0.002 || linearToSrgb(v) > 1.002);
	return {
		hex: `#${[R, G, Bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
		clipped,
	};
}

// relative luminance + contrast, to prove the ramp keeps its contrast profile
const relLum = (hex) => {
	const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastVsWhite = (hex) => (1.05 / (relLum(hex) + 0.05)).toFixed(2);

const BLUE_DAY = ['#8FBCE0', '#4A84BC', '#1F5B92', '#0D3559'];
const BLUE_DUSK = ['#6B9FCB', '#356F9F', '#194B78', '#0B2E4D'];
const BLUE_NIGHT = ['#0F1E2C', '#0A1520', '#050B11', '#03070B'];

const TARGET_HUE = 149; // green

for (const [name, ramp] of [
	['day    (clear morning)', BLUE_DAY],
	['dusk   (working day)  ', BLUE_DUSK],
	['night  (night/focus)  ', BLUE_NIGHT],
]) {
	const out = ramp.map((hex) => {
		const { L, C } = hexToOklch(hex);
		const { hex: green, clipped } = oklchToHex(L, C, TARGET_HUE);
		return { blue: hex, green, clipped, cwB: contrastVsWhite(hex), cwG: contrastVsWhite(green) };
	});
	console.log(`\n${name}`);
	for (const o of out) {
		console.log(
			`  ${o.blue} -> ${o.green}${o.clipped ? '  ** OUT OF GAMUT **' : ''}   contrast vs white: ${o.cwB} -> ${o.cwG}`,
		);
	}
	console.log(`  css: linear-gradient(180deg, ${out.map((o, i) => `${o.green} ${[0, 38, 74, 100][i]}%`).join(', ')})`);
}
