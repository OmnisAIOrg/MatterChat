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
 * The inner shell, mounted INSIDE OrgSwitcherProvider so it can read the selected workspace. When a
 * connected EXTERNAL workspace is selected (Teams OR Google Chat — selectedOrgId === `ext:<id>`) we
 * render a self-contained workspace MODE: that connection's channel/space list IS the sidebar and the
 * open channel (messages + composer) IS the main content. The MatterChat sidebar + room are not
 * mounted at all — this resolves the founder's "shouldn't be able to click any tab and go back to
 * MatterChat" gripe (no half-overlay; the M tile / Back is the way back). The branch is PROVIDER-
 * AGNOSTIC: the same two lazy components render whichever provider the selected connection is.
 *
 * Crash-isolation in workspace mode:
 *  - The OrgSwitcherRail + AppLeftRail render OUTSIDE the boundary, so the way back to MatterChat (the
 *    M tile) survives even if the external subtree throws.
 *  - ExternalErrorBoundary wraps the external sidebar + channel view; a render error there shows a
 *    contained "Couldn't load this workspace" panel and NEVER reaches the app root.
 *  - Suspense covers the lazy chunk load with a Throbber.
 */
const ShellBody = ({ children, removeSidenav }: { children: ReactNode; removeSidenav: boolean }): ReactElement => {
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const inExternalMode = !removeSidenav && isExternalSelection(selectedOrgId);

	if (inExternalMode) {
		return (
			<>
				<OrgSwitcherRail />
				<AppLeftRail />
				<ExternalErrorBoundary onBack={(): void => setSelectedOrgId('current')}>
					<Suspense fallback={<Throbber />}>
						<ExternalSidebarRegion />
						<MainContent>
							<ExternalChannelView />
						</MainContent>
					</Suspense>
				</ExternalErrorBoundary>
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
					<ShellBody removeSidenav={removeSidenav}>{children}</ShellBody>
				</OrgSwitcherProvider>
			</Box>
		</>
	);
};

export default LayoutWithSidebar;
