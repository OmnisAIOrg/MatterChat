import type { Skins } from '@rocket.chat/core-typings';
import { useSkin } from '@rocket.chat/ui-client';
import { useUser } from '@rocket.chat/ui-contexts';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { CHAT_CSS, OVERLAYS_CSS, SHELL_CSS, SURFACES_CSS } from './paperSkyCss';

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

export const SKY: Record<Skins, Record<SkyState, [string, string, string, string]>> = {
	'paper-sky': {
		morning: ['#7AD397', '#2FA55E', '#14813F', '#0A5029'],
		day: ['#5FC182', '#1E9350', '#0B6E33', '#07411F'],
		dusk: ['#3E9E63', '#136B3B', '#0A4A26', '#052D16'],
		night: ['#2A5C40', '#1D4430', '#132F21', '#0B1D14'],
	},
	'paper-sky-blue': {
		morning: ['#7FC3FD', '#2593DF', '#0F71B1', '#054670'],
		day: ['#5AB1F6', '#1282CA', '#046098', '#02385C'],
		dusk: ['#398FCF', '#0F5E93', '#064168', '#042740'],
		night: ['#2B5475', '#1F3E57', '#152B3C', '#0C1A26'],
	},
	'paper-sky-indigo': {
		morning: ['#B5B2FF', '#847CE1', '#655DB7', '#3E3971'],
		day: ['#A19CF8', '#756DCC', '#564E9E', '#322E5D'],
		dusk: ['#817CD1', '#544F95', '#3A3569', '#221F41'],
		night: ['#4C4A76', '#383658', '#26253D', '#171726'],
	},
	'paper-sky-amber': {
		morning: ['#EAB05C', '#BA7F12', '#8F610F', '#5A3B05'],
		day: ['#D99C3C', '#A47012', '#7B5206', '#4A3002'],
		dusk: ['#B47B14', '#795001', '#533706', '#342001'],
		night: ['#674A1E', '#4C3615', '#35250E', '#211708'],
	},
	'paper-sky-rose': {
		morning: ['#FD9DA4', '#D6616F', '#AC4452', '#6B2A32'],
		day: ['#F0858F', '#C15260', '#943844', '#582128'],
		dusk: ['#C9656F', '#8D3C45', '#63272E', '#3D161B'],
		night: ['#723F43', '#552E31', '#3B1F22', '#251314'],
	},
	'paper-sky-graphite': {
		morning: ['#B5BDC3', '#848E94', '#656D73', '#3E4347'],
		day: ['#A2ABB1', '#757D84', '#555D62', '#323639'],
		dusk: ['#82898F', '#545B5F', '#393E42', '#222527'],
		night: ['#4D5154', '#383B3E', '#27292A', '#17191A'],
	},
};

const SKY_STATES: SkyState[] = ['morning', 'day', 'dusk', 'night'];

const ramp = ([a, b, c, d]: [string, string, string, string]): string => `linear-gradient(180deg, ${a} 0%, ${b} 38%, ${c} 74%, ${d} 100%)`;

/**
 * The living sky. The background is data, not decoration.
 *
 * THE BANDS ARE TUNED FOR A WORKING DAY, and getting this wrong is not cosmetic.
 * The first cut sent the sky to `night` from 19:00, and `night` was near-black —
 * so anyone opening the app on a normal working evening saw a black screen with
 * cream cards on it and reasonably concluded the theme had not loaded. A law firm
 * works past seven; the sky has to still look like a sky when they do.
 *
 *   05–11  morning   06–11 in practice; the "caught up" end of the day
 *   12–18  day       the default, and where most sessions live
 *   19–21  dusk      actual dusk — the light going, not an alarm
 *   22–04  night     genuinely late, or Do Not Disturb at any hour
 *
 * `dusk` therefore fires on the clock rather than never firing at all. When the
 * CasePro deadline signal lands (filing or SOL inside 24h) it should FORCE dusk
 * regardless of hour — the state is shared deliberately, because "the light is
 * going" and "time is running out" are the same feeling.
 *
 * Polls on a 5-minute tick rather than a timer per boundary: the transition is a
 * 2s cross-fade and nobody needs it to the second.
 */
const useSkyState = (): SkyState => {
	const user = useUser();
	// String-compared rather than against UserStatus.BUSY: `status` is a loose union here,
	// and importing the enum for one comparison drags a server-side typing into the client.
	const doNotDisturb = String(user?.status) === 'busy';
	const [hour, setHour] = useState(() => new Date().getHours());

	useEffect(() => {
		const id = setInterval(() => setHour(new Date().getHours()), 5 * 60 * 1000);
		return () => clearInterval(id);
	}, []);

	if (doNotDisturb || hour >= 22 || hour < 5) {
		return 'night';
	}
	if (hour >= 19) {
		return 'dusk';
	}
	return hour < 12 ? 'morning' : 'day';
};

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

	// The sky state is also a CSS hook: text that sits DIRECTLY on the sky (page
	// headings, empty states) cannot be one colour — white washes out on the two
	// bright states and ink drowns on night. `data-sky` lets the stylesheet flip
	// `--ps-header-ink` per state instead of hard-coding white.
	useEffect(() => {
		if (!skin) {
			return;
		}
		document.body.setAttribute('data-sky', state);
		return () => document.body.removeAttribute('data-sky');
	}, [skin, state]);

	useEffect(() => setRoot(document.getElementById('react-root')), []);

	if (!skin) {
		return null;
	}

	const ramps = SKY[skin];

	return (
		<>
			{/* Static constant strings — mirrors the RawText pattern used by the other
			    style tags in this directory. Order is the stage order, so a later stage
			    can refine an earlier one without a specificity bump. */}
			<style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />
			<style dangerouslySetInnerHTML={{ __html: CHAT_CSS }} />
			<style dangerouslySetInnerHTML={{ __html: SURFACES_CSS }} />
			<style dangerouslySetInnerHTML={{ __html: OVERLAYS_CSS }} />
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
