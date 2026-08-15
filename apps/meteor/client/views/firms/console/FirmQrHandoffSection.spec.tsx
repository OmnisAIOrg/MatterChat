import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen } from '@testing-library/react';

import FirmQrHandoffSection from './FirmQrHandoffSection';

/**
 * MATTERCHAT: the QR is drawn with `yaqrcode`, which was ALREADY a dependency
 * of apps/meteor (Rocket.Chat's TOTP setup uses it). No package was added for
 * this screen, and because it renders to a data URI with no canvas and no
 * network it also works under jsdom — so this is a real render, not a mock.
 */

global.ResizeObserver = jest.fn().mockImplementation(() => ({
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
}));

const invite = {
	_id: 'invite-1',
	url: 'https://matterchat.test/invite/AbCdEf',
	days: 15,
	maxUses: 0,
	uses: 0,
	createdAt: '2026-08-01T00:00:00.000Z',
	expires: null,
	createdBy: 'u1',
};

const buildRoot = (list: jest.Mock) => mockAppRoot().withEndpoint('GET', '/v1/firms.invites.list', list).build();

describe('FirmQrHandoffSection', () => {
	it('renders a scannable QR image for the newest live invite', async () => {
		render(<FirmQrHandoffSection />, { wrapper: buildRoot(jest.fn().mockResolvedValue({ invites: [invite] })) });

		const image = await screen.findByRole('img', { name: 'Firm_QR_Alt' });
		expect(image).toHaveAttribute('src', expect.stringContaining('data:image'));
	});

	it('also shows the raw link, for people who would rather be sent it', async () => {
		render(<FirmQrHandoffSection />, { wrapper: buildRoot(jest.fn().mockResolvedValue({ invites: [invite] })) });

		expect(await screen.findByText(invite.url)).toBeInTheDocument();
	});

	it('asks for an invite to be created rather than showing an empty frame', async () => {
		render(<FirmQrHandoffSection />, { wrapper: buildRoot(jest.fn().mockResolvedValue({ invites: [] })) });

		expect(await screen.findByText('Firm_QR_Empty')).toBeInTheDocument();
	});

	it('degrades to a message when the invite list cannot be read', async () => {
		render(<FirmQrHandoffSection />, { wrapper: buildRoot(jest.fn().mockRejectedValue(new Error('error-not-allowed'))) });

		expect(await screen.findByText('Firm_QR_Unavailable')).toBeInTheDocument();
	});
});
