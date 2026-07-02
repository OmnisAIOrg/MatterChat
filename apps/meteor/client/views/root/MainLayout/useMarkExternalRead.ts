import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * useMarkExternalRead — best-effort "mark this external channel/chat read" for the selected connection.
 *
 * Wraps POST `/v1/external-workspaces.markRead` (provider detects channel-vs-DM from `externalId`, the
 * SAME token convention as messages/sendMessage). On success it invalidates the directChats list and
 * the rail unread-summary so the bold-name + red count pill clear as soon as the row is opened. The
 * endpoint rides back a 200 `{ ok:false }` envelope for a real ownership/auth failure (it does NOT
 * throw for those) and a provider lacking markRead still acks `{ ok:true }`, so this is intentionally
 * fire-and-forget: opening a row should never error the UI.
 *
 * Returns a `markRead(connectionId, externalId)` callback. Both ids are required; a falsy id is a
 * no-op so callers can pass `connectionId` straight from the selection (which may be undefined).
 */
export const useMarkExternalRead = (): {
	markRead: (connectionId: string | undefined, externalId: string | undefined) => void;
} => {
	const markReadEndpoint = useEndpoint('POST', '/v1/external-workspaces.markRead');
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: ({ connectionId, externalId }: { connectionId: string; externalId: string }) =>
			markReadEndpoint({ connectionId, externalId }),
		onSuccess: () => {
			// Refresh the per-chat unread badges and the rail "feel-alive" summary now that this row is read.
			void queryClient.invalidateQueries({ queryKey: ['external-workspaces.directChats'] });
			void queryClient.invalidateQueries({ queryKey: ['external-workspaces.channels'] });
			void queryClient.invalidateQueries({ queryKey: ['external-workspaces.unreadSummary'] });
		},
	});

	const { mutate } = mutation;

	const markRead = useCallback(
		(connectionId: string | undefined, externalId: string | undefined): void => {
			if (!connectionId || !externalId) {
				return;
			}
			mutate({ connectionId, externalId });
		},
		[mutate],
	);

	return { markRead };
};
