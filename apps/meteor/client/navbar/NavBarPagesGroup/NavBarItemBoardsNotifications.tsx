import { Badge, Box, Dropdown, NavBarItem } from '@rocket.chat/fuselage';
import { useOutsideClick, useToggle } from '@rocket.chat/fuselage-hooks';
import { useEndpoint, usePermission } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { HTMLAttributes } from 'react';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import NotificationsInbox, { NOTIFICATIONS_UNREAD_KEY } from '../../views/boards/notifications/NotificationsInbox';

/**
 * NavBarItemBoardsNotifications — the Boards-scoped notification bell (M8).
 *
 * SELF-CONTAINED path (per the foundations + notifications-server recommendation):
 * rather than wiring into Rocket.Chat's core `notify-user` streamer + native bell,
 * this is a Boards-owned bell living in the existing NavBar pages group. It polls
 * the cheap `GET /v1/boards.notifications.unreadCount` for the badge and opens a
 * `NotificationsInbox` dropdown (which reads the full feed + marks read). Blast
 * radius stays entirely inside the Boards feature.
 *
 * Gated by `boards-view` (notifications are per-user; the server finders key on
 * userId, and watch/unwatch additionally enforce board visibility) — if the user
 * cannot see boards, the bell is hidden. Mirrors NavBarItemBoards' permission gate.
 * Uses the fuselage `Dropdown` for the positioned panel + an inlined
 * toggle/outside-click (the same pattern as the shared useDropdownVisibility hook).
 *
 * WIRING (reported to Integration): render this in
 * `client/navbar/NavBarPagesGroup/NavBarPagesGroup.tsx` next to <NavBarItemBoards/>.
 */

const UNREAD_POLL_MS = 60 * 1000; // 60s — matches the cheap badge cadence

type NavBarItemBoardsNotificationsProps = Omit<HTMLAttributes<HTMLElement>, 'is'>;

const NavBarItemBoardsNotifications = (props: NavBarItemBoardsNotificationsProps) => {
	const { t } = useTranslation();
	const canViewBoards = usePermission('boards-view');

	const reference = useRef<HTMLElement>(null);
	const target = useRef<HTMLElement>(null);
	// Local dropdown visibility (mirrors the shared useDropdownVisibility hook):
	// toggle on click, close on an outside click that isn't on the bell itself.
	const [isVisible, toggle] = useToggle(false);
	useOutsideClick(
		[target, reference],
		useCallback(() => toggle(false), [toggle]),
	);

	const getUnreadCount = useEndpoint('GET', '/v1/boards.notifications.unreadCount');

	// The badge poll. `enabled` is gated on permission so non-board users never
	// hit the endpoint. Degrades to 0 on any error.
	const { data } = useQuery({
		queryKey: NOTIFICATIONS_UNREAD_KEY,
		queryFn: () => getUnreadCount({}),
		enabled: canViewBoards,
		refetchInterval: UNREAD_POLL_MS,
		refetchOnWindowFocus: true,
	});

	const unread = data?.unread ?? 0;

	if (!canViewBoards) {
		return null;
	}

	const badgeLabel = unread > 99 ? '99+' : String(unread);

	return (
		<>
			{/* Relatively-positioned wrapper so the unread badge can overlay the
			    icon button regardless of the IconButton's own positioning. */}
			<Box position='relative' display='inline-flex'>
				<NavBarItem
					{...props}
					ref={reference}
					icon='bell'
					title={t('Boards_Notifications', { defaultValue: 'Notifications' })}
					aria-label={t('Boards_Notifications', { defaultValue: 'Notifications' })}
					onClick={() => toggle()}
					pressed={isVisible}
				/>
				{unread > 0 && (
					<Box is='span' position='absolute' style={{ top: 0, insetInlineEnd: 0, pointerEvents: 'none' }}>
						<Badge variant='danger' small>
							{badgeLabel}
						</Badge>
					</Box>
				)}
			</Box>
			{isVisible && (
				<Dropdown reference={reference} ref={target} placement='bottom-end'>
					<NotificationsInbox onNavigate={() => toggle(false)} />
				</Dropdown>
			)}
		</>
	);
};

export default NavBarItemBoardsNotifications;
