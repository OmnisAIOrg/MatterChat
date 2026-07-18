/**
 * Minimal tests for useOauthResultToasts hook.
 *
 * Tests the core behavior: parsing OAuth result params, displaying toasts, and stripping URLs.
 */
import { renderHook } from '@testing-library/react';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';

import { useOauthResultToasts } from './useOauthResultToasts';

jest.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
	}),
}));

jest.mock('@rocket.chat/ui-contexts', () => ({
	useToastMessageDispatch: jest.fn(),
}));

describe('useOauthResultToasts', () => {
	const mockDispatchToast = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		(useToastMessageDispatch as jest.Mock).mockReturnValue(mockDispatchToast);

		// Mock window.location and history
		delete (window as any).location;
		window.location = { search: '?slack_connected=1', pathname: '/home', href: '' } as any;
		window.history.replaceState = jest.fn();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should parse and display success toast for slack_connected param', () => {
		renderHook(() => useOauthResultToasts());

		expect(mockDispatchToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'success',
				message: expect.stringContaining('Slack connected'),
			}),
		);
	});

	it('should strip OAuth params from URL after processing', () => {
		renderHook(() => useOauthResultToasts());

		expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/home');
	});

	it('should display error toast for slack_error param', () => {
		window.location.search = '?slack_error=not_configured';

		renderHook(() => useOauthResultToasts());

		expect(mockDispatchToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining('Slack connection failed'),
			}),
		);
	});

	it('should handle teams_connected param', () => {
		window.location.search = '?teams_connected=1';

		renderHook(() => useOauthResultToasts());

		expect(mockDispatchToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'success',
				message: expect.stringContaining('Teams connected'),
			}),
		);
	});

	it('should handle google_connected param', () => {
		window.location.search = '?google_connected=1';

		renderHook(() => useOauthResultToasts());

		expect(mockDispatchToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'success',
				message: expect.stringContaining('Google Chat connected'),
			}),
		);
	});

	it('should handle omnisai_error param', () => {
		window.location.search = '?omnisai_error=not_configured_enabled';

		renderHook(() => useOauthResultToasts());

		expect(mockDispatchToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining('OmnisAI login failed'),
			}),
		);
	});

	it('should not display toast when no OAuth params present', () => {
		window.location.search = '';

		renderHook(() => useOauthResultToasts());

		expect(mockDispatchToast).not.toHaveBeenCalled();
	});
});
