import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import {
	useRouter,
	useLayout,
	usePermission,
	useCurrentRoutePath,
	useUser,
	useEndpoint,
	useSession,
	useUserSubscriptions,
} from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps, ReactElement } from 'react';
import { memo, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isExternalSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';
import EnsoMark from '../../../components/EnsoMark';
import { UNREAD_PULSE_BADGE_CLASS } from '../../../components/unreadPulseBadge';
import { useGoToRoom } from '../../room/hooks/useGoToRoom';
import { NOTIFICATIONS_UNREAD_KEY } from '../../boards/notifications/NotificationsInbox';
import { getUnseenUpdates } from '../../../updates/updatesFeed';

/**
 * AppLeftRail — the GREEN "Variant B" primary NAVIGATION rail (was the single Slack-style rail).
 *
 * An 88px, always-dark, full-height column pinned to the LEFT of the app shell, immediately RIGHT of
 * the OrgSwitcherRail (the workspace switcher). This is the redesign's second of two rails: it carries
 * the MatterChat mark, a "MENU" section label, then the primary destinations as labeled buttons
 * (24px icon over a label). It is purely ADDITIVE to the existing horizontal top `NavBar`.
 *
 *  • MatterChat mark → "Matter" + bright-green "Chat" wordmark (top)
 *  • Chats    → /home          (icon 'balloons')
 *  • Boards   → /boards        (icon 'squares' — 'kanban' is NOT in @rocket.chat/icons)
 *                              — gated by `boards-view`
 *  • Files    → /litbox        (the LitBox wordmark, recolored for the dark rail)
 *  • Activity → /boards/inbox  (icon 'bell' — the Boards notifications inbox route)
 *  • Search   → focuses the existing NavBar search combobox (icon 'magnifier')
 *  • Admin    → /admin         (icon 'cog' — admins only)
 *
 * Bottom anchors the ambient ensō brand mark (the account menu lives in the NavBar avatar) — (not in the
 * workspace rail) so the account-menu mount that already works is preserved.
 *
 * The rail is intentionally always-dark (independent of the light/dark theme) — the signature
 * "global nav is dark" treatment — so it reads as the app's outermost chrome regardless of the
 * content theme. The active item is a GREEN PILL (#1B7A2E); the brand color replaced the old red.
 */

// ---- GREEN brand tokens (shared with the OrgSwitcherRail + the LayoutWithSidebar frame) ----
const BRAND_GREEN = '#1B7A2E';
const BRAND_GREEN_BRIGHT = '#22B43F';
const ACCENT_RING = 'rgba(27,122,46,0.5)';
// The MatterChat wordmark keeps its ORIGINAL red — the green redesign recolors the theme
// (pill, rails, accents) but the brand name itself stays red. LitBox keeps its own original blue.
const MATTERCHAT_RED = '#e1140a';

// Positioning shell for the ensō's unread badge — the red + white + pulse treatment itself
// comes from the SHARED UNREAD_PULSE_BADGE_CLASS (one definition with the room-list badges).
const ensoUnreadBadgeClass = css`
	position: absolute;
	top: 2px;
	right: 16px;
	z-index: 2;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	border-radius: 9px;
	font-size: 10.5px;
	line-height: 18px;
	text-align: center;
	pointer-events: none;
`;

const RAIL_WIDTH = 88;
const NAV_RAIL_BG = '#1A212C';
const NAV_RAIL_BORDER = '#2C3644';
const WS_RAIL_BG = '#0C0F14';

const railClass = css`
	width: ${RAIL_WIDTH}px;
	min-width: ${RAIL_WIDTH}px;
	height: 100%;
	z-index: 3;
	background-color: ${NAV_RAIL_BG};
	border-right: 1px solid ${NAV_RAIL_BORDER};
	box-shadow: inset -1px 0 0 ${WS_RAIL_BG};
	overflow-y: auto;
	/* NEVER scrolls sideways — the rail is a fixed column. (The ensō mount's glow can paint wider
	   than its box; without this the rail becomes horizontally draggable.) */
	overflow-x: hidden;

	@media print {
		display: none;
	}
`;

const brandClass = css`
	font-size: 13px;
	font-weight: 800;
	letter-spacing: 0.2px;
	color: #d2dae6;
	padding-block-end: 12px;
`;

const sectionLabelClass = css`
	font-size: 9px;
	font-weight: 800;
	letter-spacing: 1.5px;
	color: #6b7585;
	padding-block-end: 9px;
`;

const dividerClass = css`
	width: 60px;
	height: 1px;
	background-color: #323c4a;
	margin-block: 12px;
`;

const itemClass = css`
	width: 64px;
	border: 0;
	background: transparent;
	color: #a4aebe;
	border-radius: 11px;
	padding-block: 8px 7px;
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
		outline: 2px solid ${BRAND_GREEN_BRIGHT};
		outline-offset: 1px;
	}

	&[aria-current='page'] {
		background-color: ${BRAND_GREEN};
		color: #ffffff;
		box-shadow: 0 1px 4px ${ACCENT_RING};
	}

	.rail-label {
		font-size: 10.5px;
		font-weight: 600;
		line-height: 1;
	}
`;

/**
 * The Activity unread badge — a dense count chip overlaid on the bell icon's top-right corner.
 * Absolutely positioned (zero layout shift), pointer-events off so clicks fall through to the
 * rail button. Bright brand green with a thin rail-colored ring so it reads on both the resting
 * dark rail and the active green pill.
 */
const activityBadgeClass = css`
	position: absolute;
	top: -4px;
	inset-inline-end: -8px;
	min-width: 15px;
	height: 15px;
	padding-inline: 3px;
	border-radius: 8px;
	background-color: ${BRAND_GREEN_BRIGHT};
	color: #ffffff;
	font-size: 9px;
	font-weight: 800;
	line-height: 15px;
	text-align: center;
	letter-spacing: 0;
	pointer-events: none;
	box-shadow: 0 0 0 1.5px ${NAV_RAIL_BG};
`;

/**
 * The Updates "NEW" badge — a small indicator for unseen updates.
 * Positioned on the icon, similar to activity badge but simpler (no count).
 */
const updatesBadgeClass = css`
	position: absolute;
	top: -2px;
	inset-inline-end: -2px;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: ${BRAND_GREEN_BRIGHT};
	pointer-events: none;
	box-shadow: 0 0 0 1.5px ${NAV_RAIL_BG};
`;

// Same cheap-badge cadence the removed NavBar bell used (PR #53 dedup): poll the
// unreadCount endpoint every 60s + on window focus.
const UNREAD_POLL_MS = 60 * 1000;
const UPDATES_LAST_SEEN_KEY = 'matterchat:updates:lastSeen';

const AppLeftRail = () => {
	const { t } = useTranslation();
	const router = useRouter();
	const user = useUser();
	const { sidebar, navbar, isMobile } = useLayout();
	const currentRoute = useCurrentRoutePath();
	const [hasUnseenUpdates, setHasUnseenUpdates] = useState(false);

	// Total-unread state for the ensō badge — the SAME session key the favicon/title badge uses
	// (kept by useUnread: a number, '999+', '•' = alert-only, or '' = none).
	const unreadSession = useSession('unread') as string | number | null | undefined;
	const unreadLabel = typeof unreadSession === 'number' ? String(unreadSession) : unreadSession && unreadSession !== '•' ? unreadSession : '';
	const hasUnread = Boolean(unreadLabel) || unreadSession === '•';
	// The unread rooms themselves (same filter as useUnread) — clicking the ensō jumps to the
	// most recent one.
	const unreadSubs = useUserSubscriptions(
		useMemo(() => ({ 'open': { $ne: false }, 'hideUnreadStatus': { $ne: true }, 'archived': { $ne: true }, '$or': [{ alert: true }, { unread: { $gt: 0 } }] }), []),
		useMemo(() => ({ fields: { rid: 1, t: 1, unread: 1, alert: 1, lm: 1 } }), []),
	);
	const goToRoom = useGoToRoom();
	const handleEnsoClick = useStableCallback(() => {
		const next = [...(unreadSubs ?? [])].sort((a, b) => new Date(b.lm ?? 0).getTime() - new Date(a.lm ?? 0).getTime())[0];
		if (next) {
			void goToRoom(next.rid);
			return;
		}
		router.navigate('/home');
	});

	const canViewBoards = usePermission('boards-view');
	// Admins get a direct rail entry to /admin. This custom rail replaced the stock sidebar's
	// admin affordance, so without it an admin has no visible way into the admin area.
	const isAdmin = Boolean(user?.roles?.includes('admin'));

	// While a connected external workspace is selected, the rail goes SLIM: it shows only the M tile
	// (back to MatterChat), Boards and LitBox — the three things that stay meaningful inside a foreign
	// workspace. Chats/Activity/Search/Admin are MatterChat-native and would yank you out of the
	// workspace, so they're hidden until you're back on MatterChat. Read defensively: the default
	// context returns 'current', so this is false in standalone/native mode.
	const { selectedOrgId } = useOrgSwitcherSelection();
	const inExternalMode = isExternalSelection(selectedOrgId);

	// Activity unread badge. This is the SAME source the removed NavBar bell polled
	// (GET /v1/boards.notifications.unreadCount under NOTIFICATIONS_UNREAD_KEY), so the
	// inbox's mark-read invalidations keep this badge in sync. Gated on permission +
	// native mode so hidden rail items never poll. Degrades to 0 on any error.
	const getUnreadCount = useEndpoint('GET', '/v1/boards.notifications.unreadCount');
	const { data: unreadData } = useQuery({
		queryKey: NOTIFICATIONS_UNREAD_KEY,
		queryFn: () => getUnreadCount({}),
		enabled: canViewBoards && !inExternalMode,
		refetchInterval: UNREAD_POLL_MS,
		refetchOnWindowFocus: true,
	});
	const activityUnread = unreadData?.unread ?? 0;

	// Check for unseen updates badge
	useEffect(() => {
		const lastSeen = localStorage.getItem(UPDATES_LAST_SEEN_KEY);
		const unseen = getUnseenUpdates(lastSeen);
		setHasUnseenUpdates(unseen.length > 0);
	}, []);

	// Active-section detection. `/boards/inbox` must win for Activity, so Boards
	// excludes the inbox sub-route to avoid both lighting up at once.
	const inboxActive = currentRoute?.includes('/boards/inbox');
	const boardsActive = currentRoute?.includes('/boards') && !inboxActive;
	const docsActive = Boolean(currentRoute?.includes('/docs'));
	const filesActive = Boolean(currentRoute?.includes('/litbox'));
	const chatActive = !currentRoute?.includes('/boards') && Boolean(currentRoute?.includes('/home') || currentRoute?.includes('/channel'));
	const adminActive = Boolean(currentRoute?.includes('/admin'));
	const updatesActive = Boolean(currentRoute?.includes('/updates'));

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

	const handleDocs = useStableCallback(() => {
		router.navigate('/docs');
	});

	const handleUpdates = useStableCallback(() => {
		router.navigate('/updates');
		// Clear the unseen badge when navigating to updates
		setHasUnseenUpdates(false);
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

	// MATTERCHAT: on phones the MobileTabBar carries the primary nav; this 88px column would eat a
	// quarter of the viewport. Early-return AFTER all hooks (rules of hooks).
	if (isMobile) {
		return null;
	}

	const renderItem = (
		icon: ComponentProps<typeof Icon>['name'],
		label: string,
		onClick: () => void,
		active: boolean,
		badgeCount = 0,
		hasNewBadge = false,
	): ReactElement => (
		<Box
			is='button'
			type='button'
			className={itemClass}
			onClick={onClick}
			title={label}
			aria-label={
				badgeCount > 0
					? `${label} (${badgeCount > 99 ? '99+' : badgeCount})`
					: hasNewBadge
						? `${label} (new)`
						: label
			}
			aria-current={active ? 'page' : undefined}
		>
			{/* Relatively-positioned wrapper so the unread badge overlays the icon's top-right
			    corner without shifting the icon/label layout. */}
			<Box is='span' position='relative' display='inline-flex'>
				<Icon name={icon} size='x24' />
				{badgeCount > 0 && (
					<Box is='span' className={activityBadgeClass} aria-hidden>
						{badgeCount > 99 ? '99+' : badgeCount}
					</Box>
				)}
				{hasNewBadge && <Box is='span' className={updatesBadgeClass} aria-hidden />}
			</Box>
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
			pbs={12}
			pbe={12}
		>
			{/* MatterChat mark — "Matter" + the original red "Chat" (brand name stays red on the green theme). */}
			<Box className={brandClass}>
				Matter
				<Box is='span' style={{ color: MATTERCHAT_RED }}>
					Chat
				</Box>
			</Box>
			<Box className={dividerClass} />
			<Box className={sectionLabelClass}>MENU</Box>
			<Box display='flex' flexDirection='column' alignItems='center' flexGrow={1} style={{ gap: '4px', width: '100%' }}>
				{/* Chats is MatterChat-native — hidden in external-workspace mode (the M tile / workspace header
				    is the way back to MatterChat). Boards + LitBox stay (they remain meaningful inside it). */}
				{!inExternalMode && renderItem('balloons', t('Chats'), handleChat, chatActive)}
				{canViewBoards && renderItem('squares', t('Boards'), handleBoards, Boolean(boardsActive))}
				{!inExternalMode && renderItem('book', t('Docs'), handleDocs, docsActive)}
				<Box
					is='button'
					type='button'
					className={itemClass}
					onClick={handleFiles}
					title={t('Files', { defaultValue: 'Files' })}
					aria-label={t('Files', { defaultValue: 'Files' })}
					aria-current={filesActive ? 'page' : undefined}
				>
					{/* The LitBox brand wordmark — 'Lit' white, 'Box' in LitBox's own original blue (#5b7cff) — with a
					    "Files" label below to match the other nav items. Drawn 1:1 (viewBox == rendered px, 13px type,
					    the UI system-font stack) so the browser kerns it natively instead of squeezing down scaled
					    Arial; same optical weight as the "MatterChat" mark at the top of the rail. */}
					<Box display='flex' alignItems='center' justifyContent='center' style={{ height: '24px' }}>
						<svg width='48' height='16' viewBox='0 0 48 16' xmlns='http://www.w3.org/2000/svg' aria-hidden focusable='false'>
							<text
								x='24'
								y='12.5'
								textAnchor='middle'
								fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
								fontSize='13'
								fontWeight='800'
								letterSpacing='0.2'
							>
								<tspan fill='#ffffff'>Lit</tspan>
								<tspan fill='#5b7cff'>Box</tspan>
							</text>
						</svg>
					</Box>
					<Box is='span' className='rail-label'>
						{t('Files', { defaultValue: 'Files' })}
					</Box>
				</Box>
				{/* Activity / Search / Updates / Admin are MatterChat-native — hidden in external-workspace mode. */}
				{!inExternalMode && canViewBoards && renderItem('bell', t('Activity'), handleActivity, Boolean(inboxActive), activityUnread)}
				{!inExternalMode && renderItem('magnifier', t('Search'), handleSearch, false)}
				{!inExternalMode && renderItem('megaphone', t('Updates'), handleUpdates, updatesActive, 0, hasUnseenUpdates)}
				{!inExternalMode && isAdmin && renderItem('cog', t('Admin', { defaultValue: 'Admin' }), handleAdmin, adminActive)}
			</Box>
			{/* Ambient ensō loop anchors the rail bottom — the living brand mark, replacing the avatar
			    (the user menu lives in the NavBar's top-right avatar). Doubles as the unread beacon:
			    a flashing red badge with the total unread count; clicking jumps to the most recent
			    unread room (or /home when caught up). Inner box clips the brush glow so it can never
			    widen the rail; the badge sits on the button OUTSIDE the clip. */}
			<Box
				is='button'
				type='button'
				onClick={handleEnsoClick}
				title={hasUnread ? t('Unread_Messages', { defaultValue: 'Unread messages' }) : t('Chats')}
				aria-label={hasUnread ? t('Unread_Messages', { defaultValue: 'Unread messages' }) : t('Chats')}
				mbs={8}
				style={{
					position: 'relative',
					width: '100%',
					height: '56px',
					flexShrink: 0,
					background: 'none',
					border: 0,
					padding: 0,
					cursor: 'pointer',
				}}
			>
				<Box
					display='flex'
					flexDirection='column'
					alignItems='center'
					justifyContent='center'
					style={{ width: '100%', height: '100%', overflow: 'hidden' }}
				>
					<EnsoMark size={44} />
				</Box>
				{/* className must be the ARRAY form — css() classes are css-in-js objects, not strings;
				    .join(' ') stringifies them into garbage and NO styles apply. */}
				{hasUnread && <Box is='span' className={[ensoUnreadBadgeClass, UNREAD_PULSE_BADGE_CLASS]}>{unreadLabel || '•'}</Box>}
			</Box>
		</Box>
	);
};

export default memo(AppLeftRail);
