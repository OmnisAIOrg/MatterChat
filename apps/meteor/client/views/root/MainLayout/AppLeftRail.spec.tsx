import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen, waitFor } from '@testing-library/react';

import AppLeftRail from './AppLeftRail';

/**
 * AppLeftRail — Activity unread badge (restored after the PR #53 navbar-bell dedup).
 *
 * The rail's Activity item polls the same source the removed NavBar bell used
 * (GET /v1/boards.notifications.unreadCount under NOTIFICATIONS_UNREAD_KEY) and
 * overlays a dense count chip on the bell icon: hidden at 0, caps at 99+.
 */

// The bottom-of-rail account menu drags in the full NavBar settings toolbar — irrelevant here
// (no user is mocked, so it never renders), but mocking keeps the import graph light.
jest.mock('../../../navbar/NavBarSettingsToolbar', () => ({
	UserMenu: () => <div>UserMenu</div>,
}));

const buildRoot = (unread: number) =>
	mockAppRoot()
		.withPermission('boards-view')
		.withEndpoint('GET', '/v1/boards.notifications.unreadCount', () => ({ unread }))
		.build();

describe('AppLeftRail Activity unread badge', () => {
	it('shows the unread count on the Activity item when unread > 0', async () => {
		render(<AppLeftRail />, { wrapper: buildRoot(5) });

		expect(await screen.findByText('5')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Activity (5)' })).toBeInTheDocument();
	});

	it('caps the badge at 99+', async () => {
		render(<AppLeftRail />, { wrapper: buildRoot(250) });

		expect(await screen.findByText('99+')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Activity (99+)' })).toBeInTheDocument();
	});

	it('hides the badge entirely at 0 unread', async () => {
		render(<AppLeftRail />, { wrapper: buildRoot(0) });

		const activity = screen.getByRole('button', { name: 'Activity' });
		// Let the unread query settle, then assert no count chip appeared.
		await waitFor(() => expect(activity).toBeInTheDocument());
		expect(screen.queryByText('0')).not.toBeInTheDocument();
		expect(activity).toHaveAccessibleName('Activity');
	});

	it('hides the Activity item without the boards-view permission', () => {
		render(<AppLeftRail />, {
			wrapper: mockAppRoot()
				.withEndpoint('GET', '/v1/boards.notifications.unreadCount', () => ({ unread: 5 }))
				.build(),
		});

		expect(screen.queryByRole('button', { name: /Activity/ })).not.toBeInTheDocument();
	});
});
