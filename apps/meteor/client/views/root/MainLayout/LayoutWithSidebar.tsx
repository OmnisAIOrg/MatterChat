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
import MobileTabBar from './MobileTabBar';
import { isExternalSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';
import OrgSwitcherProvider from './OrgSwitcherProvider';
import OrgSwitcherRail from './OrgSwitcherRail';
import NavBar from '../../../navbar';
import Sidebar from '../../../sidebar';
import NavigationRegion from '../../navigation';
import RoomsNavigationProvider from '../../navigation/providers/RoomsNavigationProvider';

const INVALID_ROOM_NAME_PREFIXES = ['#', '?'] as const;

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
			<Box
				bg='surface-light'
				id='rocket-chat'
				className={[embeddedLayout ? 'embedded-view' : undefined, 'menu-nav'].filter(Boolean).join(' ')}
			>
				<MainLayoutStyleTags />
				<OrgSwitcherProvider>
					<ShellBody removeSidenav={removeSidenav} currentRoutePath={currentRoutePath}>
						{children}
					</ShellBody>
					{/* MATTERCHAT: mobile-only bottom tab bar (renders null on desktop/embedded). Mounted
					    inside OrgSwitcherProvider so its Chats tab can act as the way back from an external
					    workspace; position:fixed, so DOM placement here has no layout effect. */}
					{!removeSidenav && <MobileTabBar />}
				</OrgSwitcherProvider>
			</Box>
		</>
	);
};

export default LayoutWithSidebar;
