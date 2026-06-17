import type { ISavedView, Serialized } from '@rocket.chat/core-typings';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

/**
 * useSavedViews — the board's own + shared saved views plus the management
 * mutations (remove / setDefault), all over `boards.views.*`.
 *
 * `list` is gated server-side by `boards-view` + board visibility; the write
 * mutations are gated by `boards-manage-saved-views` + per-view ownership. The
 * view switcher uses `views`/`defaultView` to populate its menu; the manage
 * actions live in the switcher's overflow.
 */

export const SAVED_VIEWS_KEY = (boardId: string): string[] => ['boards', 'views', 'list', boardId];

type UseSavedViews = {
	views: Serialized<ISavedView>[];
	defaultView: Serialized<ISavedView> | undefined;
	isLoading: boolean;
	removeView: (viewId: string) => void;
	setDefaultView: (viewId: string) => void;
	removing: boolean;
};

export const useSavedViews = (boardId: string): UseSavedViews => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const listViews = useEndpoint('GET', '/v1/boards.views.list');
	const removeViewEndpoint = useEndpoint('POST', '/v1/boards.views.remove');
	const setDefaultEndpoint = useEndpoint('POST', '/v1/boards.views.setDefault');

	const { data, isLoading } = useQuery({
		queryKey: SAVED_VIEWS_KEY(boardId),
		queryFn: () => listViews({ boardId }),
		enabled: Boolean(boardId),
	});

	const views = (data?.views ?? []) as Serialized<ISavedView>[];
	const defaultView = views.find((v) => v.isDefault);

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: SAVED_VIEWS_KEY(boardId) });
	};

	const removeMutation = useMutation({
		mutationFn: (viewId: string) => removeViewEndpoint({ viewId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Views_Removed', { defaultValue: 'View removed' }) });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const setDefaultMutation = useMutation({
		mutationFn: (viewId: string) => setDefaultEndpoint({ viewId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	return {
		views,
		defaultView,
		isLoading,
		removeView: removeMutation.mutate,
		setDefaultView: setDefaultMutation.mutate,
		removing: removeMutation.isPending,
	};
};
