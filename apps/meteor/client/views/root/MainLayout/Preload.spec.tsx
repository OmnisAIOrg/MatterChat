/**
 * Minimal tests for Preload component changes.
 *
 * Verifies that useOauthResultToasts hook is mounted and called.
 */
import { render } from '@testing-library/react';

import Preload from './Preload';
import * as useOauthResultToastsModule from './useOauthResultToasts';

jest.mock('./useOauthResultToasts', () => ({
	useOauthResultToasts: jest.fn(),
}));

jest.mock('../../../cachedStores', () => ({
	RoomsCachedStore: { listen: jest.fn() },
	SubscriptionsCachedStore: { listen: jest.fn() },
}));

jest.mock('../PageLoading', () => () => <div>PageLoading</div>);

jest.mock('../hooks/useMainReady', () => ({
	useMainReady: () => true,
}));

describe('Preload', () => {
	const mockUseOauthResultToasts = useOauthResultToastsModule.useOauthResultToasts as jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should mount useOauthResultToasts hook on render', () => {
		render(<Preload><div>Test</div></Preload>);

		expect(mockUseOauthResultToasts).toHaveBeenCalled();
	});

	it('should render children when ready', () => {
		const { getByText } = render(<Preload><div>Test Content</div></Preload>);

		expect(getByText('Test Content')).toBeInTheDocument();
	});
});
