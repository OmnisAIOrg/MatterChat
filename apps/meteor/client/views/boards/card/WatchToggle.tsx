import type { IBoardSubscription, Serialized } from '@rocket.chat/core-typings';
import { Button, Icon, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * WatchToggle — the Trello/Jira "Watch" control on a board card (M8).
 *
 * Reads `GET /v1/boards.subscriptions.list` (the caller's own follows — the
 * finder keys on userId, so no extra permission) and, if a subscription targets
 * THIS card, renders "Watching" (filled bell); otherwise "Watch". Toggling calls
 * `boards.subscriptions.watch` / `.unwatch` with `{ kind:'card', id:cardId }` —
 * the service resolves the owning board from the card and enforces board
 * visibility, so no boardId is sent for a card target.
 *
 * A watcher receives `boards_notifications` rows when this card moves / gains a
 * comment / a deadline fires (see the notifications delivery seam). Rendered in
 * the CardDetail header next to the close button.
 */

const SUBSCRIPTIONS_KEY = ['boards', 'subscriptions', 'list'];

type WatchToggleProps = {
	cardId: string;
};

const WatchToggle = ({ cardId }: WatchToggleProps): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const listSubscriptions = useEndpoint('GET', '/v1/boards.subscriptions.list');
	const watch = useEndpoint('POST', '/v1/boards.subscriptions.watch');
	const unwatch = useEndpoint('POST', '/v1/boards.subscriptions.unwatch');

	const { data, isLoading } = useQuery({
		queryKey: SUBSCRIPTIONS_KEY,
		queryFn: () => listSubscriptions({}),
	});

	const subscriptions: Serialized<IBoardSubscription>[] = data?.subscriptions ?? [];
	const watching = subscriptions.some((s) => s.target?.kind === 'card' && s.target?.id === cardId && !s.archived);

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
		// the bell badge may change once this user starts/stops following.
		void queryClient.invalidateQueries({ queryKey: ['boards', 'notifications', 'unreadCount'] });
	};

	const toggleMutation = useMutation({
		mutationFn: async (): Promise<void> => {
			if (watching) {
				await unwatch({ kind: 'card', id: cardId });
			} else {
				await watch({ kind: 'card', id: cardId });
			}
		},
		onSuccess: () => {
			dispatchToastMessage({
				type: 'success',
				message: watching
					? t('Boards_Notifications_Unwatched', { defaultValue: 'You are no longer watching this card' })
					: t('Boards_Notifications_Watching', { defaultValue: 'You are now watching this card' }),
			});
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const busy = isLoading || toggleMutation.isPending;

	return (
		<Button
			small
			primary={watching}
			disabled={busy}
			onClick={() => toggleMutation.mutate()}
			title={
				watching
					? t('Boards_Notifications_Watching', { defaultValue: 'Watching' })
					: t('Boards_Notifications_Watch', { defaultValue: 'Watch' })
			}
		>
			{toggleMutation.isPending ? (
				<Throbber inheritColor size='x12' />
			) : (
				<Icon name={watching ? 'bell' : 'bell-off'} size='x16' marginInlineEnd={4} />
			)}
			{watching
				? t('Boards_Notifications_Watching', { defaultValue: 'Watching' })
				: t('Boards_Notifications_Watch', { defaultValue: 'Watch' })}
		</Button>
	);
};

export default WatchToggle;
