import { Box, Button, Icon, Throbber } from '@rocket.chat/fuselage';
import type { LocationPathname } from '@rocket.chat/ui-contexts';
import { useEndpoint, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { notificationIcon, relativeTime, type ClientNotification } from './lib/presentation';
import { serifCaption, tabularNums, useLedgerTones } from '../lib/ledgerTheme';

/**
 * NotificationsInbox — the panel the Boards NavBar bell drops down.
 *
 * Self-contained inbox (the lower-risk path foundations recommended): it reads
 * `GET /v1/boards.notifications.list` (latest page, all read+unread) and renders
 * a compact feed. Clicking a row marks it read (`boards.notifications.markRead`)
 * and deep-links via the stored in-app `link` pathname; "Mark all read" calls
 * `boards.notifications.markAllRead`. Everything degrades gracefully — an empty
 * or errored read just shows the zero-state, never blocks the NavBar.
 *
 * The bell badge count comes from a separate, cheap `unreadCount` poll in the
 * bell itself; this panel shares the same react-query cache keys so a markRead
 * here updates the badge immediately.
 *
 * LEDGER-DENSE SKIN (style-only): paper panel, serif caption, khaki row rules,
 * dense rows, and green (the brand accent) for the unread tint/dot/icon. Works
 * both as the bell dropdown and the full-page /boards/inbox route.
 */

export const NOTIFICATIONS_LIST_KEY = ['boards', 'notifications', 'list'];
export const NOTIFICATIONS_UNREAD_KEY = ['boards', 'notifications', 'unreadCount'];

const INBOX_PAGE = 30;

type NotificationsInboxProps = {
	// The NavBar bell passes this to close its dropdown panel after a click. When
	// NotificationsInbox is mounted as the full-page /boards/inbox route there is no panel
	// to close, so it is omitted and treated as a no-op.
	onNavigate?: () => void;
};

const NotificationsInbox = ({ onNavigate }: NotificationsInboxProps): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const router = useRouter();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const listNotifications = useEndpoint('GET', '/v1/boards.notifications.list');
	const markRead = useEndpoint('POST', '/v1/boards.notifications.markRead');
	const markAllRead = useEndpoint('POST', '/v1/boards.notifications.markAllRead');

	const { data, isLoading } = useQuery({
		queryKey: NOTIFICATIONS_LIST_KEY,
		queryFn: () => listNotifications({ count: INBOX_PAGE }),
	});

	const notifications: ClientNotification[] = data?.notifications ?? [];

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY });
		void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY });
	};

	const markReadMutation = useMutation({
		mutationFn: (notificationId: string) => markRead({ notificationId }),
		onSuccess: invalidate,
		// best-effort: a failed read-flip should not block navigation or toast-spam.
		onError: () => undefined,
	});

	const markAllMutation = useMutation({
		mutationFn: () => markAllRead({}),
		onSuccess: invalidate,
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const openNotification = (notification: ClientNotification): void => {
		if (!notification.read) {
			markReadMutation.mutate(notification._id);
		}
		// `link` is an in-app router pathname written by the delivery seam
		// (e.g. /boards/board/<board>/board/<card>). Navigate by pathname; if a
		// notification carried no link, just close the panel.
		if (notification.link) {
			router.navigate(notification.link as LocationPathname);
		}
		onNavigate?.();
	};

	const hasUnread = notifications.some((n) => !n.read);

	return (
		<Box display='flex' flexDirection='column' width={360} maxWidth='100vw' style={{ background: tones.paper }}>
			<Box
				display='flex'
				alignItems='center'
				justifyContent='space-between'
				padding={12}
				paddingBlockEnd={8}
				style={{ borderBlockEnd: `1px solid ${tones.strokeSoft}` }}
			>
				<Box fontScale='h5' color='default' style={serifCaption}>
					{t('Boards_Notifications', { defaultValue: 'Notifications' })}
				</Box>
				<Button
					small
					disabled={!hasUnread || markAllMutation.isPending}
					onClick={() => markAllMutation.mutate()}
					title={t('Boards_Notifications_MarkAllRead', { defaultValue: 'Mark all as read' })}
				>
					{t('Boards_Notifications_MarkAllRead', { defaultValue: 'Mark all as read' })}
				</Button>
			</Box>

			<Box display='flex' flexDirection='column' style={{ maxHeight: '60vh', overflowY: 'auto' }}>
				{isLoading && (
					<Box display='flex' justifyContent='center' padding={24}>
						<Throbber />
					</Box>
				)}

				{!isLoading && notifications.length === 0 && (
					<Box display='flex' flexDirection='column' alignItems='center' padding={24} color='hint'>
						<Icon name='bell-off' size='x32' marginBlockEnd={8} />
						<Box fontScale='p2'>{t('Boards_Notifications_Empty', { defaultValue: 'You are all caught up' })}</Box>
					</Box>
				)}

				{notifications.map((notification) => (
					<Box
						key={notification._id}
						role='button'
						tabIndex={0}
						onClick={() => openNotification(notification)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								openNotification(notification);
							}
						}}
						display='flex'
						alignItems='flex-start'
						paddingInline={12}
						paddingBlock={8}
						style={{
							cursor: 'pointer',
							gap: '10px',
							background: notification.read ? undefined : tones.greenSoft,
							borderBlockEnd: `1px solid ${tones.strokeSoft}`,
						}}
						className='rcx-box--animated'
					>
						<Box marginBlockStart={2} style={{ flexShrink: 0, color: notification.read ? tones.inkMuted : tones.green }}>
							<Icon name={notificationIcon(notification.kind)} size='x18' />
						</Box>
						<Box minWidth={0} flexGrow={1}>
							<Box display='flex' alignItems='center' justifyContent='space-between' style={{ gap: '8px' }}>
								<Box fontScale={notification.read ? 'p2' : 'p2b'} color='default' withTruncatedText>
									{notification.title}
								</Box>
								<Box fontScale='micro' style={{ flexShrink: 0, ...tabularNums, color: tones.inkMuted }}>
									{relativeTime(notification.createdAt)}
								</Box>
							</Box>
							{notification.body && (
								<Box fontScale='c1' marginBlockStart={2} withTruncatedText style={{ color: tones.inkMuted }}>
									{notification.body}
								</Box>
							)}
						</Box>
						{!notification.read && (
							<Box marginBlockStart={6} style={{ flexShrink: 0 }}>
								<Box width={8} height={8} borderRadius='full' style={{ background: tones.green }} />
							</Box>
						)}
					</Box>
				))}
			</Box>
		</Box>
	);
};

export default NotificationsInbox;
