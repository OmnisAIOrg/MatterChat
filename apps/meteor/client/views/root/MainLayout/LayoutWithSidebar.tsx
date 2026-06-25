import { Box, Throbber } from '@rocket.chat/fuselage';
import { FeaturePreview, FeaturePreviewOff, FeaturePreviewOn } from '@rocket.chat/ui-client';
import type { IRouterPaths } from '@rocket.chat/ui-contexts';
import { useLayout, useSetting, useCurrentRoutePath, useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement, ReactNode } from 'react';
import { Suspense, lazy, useEffect, useRef } from 'react';

import AccessibilityShortcut from './AccessibilityShortcut';
import AppLeftRail from './AppLeftRail';
import MainContent from './MainContent';
import { MainLayoutStyleTags } from './MainLayoutStyleTags';
import { useOrgSwitcherSelection } from './OrgSwitcherContext';
import OrgSwitcherProvider from './OrgSwitcherProvider';
import OrgSwitcherRail from './OrgSwitcherRail';
import TeamsErrorBoundary from './TeamsErrorBoundary';
import NavBar from '../../../navbar';
import Sidebar from '../../../sidebar';
import NavigationRegion from '../../navigation';
import RoomsNavigationProvider from '../../navigation/providers/RoomsNavigationProvider';

const INVALID_ROOM_NAME_PREFIXES = ['#', '?'] as const;

/**
 * The Teams components are LAZY-loaded — they are NOT statically imported at this module's top. This
 * is a structural crash-guard: if any Teams file (or one of its transitive imports) fails to load or
 * has a bad import, the failure is confined to the lazy chunk and surfaces as a Suspense/boundary
 * event INSIDE the Teams branch — it can never break this module's graph and take down the shell.
 * The MatterChat (non-Teams) shell below imports zero Teams code, so it renders fully independently.
 */
const TeamsSidebar = lazy(() => import('./TeamsSidebar'));
const TeamsChannelView = lazy(() => import('./TeamsChannelView'));

/**
 * The Teams sidebar wrapped to occupy the sidebar region's width, so swapping it in for the
 * MatterChat sidebar keeps the shell layout identical (rail + sidebar + main).
 */
const TeamsSidebarRegion = (): ReactElement => (
	<Box position='relative' zIndex={2} display='flex' flexDirection='column' height='100%' width='var(--sidebar-width)' flexShrink={0}>
		<TeamsSidebar />
	</Box>
);

/**
 * The inner shell, mounted INSIDE OrgSwitcherProvider so it can read the selected workspace. When the
 * connected Teams workspace is selected we render a self-contained Teams MODE: the Teams channel list
 * IS the sidebar and the open channel (messages + composer) IS the main content. The MatterChat
 * sidebar + room are not mounted at all — this resolves the founder's "shouldn't be able to click any
 * tab and go back to MatterChat" gripe (no half-overlay; the M tile / Back is the way back).
 *
 * Crash-isolation in Teams mode:
 *  - The OrgSwitcherRail + AppLeftRail render OUTSIDE the boundary, so the way back to MatterChat (the
 *    M tile) survives even if the Teams subtree throws.
 *  - TeamsErrorBoundary wraps the Teams sidebar + channel view; a render error there shows a contained
 *    "Couldn't load the Teams view" panel and NEVER reaches the app root.
 *  - Suspense covers the lazy chunk load with a Throbber.
 */
const ShellBody = ({ children, removeSidenav }: { children: ReactNode; removeSidenav: boolean }): ReactElement => {
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const inTeamsMode = !removeSidenav && selectedOrgId === 'teams';

	if (inTeamsMode) {
		return (
			<>
				<OrgSwitcherRail />
				<AppLeftRail />
				<TeamsErrorBoundary onBack={(): void => setSelectedOrgId('current')}>
					<Suspense fallback={<Throbber />}>
						<TeamsSidebarRegion />
						<MainContent>
							<TeamsChannelView />
						</MainContent>
					</Suspense>
				</TeamsErrorBoundary>
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
