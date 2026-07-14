import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { useRouter, useLayout, usePermission, useCurrentRoutePath, useUser } from '@rocket.chat/ui-contexts';
import type { ComponentProps, ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { UserMenu } from '../../../navbar/NavBarSettingsToolbar';

/**
 * AppLeftRail — the Slack-style thin vertical navigation rail (Wave 1).
 *
 * A 76px, always-dark, full-height column pinned to the FAR LEFT of the app shell
 * (left of the rooms Sidebar / `#sidebar-region`). It is purely ADDITIVE: the existing
 * horizontal top `NavBar` is kept as-is. Unlike the NavBar's icon-only `NavBarItem`s,
 * each rail entry is a Slack-style LABELED button — a 24px icon above an 11px label in a
 * generous 60px target — so the primary sections read clearly and align on one baseline.
 *
 *  • Workspace mark → red "M" badge (top)
 *  • Chats    → /home          (icon 'balloons')
 *  • Boards   → /boards        (icon 'squares' — 'kanban' is NOT in @rocket.chat/icons)
 *                              — gated by `boards-view`
 *  • Activity → /boards/inbox  (icon 'bell' — the Boards notifications inbox route)
 *  • Search   → focuses the existing NavBar search combobox (icon 'magnifier')
 *  • EvidenceHunt → evidencehunt://open (icon 'document-eye') — a REAL anchor so the
 *                   browser natively offers to open the EvidenceHunt desktop app.
 *
 * Bottom reuses the existing `UserMenu` (avatar + account menu) from the NavBar.
 *
 * The rail is intentionally always-dark (independent of the light/dark theme) — the
 * signature Slack/Discord "global nav is dark" treatment — so it reads as the app's
 * outermost chrome regardless of the content theme.
 */

const RAIL_WIDTH = 76;
const RAIL_BG = '#1b1d21';
const BRAND_RED = '#e1140a';

const railClass = css`
	width: ${RAIL_WIDTH}px;
	min-width: ${RAIL_WIDTH}px;
	height: 100%;
	z-index: 3;
	background-color: ${RAIL_BG};

	@media print {
		display: none;
	}
`;

const badgeClass = css`
	width: 42px;
	height: 42px;
	border-radius: 11px;
	background-color: ${BRAND_RED};
	color: #ffffff;
	font-size: 22px;
	font-weight: 600;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	user-select: none;
`;

const itemClass = css`
	width: 60px;
	border: 0;
	background: transparent;
	color: #9aa0a8;
	border-radius: 12px;
	padding-block: 9px 7px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 5px;
	cursor: pointer;
	font-family: inherit;
	transition:
		background-color 0.12s ease,
		color 0.12s ease;

	&:hover {
		background-color: rgba(255, 255, 255, 0.06);
		color: #ffffff;
	}

	&:focus-visible {
		outline: 2px solid ${BRAND_RED};
		outline-offset: 1px;
	}

	&[aria-current='page'] {
		background-color: #2a2d33;
		color: #ffffff;
	}

	.rail-label {
		font-size: 11px;
		line-height: 1;
	}
`;

const AppLeftRail = () => {
	const { t } = useTranslation();
	const router = useRouter();
	const user = useUser();
	const { sidebar, navbar } = useLayout();
	const currentRoute = useCurrentRoutePath();

	const canViewBoards = usePermission('boards-view');
	// Admins get a direct rail entry to /admin. This custom rail replaced the stock sidebar's
	// admin affordance, so without it an admin has no visible way into the admin area.
	const isAdmin = Boolean(user?.roles?.includes('admin'));

	// Active-section detection. `/boards/inbox` must win for Activity, so Boards
	// excludes the inbox sub-route to avoid both lighting up at once.
	const inboxActive = currentRoute?.includes('/boards/inbox');
	const boardsActive = currentRoute?.includes('/boards') && !inboxActive;
	const filesActive = Boolean(currentRoute?.includes('/litbox'));
	const chatActive = !currentRoute?.includes('/boards') && Boolean(currentRoute?.includes('/home') || currentRoute?.includes('/channel'));
	const adminActive = Boolean(currentRoute?.includes('/admin'));

	const handleChat = useStableCallback(() => {
		router.navigate('/home');
	});

	const handleBoards = useStableCallback(() => {
		router.navigate('/boards');
	});

	const handleFiles = useStableCallback(() => {
		router.navigate('/litbox');
	});

	const handleActivity = useStableCallback(() => {
		router.navigate('/boards/inbox');
	});

	const handleAdmin = useStableCallback(() => {
		router.navigate('/admin');
	});

	// Search has no global "open" action; the NavBar search is a focus-driven
	// combobox. `expandSearch` exists on mobile; on desktop we focus the existing
	// input (mirrors the $mod+K shortcut wired in NavBarSearch).
	const handleSearch = useStableCallback(() => {
		navbar.expandSearch?.();
		const searchInput = document.querySelector<HTMLInputElement>('[role="search"] input[role="combobox"]');
		if (searchInput) {
			searchInput.focus();
		} else {
			// Fallback: ensure the sidebar/search surface is visible.
			sidebar.expand?.();
		}
	});

	// EvidenceHunt deep link — a REAL anchor (not window.open) so desktop browsers
	// natively prompt "Open EvidenceHunt.app?" and tests can assert the href.
	const renderLinkItem = (icon: ComponentProps<typeof Icon>['name'], label: string, href: string): ReactElement => (
		<Box is='a' href={href} className={itemClass} title={label} aria-label={label} style={{ textDecoration: 'none' }}>
			<Icon name={icon} size='x24' />
			<Box is='span' className='rail-label'>
				{label}
			</Box>
		</Box>
	);

	const renderItem = (icon: ComponentProps<typeof Icon>['name'], label: string, onClick: () => void, active: boolean): ReactElement => (
		<Box
			is='button'
			type='button'
			className={itemClass}
			onClick={onClick}
			title={label}
			aria-label={label}
			aria-current={active ? 'page' : undefined}
		>
			<Icon name={icon} size='x24' />
			<Box is='span' className='rail-label'>
				{label}
			</Box>
		</Box>
	);

	return (
		<Box
			is='nav'
			aria-label={t('Navigation')}
			role='navigation'
			className={railClass}
			display='flex'
			flexDirection='column'
			alignItems='center'
			flexShrink={0}
			pbs={14}
			pbe={12}
		>
			<Box className={badgeClass} mbe={16}>
				M
			</Box>
			<Box display='flex' flexDirection='column' alignItems='center' flexGrow={1} style={{ gap: '4px' }}>
				{renderItem('balloons', t('Chats'), handleChat, chatActive)}
				{canViewBoards && renderItem('squares', t('Boards'), handleBoards, boardsActive)}
				<Box
					is='button'
					type='button'
					className={itemClass}
					onClick={handleFiles}
					title={t('Files', { defaultValue: 'Files' })}
					aria-label={t('Files', { defaultValue: 'Files' })}
					aria-current={filesActive ? 'page' : undefined}
				>
					{/* The LitBox brand wordmark, recolored ('Lit' white) so it reads on the dark rail. */}
					<Box display='flex' alignItems='center' justifyContent='center' style={{ height: '24px' }}>
						<svg width='52' height='13' viewBox='0 0 160 40' xmlns='http://www.w3.org/2000/svg' aria-hidden focusable='false'>
							<text x='0' y='30' fontFamily='Arial, Helvetica, sans-serif' fontSize='28' fontWeight='bold'>
								<tspan fill='#ffffff'>Lit</tspan>
								<tspan fill='#5b7cff'>Box</tspan>
							</text>
						</svg>
					</Box>
					<Box is='span' className='rail-label'>
						{t('Files', { defaultValue: 'Files' })}
					</Box>
				</Box>
				{canViewBoards && renderItem('bell', t('Activity'), handleActivity, Boolean(inboxActive))}
				{renderItem('magnifier', t('Search'), handleSearch, false)}
				{renderLinkItem('document-eye', t('EvidenceHunt'), 'evidencehunt://open')}
				{isAdmin && renderItem('cog', t('Admin', { defaultValue: 'Admin' }), handleAdmin, adminActive)}
			</Box>
			{user && (
				<Box display='flex' flexDirection='column' alignItems='center' mbs={8}>
					<UserMenu user={user} />
				</Box>
			)}
		</Box>
	);
};

export default memo(AppLeftRail);
