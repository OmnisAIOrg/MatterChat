import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CatchMeUpPanel from './CatchMeUpPanel';
import type { CatchUpMessage } from './useCatchUp';

/**
 * MATTERCHAT: the channel-header "Catch me up" panel (F4).
 *
 * The behaviour that matters is that it is a NAVIGATION surface: every row has to be clickable
 * and has to jump to its own message. A list that only reads back what you missed is the thing
 * the spec explicitly did not want.
 */
const message = (overrides: Partial<CatchUpMessage> = {}): CatchUpMessage => ({
	id: 'msg-1',
	username: 'jane',
	text: 'the deposition moved to Thursday',
	ts: '2026-08-15T12:00:00.000Z',
	link: 'https://mc.example/channel/litigation?msg=msg-1',
	...overrides,
});

const defaults = {
	label: '#litigation',
	messages: [] as CatchUpMessage[],
	unread: 0,
	omitted: 0,
	loading: false,
	error: false,
	onRetry: jest.fn(),
	onJump: jest.fn(),
	onClose: jest.fn(),
};

const renderPanel = (props: Partial<typeof defaults> = {}) =>
	render(<CatchMeUpPanel {...defaults} {...props} />, { wrapper: mockAppRoot().build() });

describe('CatchMeUpPanel', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('jumps to the message that was clicked', async () => {
		const onJump = jest.fn();
		const first = message({ id: 'a', text: 'first' });
		const second = message({ id: 'b', text: 'second' });
		renderPanel({ messages: [first, second], unread: 2, onJump });

		await userEvent.click(screen.getByText('second'));

		expect(onJump).toHaveBeenCalledTimes(1);
		expect(onJump).toHaveBeenCalledWith(second);
	});

	it('shows every unread message it was given', () => {
		renderPanel({ messages: [message({ id: 'a', text: 'first' }), message({ id: 'b', text: 'second' })], unread: 2 });

		expect(screen.getByText('first')).toBeInTheDocument();
		expect(screen.getByText('second')).toBeInTheDocument();
	});

	it('says you are caught up rather than showing an empty list', () => {
		renderPanel({ messages: [] });

		expect(screen.getByText('Chi_Catch_Me_Up_Nothing')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /jane/ })).not.toBeInTheDocument();
	});

	it('offers a retry when the load failed, and does not claim you are caught up', () => {
		const onRetry = jest.fn();
		renderPanel({ error: true, onRetry });

		expect(screen.getByText('Chi_Catch_Me_Up_Failed')).toBeInTheDocument();
		expect(screen.queryByText('Chi_Catch_Me_Up_Nothing')).not.toBeInTheDocument();
		screen.getByRole('button', { name: 'Retry' }).click();
		expect(onRetry).toHaveBeenCalled();
	});

	it('shows nothing but the spinner while loading', () => {
		renderPanel({ loading: true, messages: [message()] });

		expect(screen.queryByText('the deposition moved to Thursday')).not.toBeInTheDocument();
		expect(screen.queryByText('Chi_Catch_Me_Up_Nothing')).not.toBeInTheDocument();
	});

	it('admits when it is not showing everything', () => {
		renderPanel({ messages: [message()], unread: 40, omitted: 39 });

		expect(screen.getByText('Chi_Catch_Me_Up_Omitted')).toBeInTheDocument();
	});

	it('closes', async () => {
		const onClose = jest.fn();
		renderPanel({ onClose });

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(onClose).toHaveBeenCalled();
	});
});
