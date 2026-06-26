import { css } from '@rocket.chat/css-in-js';
import { Box, Throbber } from '@rocket.chat/fuselage';
import { FeaturePreview, FeaturePreviewOff, FeaturePreviewOn } from '@rocket.chat/ui-client';
import type { IRouterPaths } from '@rocket.chat/ui-contexts';
import { useLayout, useSetting, useCurrentRoutePath, useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement, ReactNode } from 'react';
import { Suspense, lazy, useEffect, useRef } from 'react';

import AccessibilityShortcut from './AccessibilityShortcut';
import AppLeftRail from './AppLeftRail';
import ExternalErrorBoundary from './ExternalErrorBoundary';
import MainContent from './MainContent';
import { MainLayoutStyleTags } from './MainLayoutStyleTags';
import { isExternalSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';
import OrgSwitcherProvider from './OrgSwitcherProvider';
import OrgSwitcherRail from './OrgSwitcherRail';
import NavBar from '../../../navbar';
import Sidebar from '../../../sidebar';
import NavigationRegion from '../../navigation';
import RoomsNavigationProvider from '../../navigation/providers/RoomsNavigationProvider';

const INVALID_ROOM_NAME_PREFIXES = ['#', '?'] as const;

/**
 * GREEN "Variant B" — the floating window in a green frame.
 *
 * `#rocket-chat` (the shell container: the two rails + Sidebar + MainContent) becomes the green,
 * top-lit, beveled FRAME, and a rounded, clipped WINDOW (`.mc-window`) is lifted inside it to hold the
 * existing shell. The frame is applied ONE LEVEL UP from ShellBody: `.mc-window` is a plain flex row
 * that replaces the old flex row `#rocket-chat` was; the OrgSwitcherProvider + ShellBody (and the lazy
 * external-workspace mode behind ExternalErrorBoundary) are untouched and still mount/scroll exactly as
 * before. The NavBar (the dark global bar) stays ABOVE the frame, full-bleed.
 *
 * HEIGHT CHAIN — why this version does NOT break the layout (a prior frame impl did):
 *  - `#rocket-chat` keeps its base.css role intact: `display:flex; flex:1 1 auto; height:100%;
 *    max-height:100%; overflow:hidden; align-items:stretch` (see app/theme/.../base.css). The frame
 *    class ONLY adds cosmetic `padding` + gradient + bevel — it never overrides the flex/height role,
 *    so the frame still fills the area below the NavBar exactly as the working no-frame shell did.
 *  - `.mc-window` fills the padded frame with `flex: 1 1 0` + `min-height: 0` + `min-width: 0` — NOT
 *    `height: 100%`. `height:100%` resolves against the frame's content box but, combined with the
 *    frame's `box-sizing:border-box` padding and `max-height:100%`, over-constrained the chain and
 *    collapsed everything after the first rail to zero height (the original bug). `flex:1 1 0` lets the
 *    window simply consume the remaining flex space; `min-height/min-width:0` lets its inner flex
 *    children (rails/sidebar/content) establish their own scroll containers instead of forcing the
 *    window to grow. Each region keeps `height:100%` of the window and scrolls independently.
 *
 * Verified in a real headless Chrome render (CDP, 1440×813): NavBar 48px full-bleed; frame 14px padding
 * on all four sides; ws-rail 62×737, nav-rail 92×737, sidebar 320×737 (scrolls), content 938×737
 * (scrolls) — every region non-zero + full-height. At a real 600px viewport the @media(width<=767px)
 * rule drops the padding + radius cleanly (frame off, content still non-zero). @media print drops it too.
 */
const FRAME_PAD = 14;

const frameClass = css`
	/*
	 * NOTE: do NOT set display/flex/height/max-height/overflow/align-items here — those come from the
	 * #rocket-chat base.css rule and are the WORKING height-chain. We only add cosmetic padding + paint.
	 */
	padding: ${FRAME_PAD}px;
	min-height: 0;
	background: radial-gradient(135% 115% at 50% -12%, #5fcb7a 0%, #2ba14c 52%, #1b7a2e 100%);
	box-shadow:
		inset 0 2px 1px rgba(255, 255, 255, 0.45),
		inset 0 -4px 10px rgba(10, 50, 24, 0.42);

	@media print {
		padding: 0;
		background: none;
		box-shadow: none;
	}

	/* On small screens the frame padding wastes space and fights the single-column layout — drop it. */
	@media (width <= 767px) {
		padding: 0;
		background: none;
		box-shadow: none;
	}
`;

const windowClass = css`
	/* Fill the padded frame WITHOUT height:100% (which over-constrained and collapsed the shell). */
	flex: 1 1 0;
	min-height: 0;
	min-width: 0;
	width: 100%;
	border-radius: 14px;
	overflow: hidden;
	display: flex;
	align-items: stretch;
	box-shadow:
		0 18px 40px rgba(8, 22, 12, 0.5),
		0 3px 10px rgba(8, 22, 12, 0.4),
		inset 0 1px 0 rgba(255, 255, 255, 0.06);

	@media print {
		border-radius: 0;
		box-shadow: none;
	}

	@media (width <= 767px) {
		border-radius: 0;
		box-shadow: none;
	}
`;

/**
 * The external-workspace view components are LAZY-loaded — they are NOT statically imported at this
 * module's top. This is a structural crash-guard: if any external-view file (or one of its transitive
 * imports) fails to load or has a bad import, the failure is confined to the lazy chunk and surfaces
 * as a Suspense/boundary event INSIDE the external branch — it can never break this module's graph and
 * take down the shell. The MatterChat (native) shell below imports zero external-view code, so it
 * renders fully independently. Provider-agnostic: the SAME two lazy components render Teams OR Google
 * Chat (they read the selected connection), so adding a provider added NO new top-level imports.
 */
const ExternalSidebar = lazy(() => import('./ExternalSidebar'));
const ExternalChannelView = lazy(() => import('./ExternalChannelView'));

/**
 * The external sidebar wrapped to occupy the sidebar region's width, so swapping it in for the
 * MatterChat sidebar keeps the shell layout identical (rail + sidebar + main).
 */
const ExternalSidebarRegion = (): ReactElement => (
	<Box position='relative' zIndex={2} display='flex' flexDirection='column' height='100%' width='var(--sidebar-width)' flexShrink={0}>
		<ExternalSidebar />
	</Box>
);

/**
 * Routes whose content stays NATIVE even while an external workspace is selected. Boards + LitBox (and
 * Admin) remain fully functional in external mode: clicking them in the slim rail routes here and
 * RENDERS the real page — the external channel-view must NOT hijack these routes, it only occupies the
 * content on the chat view. So when an external tile is selected AND the current route is one of these,
 * we render the routed `children` (not ExternalChannelView). The external sidebar is suppressed on
 * these routes (Boards/LitBox carry their own layout), matching native behavior.
 */
const isNativeContentRoute = (routePath: string | undefined): boolean =>
	Boolean(routePath && (routePath.startsWith('/boards') || routePath.startsWith('/litbox') || routePath.startsWith('/admin')));

/**
 * The inner shell, mounted INSIDE OrgSwitcherProvider so it can read the selected workspace. When a
 * connected EXTERNAL workspace is selected (Teams / Google Chat / Slack — selectedOrgId === `ext:<id>`)
 * AND the current route is the chat view, we render a self-contained workspace MODE: that connection's
 * channel/chat/people list IS the sidebar and the open channel/chat (messages + composer) IS the main
 * content. The MatterChat sidebar + room are not mounted at all — this resolves the founder's
 * "shouldn't be able to click any tab and go back to MatterChat" gripe (no half-overlay; the M tile /
 * Back is the way back). The branch is PROVIDER-AGNOSTIC: the same two lazy components render whichever
 * provider the selected connection is.
 *
 * Boards/LitBox/Admin stay functional in external mode: on those routes we render the routed `children`
 * (the real page) instead of the external channel-view, so the slim rail's Boards + LitBox tiles work.
 *
 * Crash-isolation in workspace mode:
 *  - The OrgSwitcherRail + AppLeftRail render OUTSIDE the boundary, so the way back to MatterChat (the
 *    M tile) survives even if the external subtree throws.
 *  - ExternalErrorBoundary wraps the external sidebar + channel view; a render error there shows a
 *    contained "Couldn't load this workspace" panel and NEVER reaches the app root.
 *  - Suspense covers the lazy chunk load with a Throbber.
 */
const ShellBody = ({
	children,
	removeSidenav,
	currentRoutePath,
}: {
	children: ReactNode;
	removeSidenav: boolean;
	currentRoutePath: string | undefined;
}): ReactElement => {
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const externalSelected = !removeSidenav && isExternalSelection(selectedOrgId);
	// On a native content route (Boards/LitBox/Admin) we keep the slim rail but render the routed page,
	// NOT the external channel-view — so those tiles stay fully functional inside the workspace.
	const showExternalContent = externalSelected && !isNativeContentRoute(currentRoutePath);

	if (externalSelected) {
		return (
			<>
				<OrgSwitcherRail />
				<AppLeftRail />
				{showExternalContent ? (
					<ExternalErrorBoundary onBack={(): void => setSelectedOrgId('current')}>
						<Suspense fallback={<Throbber />}>
							<ExternalSidebarRegion />
							<MainContent>
								<ExternalChannelView />
							</MainContent>
						</Suspense>
					</ExternalErrorBoundary>
				) : (
					// Boards / LitBox / Admin: render the real routed page. No MatterChat room sidebar (the
					// slim rail is the nav here), and the external view is intentionally not mounted.
					<MainContent>{children}</MainContent>
				)}
			</>
		);
	}

	return (
		<>
			{!removeSidenav && <OrgSwitcherRail />}
			{!removeSidenav && <AppLeftRail />}
			{!removeSidenav && (
				<FeaturePreview feature='secondarySidebar'>
					<FeaturePreviewOn>
						<RoomsNavigationProvider>
							<NavigationRegion />
						</RoomsNavigationProvider>
					</FeaturePreviewOn>
					<FeaturePreviewOff>
						<Sidebar />
					</FeaturePreviewOff>
				</FeaturePreview>
			)}
			<MainContent>{children}</MainContent>
		</>
	);
};

const LayoutWithSidebar = ({ children }: { children: ReactNode }) => {
	const { isEmbedded: embeddedLayout } = useLayout();

	const currentRoutePath = useCurrentRoutePath();
	const router = useRouter();
	const removeSidenav = embeddedLayout && !currentRoutePath?.startsWith('/admin');

	const firstChannelAfterLogin = useSetting<string>('First_Channel_After_Login', '');
	const roomName = (firstChannelAfterLogin.startsWith('#') ? firstChannelAfterLogin.slice(1) : firstChannelAfterLogin).trim();

	const redirected = useRef(false);

	useEffect(() => {
		const needToBeRedirect = currentRoutePath && ['/', '/home'].includes(currentRoutePath);

		if (!needToBeRedirect) {
			return;
		}

		if (!roomName) {
			return;
		}

		if (INVALID_ROOM_NAME_PREFIXES.some((prefix) => roomName.startsWith(prefix))) {
			// Because this will break url routing. Eg: /channel/#roomName and /channel/?roomName which will route to path /channel
			return;
		}

		if (redirected.current) {
			return;
		}
		redirected.current = true;

		router.navigate({ name: `/channel/${roomName}` as keyof IRouterPaths });
	}, [router, currentRoutePath, roomName]);

	return (
		<>
			<AccessibilityShortcut />
			{!embeddedLayout && <NavBar />}
			{/*
			  `#rocket-chat` now owns the green FRAME (was: a plain flex row on bg='surface-light'). Its old
			  flex-row children move one level down into `.mc-window` — the rounded, clipped, lifted window.
			  The OrgSwitcherProvider + ShellBody (and the lazy external-workspace mode behind
			  ExternalErrorBoundary) are unchanged; only their flex-row container moved. The frame class only
			  ADDS padding + gradient + bevel — #rocket-chat keeps its base.css flex/height role, so the
			  working height-chain is preserved (verified in a real browser; see frameClass/windowClass above).
			*/}
			<Box
				bg='surface-light'
				id='rocket-chat'
				className={[embeddedLayout ? 'embedded-view' : undefined, 'menu-nav', frameClass].filter(Boolean).join(' ')}
			>
				<MainLayoutStyleTags />
				<Box className={[windowClass, 'mc-window'].join(' ')}>
					<OrgSwitcherProvider>
						<ShellBody removeSidenav={removeSidenav} currentRoutePath={currentRoutePath}>
							{children}
						</ShellBody>
					</OrgSwitcherProvider>
				</Box>
			</Box>
		</>
	);
};

export default LayoutWithSidebar;
