import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';

const DESKTOP_RELEASES_URL = 'https://github.com/OmnisAIOrg/MatterChat-Desktop-releases/releases/latest';

// True only in a normal browser — the desktop app exposes window.matterchatDesktop, so it hides its
// own "Get the desktop app" link.
const inDesktopApp = typeof window !== 'undefined' && Boolean((window as unknown as { matterchatDesktop?: unknown }).matterchatDesktop);

/**
 * The Omnis AI suite lockup — the SAME sign-off CasePro puts under its rails, reproduced here so the
 * two products sign the frame identically instead of drifting apart.
 *
 * CasePro's markup (CRM-Frontend `src/components/shell/CaseProShell.tsx`, the `railFooter` prop):
 *
 *     <span className='cp-suitemark'>
 *       <span className='cp-suitemark__label'>Powered by</span>
 *       <OmnisAiLockup />        // <img src='/logos/omnis-ai-brush-{white,dark}.png' height=26 />
 *     </span>
 *
 * Two things carry over verbatim and must NOT be "improved":
 *
 *  1. "Powered by" is the only TEXT. The rest of the phrase — "Omnis AI" — is inside the artwork,
 *     which is why this reads as one lockup rather than a caption plus a logo. Writing out
 *     "Powered by Omnis AI" as text next to the mark says it twice.
 *  2. The artwork is HEIGHT-scaled with `width: auto`. Both inks are cropped to the same 842x207
 *     bbox so they swap with no shift. Clamping max-width instead changes the ASPECT, not the
 *     scale — CasePro's own note records that squashing the mark twice.
 *
 * Everything is CENTERED in the footer's inline box (the founder's ask: "center it exactly like
 * CasePro has it"), replacing the old left-aligned underlined "Powered by Omnis AI" text link.
 */
const SUITEMARK_HEIGHT = 26;

/**
 * The LIGHT-ink artwork, unconditionally — NOT switched on the app theme.
 *
 * This footer lives inside `nav.rcx-sidebar--main`, and MainLayoutStyleTags pins that subtree to the
 * DARK palette with a hardcoded `<PaletteStyleTag theme='dark' selector='.rcx-sidebar--main, …'>`.
 * The room list is dark chrome in the light theme too. So keying the ink off useThemeMode() would
 * put the dark-ink lockup on a dark sidebar every time a user picked the light theme, and the
 * wordmark would disappear — the exact failure the old MatterChat PNG hit (see SidebarFooterDefault).
 *
 * Verified by rendering both inks on both surfaces: white.png reads on the chrome gradient, dark.png
 * vanishes into it. If this footer is ever moved OUT of the always-dark sidebar, this becomes a
 * theme-dependent choice again.
 */
const SUITEMARK_SRC = '/logos/omnis-ai-brush-white.png';

const suitemarkClass = css`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 5px;
	/* The lockup is a signature, not a control — it sits back from the UI it signs. */
	opacity: 0.85;
	transition: opacity 0.12s ease;

	&:hover {
		opacity: 1;
	}

	.mc-suitemark__label {
		font-size: 8px;
		font-weight: 700;
		/* Wide tracking is what makes an 8px eyebrow legible; it is the whole look. */
		letter-spacing: 0.18em;
		line-height: 1;
		text-transform: uppercase;
		color: var(--rcx-color-font-hint, #9ea2a8);
	}

	.mc-suitemark__mark {
		height: ${SUITEMARK_HEIGHT}px;
		width: auto;
		display: block;
	}
`;

// MatterChat is white-labeled under the OmnisAI house brand: the sidebar footer always shows the
// Omnis AI suite lockup (no Rocket.Chat link / license watermark), plus a "Get the desktop app"
// link so anyone on the web can download the installer (macOS / Windows / Linux).
export const SidebarFooterWatermark = () => {
	return (
		<Box pi={16} pbs={12} pbe={8}>
			{!inDesktopApp && (
				<Box
					is='a'
					href={DESKTOP_RELEASES_URL}
					target='_blank'
					rel='noopener noreferrer'
					title='Download the MatterChat desktop app (macOS, Windows, Linux)'
					display='flex'
					alignItems='center'
					justifyContent='center'
					pbe={8}
				>
					<Icon name='download' size='x14' color='hint' mie={4} />
					<Box fontScale='micro' color='hint'>
						Get the desktop app
					</Box>
				</Box>
			)}
			<Box
				is='a'
				href='https://omnisai.io'
				target='_blank'
				rel='noopener noreferrer'
				title='Powered by Omnis AI'
				className={suitemarkClass}
				pbe={4}
			>
				<Box is='span' className='mc-suitemark__label'>
					Powered by
				</Box>
				{/* A native <img>, not <Box is='img'>: Fuselage silently DROPS an explicit height on
				    Box (the defect that oversized the old wordmark), and height is the only dimension
				    this artwork may be scaled by. */}
				<img className='mc-suitemark__mark' src={SUITEMARK_SRC} alt='Omnis AI' />
			</Box>
		</Box>
	);
};
