import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { useRouter, useLayout, usePermission, useCurrentRoutePath } from '@rocket.chat/ui-contexts';
import type { ComponentProps, ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isExternalSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';

/**
 * MobileTabBar — the Slack-mobile-style bottom navigation, MOBILE ONLY.
 *
 * On phones the desktop chrome (OrgSwitcherRail + AppLeftRail, 164px of always-dark columns)
 * would eat half the viewport, so both rails return null under the `md` breakpoint and THIS
 * bar carries the primary destinations instead — fixed to the bottom edge, above the iOS home
 * indicator via `env(safe-area-inset-bottom)`:
 *
 *  • My Day  → /home            (icon 'dashboard' — the command-center home)
 *  • Chats   → expands the room-list drawer (icon 'balloons'); RC's own mobile drawer
 *              (SidebarRegion slide-in + backdrop) does the rest. If the user is off the
 *              chat shell (e.g. deep in /boards) it routes /home first so the drawer has
 *              its region mounted.
 *  • Boards  → /boards          (icon 'squares' — gated by `boards-view`)
 *  • Activity→ /boards/inbox    (icon 'bell' — gated by `boards-view`)
 *  • Search  → expands the NavBar search combobox (icon 'magnifier')
 *
 * While a connected EXTERNAL workspace is selected, the Chats tab doubles as the "way back to
 * MatterChat" (mirrors the rail's M-tile contract): it re-selects the native workspace before
 * routing home.
 *
 * The component also owns the mobile-only GLOBAL style patch (rendered as a <style> tag only
 * when the bar is mounted, so desktop is untouched):
 *  - bottom padding on `#rocket-chat` so content/composer sit above the fixed bar,
 *  - safe-area top padding on the NavBar (standalone PWA draws under the iOS status bar),
 *  - a phone-sized room-list drawer width (240px desktop token → ~85vw sheet),
 *  - 16px form-control floor inside the message box so iOS stops auto-zooming the composer.
 */

// ---- shared chrome tokens (match AppLeftRail) ----
const BRAND_GREEN = '#1B7A2E';
const BRAND_GREEN_BRIGHT = '#22B43F';
const NAV_RAIL_BG = '#1A212C';
const NAV_RAIL_BORDER = '#2C3644';

export const MOBILE_TAB_BAR_HEIGHT = 58;

const barClass = css`
	position: fixed;
	inset-block-end: 0;
	inset-inline: 0;
	z-index: 30;
	display: flex;
	align-items: stretch;
	justify-content: space-around;
	height: calc(${MOBILE_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px));
	padding-block-end: env(safe-area-inset-bottom, 0px);
	background-color: ${NAV_RAIL_BG};
	border-block-start: 1px solid ${NAV_RAIL_BORDER};

	@media print {
		display: none;
	}
`;

const tabClass = css`
	flex: 1 1 0;
	min-width: 0;
	border: 0;
	background: transparent;
	color: #a4aebe;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 3px;
	cursor: pointer;
	font-family: inherit;
	-webkit-tap-highlight-color: transparent;
	transition: color 0.12s ease;

	&:active {
		color: #ffffff;
	}

	&:focus-visible {
		outline: 2px solid ${BRAND_GREEN_BRIGHT};
		outline-offset: -2px;
	}

	&[aria-current='page'] {
		color: ${BRAND_GREEN_BRIGHT};
	}

	.mobile-tab-label {
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
	}
`;

/**
 * Mobile-only global patches, active only while this bar is mounted. `env()` resolves to 0 in
 * regular browser tabs, so the safe-area terms are no-ops outside the installed PWA.
 */
const MOBILE_GLOBAL_STYLE = `
	#rocket-chat {
		padding-block-end: calc(${MOBILE_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px));
		--sidebar-width: min(85vw, 320px);
	}
	.rcx-navbar {
		padding-block-start: env(safe-area-inset-top, 0px);
	}
	.rc-message-box textarea,
	.rc-message-box [contenteditable='true'],
	.rcx-message-box textarea,
	.rcx-message-box [contenteditable='true'] {
		font-size: 16px;
	}
`;

const MobileTabBar = (): ReactElement | null => {
	const { t } = useTranslation();
	const router = useRouter();
	const { isMobile, isEmbedded, sidebar, navbar } = useLayout();
	const currentRoute = useCurrentRoutePath();
	const canViewBoards = usePermission('boards-view');

	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const inExternalMode = isExternalSelection(selectedOrgId);

	// Active-section detection mirrors AppLeftRail: /boards/inbox wins for Activity so both
	// never light at once; My Day is only active on /home with the drawer closed.
	const inboxActive = Boolean(currentRoute?.includes('/boards/inbox'));
	const boardsActive = Boolean(currentRoute?.includes('/boards')) && !inboxActive;
	const chatShellRoute = !currentRoute?.includes('/boards') && !currentRoute?.includes('/litbox') && !currentRoute?.includes('/admin');
	const chatsActive = chatShellRoute && (Boolean(currentRoute?.includes('/channel')) || !sidebar.isCollapsed);
	const myDayActive = chatShellRoute && !chatsActive && Boolean(currentRoute === '/home' || currentRoute === '/');

	const handleMyDay = useStableCallback(() => {
		if (inExternalMode) {
			setSelectedOrgId('current');
		}
		sidebar.collapse();
		router.navigate('/home');
	});

	const handleChats = useStableCallback(() => {
		if (inExternalMode) {
			setSelectedOrgId('current');
		}
		if (!chatShellRoute) {
			router.navigate('/home');
		}
		sidebar.expand();
	});

	const handleBoards = useStableCallback(() => {
		sidebar.collapse();
		router.navigate('/boards');
	});

	const handleActivity = useStableCallback(() => {
		sidebar.collapse();
		router.navigate('/boards/inbox');
	});

	const handleSearch = useStableCallback(() => {
		if (inExternalMode) {
			setSelectedOrgId('current');
		}
		sidebar.collapse();
		if (!chatShellRoute) {
			router.navigate('/home');
		}
		navbar.expandSearch?.();
	});

	// Desktop, embedded/iframe layouts, and printing keep their existing chrome.
	if (!isMobile || isEmbedded) {
		return null;
	}

	const renderTab = (icon: ComponentProps<typeof Icon>['name'], label: string, onClick: () => void, active: boolean): ReactElement => (
		<Box is='button' type='button' className={tabClass} onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}>
			<Icon name={icon} size='x24' />
			<Box is='span' className='mobile-tab-label'>
				{label}
			</Box>
		</Box>
	);

	return (
		<>
			<style>{MOBILE_GLOBAL_STYLE}</style>
			<Box is='nav' aria-label={t('Navigation')} className={barClass}>
				{renderTab('dashboard', t('My_Day', { defaultValue: 'My Day' }), handleMyDay, myDayActive)}
				{renderTab('balloons', t('Chats'), handleChats, chatsActive)}
				{canViewBoards && renderTab('squares', t('Boards'), handleBoards, boardsActive)}
				{canViewBoards && renderTab('bell', t('Activity'), handleActivity, inboxActive)}
				{renderTab('magnifier', t('Search'), handleSearch, false)}
			</Box>
		</>
	);
};

export default memo(MobileTabBar);
