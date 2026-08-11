import type { Skins } from '@rocket.chat/core-typings';
import { useSkin } from '@rocket.chat/ui-client';
import { useUser } from '@rocket.chat/ui-contexts';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * PaperSkyStyleTags — MatterChat's Paper & Sky theme (Stage 1: the shell).
 * ============================================================================
 *
 * The rule the whole system hangs on, lifted from the canonical stylesheet:
 *
 *     If you read it, it is PAPER. If it frames what you read, it is GLASS.
 *
 * Warm paper carries body copy. Glass is structure — rails, docks, fields — and
 * never holds body copy. Sky is the ground behind both, and it is state-driven
 * rather than decorative.
 *
 * That split is not only aesthetic. Glass is `backdrop-filter`, and every glass
 * surface becomes its own GPU compositing layer over a gradient that MOVES, so
 * nothing caches. Confining glass to the ~10 chrome elements is what keeps this
 * affordable; putting it on message rows would mean ~50 uncacheable blur layers
 * per scrolling room. Paper is opaque and costs nothing.
 *
 * It is also what keeps the theme accessible. White text is only safe on smoked
 * glass — measured, clear and frosted fail AA on the two bright skies, and clear
 * glass is worse than bare sky because it lightens. Ink on paper holds 13.2:1 in
 * every sky state. See `docs/design/PAPER-AND-SKY-THEME.md` and re-run
 * `docs/design/paper-sky-contrast-check.mjs` after touching a ramp or a material.
 *
 * PROVENANCE — do not re-derive these values from screenshots:
 *   LandingPage/styles/omnis-paper-sky.css        tokens, sky structure, materials
 *   Infrastructure/workspace-loader/.../auth-skin.css   the shipped sky cycle
 *   docs/design/PAPER-AND-SKY-THEME.md            the decisions and the numbers
 *
 * FORK DISCIPLINE: additive, in our own file, token-driven. No in-place edits to
 * Rocket.Chat core — everything here is a scoped style tag keyed on a `data-skin`
 * attribute, so it cannot affect any other theme.
 */

// ============================================================================
// SKY — four states per tint. Stop 0 is the brightest and is the worst case for
// white text. Green is hand-tuned to the comps; every other tint is that ramp
// rotated in OKLCH holding lightness and chroma, so contrast is inherited rather
// than re-audited. Regenerate with `node docs/design/paper-sky-tints.mjs`.
// ============================================================================

type SkyState = 'morning' | 'day' | 'dusk' | 'night';

const SKY: Record<Skins, Record<SkyState, [string, string, string, string]>> = {
	'paper-sky': {
		morning: ['#7AD397', '#2FA55E', '#14813F', '#0A5029'],
		day: ['#5FC182', '#1E9350', '#0B6E33', '#07411F'],
		dusk: ['#3E9E63', '#136B3B', '#0A4A26', '#052D16'],
		night: ['#12241A', '#0C1912', '#070E09', '#040705'],
	},
	'paper-sky-blue': {
		morning: ['#75C4FF', '#2593DF', '#0071B5', '#054670'],
		day: ['#5AB1F6', '#1282CA', '#00609C', '#02385C'],
		dusk: ['#398FCF', '#0F5E93', '#064168', '#042740'],
		night: ['#13212D', '#0D1720', '#070D12', '#040609'],
	},
	'paper-sky-indigo': {
		morning: ['#B4B1FF', '#847CE1', '#655DB7', '#3E3971'],
		day: ['#A19CF8', '#756DCC', '#564E9E', '#322E5D'],
		dusk: ['#817CD1', '#544F95', '#3A3569', '#221F41'],
		night: ['#1E1D2E', '#141420', '#0B0B12', '#060609'],
	},
	'paper-sky-amber': {
		morning: ['#EAB05C', '#BF7C00', '#995D00', '#5E3900'],
		day: ['#D99C3C', '#AC6C00', '#834E00', '#4D2E00'],
		dusk: ['#B47B14', '#7D4E00', '#573500', '#361F00'],
		night: ['#281D0E', '#1C1409', '#100B05', '#080603'],
	},
	'paper-sky-rose': {
		morning: ['#FF9BA3', '#D6616F', '#AC4452', '#6B2A32'],
		day: ['#F0858F', '#C15260', '#943844', '#582128'],
		dusk: ['#C9656F', '#8D3C45', '#63272E', '#3D161B'],
		night: ['#2D191B', '#1F1112', '#12090A', '#090505'],
	},
	'paper-sky-graphite': {
		morning: ['#B5BDC3', '#848E94', '#656D73', '#3E4347'],
		day: ['#A2ABB1', '#757D84', '#555D62', '#323639'],
		dusk: ['#82898F', '#545B5F', '#393E42', '#222527'],
		night: ['#1E2021', '#151617', '#0B0C0D', '#060606'],
	},
};

const SKY_STATES: SkyState[] = ['morning', 'day', 'dusk', 'night'];

const ramp = ([a, b, c, d]: [string, string, string, string]): string =>
	`linear-gradient(180deg, ${a} 0%, ${b} 38%, ${c} 74%, ${d} 100%)`;

/**
 * The living sky. The background is data, not decoration.
 *
 * Stage 1 derives from what is always on hand and cheap: the local clock and the
 * user's own status. `dusk` is reserved for the CasePro deadline signal (filing or
 * SOL inside 24h) and is not wired yet — the state exists, its ramps are defined,
 * and the only missing piece is the deadline source. Deliberately NOT faked off
 * the clock, so a dusk sky always means a real deadline once it lands.
 *
 * Polls on a 5-minute tick rather than a timer per state change: the transition is
 * a 2s cross-fade and nobody needs it to the second.
 */
const useSkyState = (): SkyState => {
	const user = useUser();
	const doNotDisturb = user?.status === 'busy';
	const [hour, setHour] = useState(() => new Date().getHours());

	useEffect(() => {
		const id = setInterval(() => setHour(new Date().getHours()), 5 * 60 * 1000);
		return () => clearInterval(id);
	}, []);

	if (doNotDisturb || hour < 7 || hour >= 19) {
		return 'night';
	}
	return hour < 12 ? 'morning' : 'day';
};

// ============================================================================
// MATERIALS + SHELL. Scoped under `body[data-skin]`, so nothing here can reach a
// user on light, dark, high-contrast or auto.
//
// `-webkit-backdrop-filter` is written by hand beside every `backdrop-filter`.
// These tags are injected at runtime and bypass PostCSS/autoprefixer entirely, so
// the browser sees exactly this. (LandingPage's rule is the OPPOSITE — Lightning
// CSS there collapses a hand-written pair down to the webkit form alone. Same
// design system, different pipeline. Getting it backwards fails silently: the
// background and border still paint, so it reads as a slightly-wrong tint.)
// ============================================================================

const SHELL_CSS = `
body[data-skin] {
	--ps-paper: #FAF5EA;
	--ps-paper-bright: #FFFDF6;
	--ps-rim: #FFFEFA;
	--ps-hairline: #E4D9C0;
	--ps-ink: #2C2A21;
	--ps-ink-quiet: #4A463A;
	--ps-ink-faint: #8A8471;
	--ps-on-sky: #FFFFFF;
	--ps-on-sky-2: rgba(255, 255, 255, 0.85);
	--ps-on-sky-3: rgba(255, 255, 255, 0.70);
	--ps-mint: #8FE3A5;
	--ps-lift: 0 1px 12px rgba(10, 40, 20, 0.35);
	--ps-radius: 22px;
}

/* THE WINDOW. The rounded floating shape is KEPT — near-black backdrop, 8px
   margin, 22px radius, drop shadow, the org rail outside it. What is removed is
   the inner bezel: Variant B pins #react-root 14px inside a green gradient card,
   so a band frames the app on all four sides. Here the sky reaches the corners.

   Everything else about the frame is inherited from MATTERCHAT_FRAME_CSS,
   including the mobile full-bleed branch below 767.98px.

   NEVER put transform, filter or mix-blend-mode on body or #react-root. body
   carrying no transform is the only reason fixed-position modals, menus and
   toasts escape the body clip instead of being trapped inside the rounded
   window. */
body[data-skin] {
	background: #080D0A !important;
}
body[data-skin] #react-root {
	inset: 0 !important;
	border-radius: var(--ps-radius) !important;
	background: transparent !important;
	box-shadow: none !important;
}
@media (max-width: 767.98px) {
	body[data-skin] #react-root {
		border-radius: 0 !important;
	}
}

/* The sky sits at the bottom of the window's stacking order; the app rides above
   it on transparent ground. */
body[data-skin] .ps-sky {
	position: absolute;
	inset: 0;
	z-index: 0;
	pointer-events: none;
	opacity: 0;
	transition: opacity 2s linear;
}
body[data-skin] .ps-sky[data-on='true'] {
	opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
	body[data-skin] .ps-sky {
		transition: none;
	}
}

body[data-skin] #rocket-chat,
body[data-skin] .rcx-content--main,
body[data-skin] .rcx-sidebar,
body[data-skin] .rcx-sidebar--main > *,
body[data-skin] main {
	background: transparent !important;
}
body[data-skin] #rocket-chat {
	position: relative;
	z-index: 1;
}

/* ---- MATERIALS ------------------------------------------------------------
   Smoked is the only material white body text is safe on. Clear and frosted are
   for icons, large type and surfaces that must stay legible-through. */

body[data-skin] .rcx-navbar,
body[data-skin] .rcx-sidebar--main,
body[data-skin] .rcx-sidepanel,
body[data-skin] .rcx-message-box {
	-webkit-backdrop-filter: blur(50px) saturate(180%);
	backdrop-filter: blur(50px) saturate(180%);
	background: rgba(0, 0, 0, 0.52) !important;
	border-color: rgba(255, 255, 255, 0.24) !important;
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

body[data-skin] .rcx-room-header {
	-webkit-backdrop-filter: blur(44px) saturate(185%);
	backdrop-filter: blur(44px) saturate(185%);
	background: linear-gradient(
		135deg,
		rgba(255, 255, 255, 0.24),
		rgba(255, 255, 255, 0.09) 52%,
		rgba(255, 255, 255, 0.15)
	) !important;
	border-color: rgba(255, 255, 255, 0.34) !important;
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

/* ---- TYPE ON SKY ----------------------------------------------------------
   White only. Hierarchy by weight and opacity, never by colour. */

body[data-skin] .rcx-navbar,
body[data-skin] .rcx-navbar *,
body[data-skin] .rcx-sidebar--main,
body[data-skin] .rcx-sidebar--main *,
body[data-skin] .rcx-sidepanel,
body[data-skin] .rcx-sidepanel *,
body[data-skin] .rcx-room-header,
body[data-skin] .rcx-room-header * {
	color: var(--ps-on-sky) !important;
	border-color: rgba(255, 255, 255, 0.18);
}
body[data-skin] .rcx-sidebar-item--clickable:hover {
	background: rgba(255, 255, 255, 0.16) !important;
}
body[data-skin] .rcx-sidebar-item--selected {
	background: rgba(255, 255, 255, 0.12) !important;
}

/* Room-list badges: white is unread, coral is a mention. */
body[data-skin] .rcx-badge {
	background: #ffffff !important;
	color: #0a2216 !important;
}
body[data-skin] .rcx-badge--danger,
body[data-skin] .rcx-badge--primary {
	background: #f0997b !important;
	color: #4a1b0c !important;
}

/* ---- PAPER ----------------------------------------------------------------
   Everything you read. Opaque, so it costs no compositing and holds 13.2:1 in
   every sky state. Stage 1 uses it for the surfaces the shell already owns;
   message rows arrive in Stage 2. */

body[data-skin] .ps-paper {
	background: var(--ps-paper);
	color: var(--ps-ink);
	border-radius: 14px;
	box-shadow: inset 0 1px 0 var(--ps-rim), 0 10px 26px -14px rgba(0, 0, 0, 0.55);
}
`;

/**
 * Applies `data-skin` to <body> and renders the sky layers into #react-root.
 *
 * The sky is portalled rather than rendered in place for one specific reason: it
 * must be absolutely positioned inside the rounded window so the window's
 * `overflow: hidden` clips it to the corners. `position: fixed` would escape that
 * clip and paint over the 8px margin, and rendering it inside #rocket-chat's flex
 * layout risks disturbing the app's height chain — the exact failure that
 * collapsed the shell to blank in an earlier redesign attempt.
 */
export const PaperSkyStyleTags = () => {
	const skin = useSkin();
	const state = useSkyState();
	const [root, setRoot] = useState<HTMLElement | null>(null);

	useEffect(() => {
		if (!skin) {
			return;
		}
		document.body.setAttribute('data-skin', skin);
		return () => document.body.removeAttribute('data-skin');
	}, [skin]);

	useEffect(() => setRoot(document.getElementById('react-root')), []);

	if (!skin) {
		return null;
	}

	const ramps = SKY[skin];

	return (
		<>
			{/* Static, theme-derived constant string — mirrors the RawText pattern used
			    by the other style tags in this directory. */}
			<style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />
			{root &&
				createPortal(
					<>
						{SKY_STATES.map((s) => (
							<div key={s} className='ps-sky' data-on={String(s === state)} style={{ background: ramp(ramps[s]) }} />
						))}
					</>,
					root,
				)}
		</>
	);
};

export default PaperSkyStyleTags;
