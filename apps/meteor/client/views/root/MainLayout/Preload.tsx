import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { RoomsCachedStore, SubscriptionsCachedStore } from '../../../cachedStores';
import PageLoading from '../PageLoading';
import { useMainReady } from '../hooks/useMainReady';
import { useOauthResultToasts } from './useOauthResultToasts';

const Preload = ({ children }: { children: ReactNode }) => {
	const ready = useMainReady();

	// Display OAuth connection result toasts (slack_connected, teams_error, etc.)
	useOauthResultToasts();

	useEffect(() => {
		SubscriptionsCachedStore.listen();
		RoomsCachedStore.listen();
	}, []);

	if (!ready) {
		return <PageLoading />;
	}

	return <>{children}</>;
};

export default Preload;
