import { FocusScope } from '@react-aria/focus';
import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import { useLayout } from '@rocket.chat/ui-contexts';
import { memo } from 'react';

import Sidebar from './Sidebar';
import OrgSwitcherRail from '../views/root/MainLayout/OrgSwitcherRail';

const SidebarRegion = () => {
	const { sidebar, isMobile } = useLayout();

	const sidebarMobileClass = css`
		position: absolute;
		user-select: none;
		transform: translate3d(-100%, 0, 0);
		-webkit-tap-highlight-color: rgba(0, 0, 0, 0);
		-webkit-user-drag: none;
		touch-action: pan-y;
		will-change: transform;

		.rtl & {
			transform: translate3d(200%, 0, 0);

			&.opened {
				box-shadow: rgba(0, 0, 0, 0.3) 0px 0px 15px 1px;
				transform: translate3d(0px, 0px, 0px);
			}
		}
	`;

	const sideBarStyle = css`
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		height: 100%;
		user-select: none;
		transition: transform 0.3s;
		width: var(--sidebar-width);
		min-width: var(--sidebar-width);

		> .rcx-sidebar:not(:last-child) {
			visibility: hidden;
		}

		/*
		 * Overlap fix: when a feature (e.g. Boards) overlays its own sidebar into
		 * this region via SidebarPortal and signals it with sidebar.setOverlayed(true),
		 * the chat rooms list must be pulled out of the flex column entirely. The
		 * stock RC rule above only sets visibility:hidden, which keeps the chat
		 * sidebar occupying its flex slot — so the portalled (absolute) sidebar and
		 * the in-flow chat sidebar visually stacked. display:none removes it cleanly.
		 * (Descendant selector, not child — on mobile the chat sidebar sits inside
		 * the drawer-row wrapper next to the workspace rail.)
		 */
		&.is-overlayed .rcx-sidebar--main {
			display: none;
		}

		&.opened {
			box-shadow: rgba(0, 0, 0, 0.3) 0px 0px 15px 1px;
			transform: translate3d(0px, 0px, 0px);
		}

		/* // 768px to 1599px
		// using em unit base 16
		@media (max-width: 48em) {
			width: 80%;
			min-width: 80%;
		} */

		// 1600px to 1919px
		// using em unit base 16
		@media (min-width: 100em) {
			width: var(--sidebar-md-width);
			min-width: var(--sidebar-md-width);
		}

		// 1920px and up
		// using em unit base 16
		@media (min-width: 120em) {
			width: var(--sidebar-lg-width);
			min-width: var(--sidebar-lg-width);
		}
	`;

	const sidebarWrapStyle = css`
		position: absolute;
		z-index: 1;
		top: 0;
		left: 0;
		height: 100%;
		user-select: none;
		transition: opacity 0.3s;
		-webkit-tap-highlight-color: rgba(0, 0, 0, 0);
		touch-action: pan-y;
		-webkit-user-drag: none;

		&.opened {
			width: 100%;
			background-color: rgb(0, 0, 0);
			opacity: 0.8;
		}
	`;

	return (
		<FocusScope>
			<Box
				id='sidebar-region'
				className={[
					'rcx-sidebar',
					!sidebar.isCollapsed && sidebar.shouldToggle && 'opened',
					sidebar.overlayed && 'is-overlayed',
					sideBarStyle,
					sidebar.shouldToggle && sidebarMobileClass,
				].filter(Boolean)}
			>
				{/* MATTERCHAT mobile: Discord-style drawer — the workspace switcher rail (Slack orgs /
				    Teams / Google Chat tiles) rides INSIDE the drawer beside the room list, since both
				    desktop rails are hidden on phones and this is the only way to switch workspaces. */}
				{isMobile ? (
					<Box display='flex' height='100%' width='100%'>
						<OrgSwitcherRail inDrawer />
						<Box display='flex' flexDirection='column' height='100%' flexGrow={1} style={{ minWidth: 0 }}>
							<Sidebar />
						</Box>
					</Box>
				) : (
					<Sidebar />
				)}
			</Box>
			{sidebar.shouldToggle && (
				<Box className={[sidebarWrapStyle, !sidebar.isCollapsed && 'opened'].filter(Boolean)} onClick={() => sidebar.toggle()} />
			)}
		</FocusScope>
	);
};

export default memo(SidebarRegion);
