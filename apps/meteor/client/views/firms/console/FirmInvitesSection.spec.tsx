import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FirmInvitesSection from './FirmInvitesSection';

/**
 * MATTERCHAT: two properties matter here and both are about not surprising the
 * person holding the mouse.
 *
 * 1. Every value this form can send is on the server's whitelist. Out-of-list
 *    values are rejected outright, not rounded, so a UI that could produce one
 *    would be a UI that produces unexplainable errors.
 * 2. Revoke is destructive and irreversible — the endpoint must not be reached
 *    until the confirmation modal has been confirmed.
 */

global.ResizeObserver = jest.fn().mockImplementation(() => ({
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
}));

const liveInvite = {
	_id: 'invite-1',
	url: 'https://matterchat.test/invite/AbCdEf',
	days: 15,
	maxUses: 0,
	uses: 3,
	createdAt: '2026-08-01T00:00:00.000Z',
	expires: '2026-08-16T00:00:00.000Z',
	createdBy: 'u1',
};

type BuildOptions = {
	list?: jest.Mock;
	create?: jest.Mock;
	revoke?: jest.Mock;
};

const buildRoot = ({ list, create, revoke }: BuildOptions = {}) => {
	const listInvites = list ?? jest.fn().mockResolvedValue({ invites: [liveInvite] });
	const createInvite =
		create ??
		jest.fn().mockResolvedValue({
			sent: ['jane@firm.com'],
			invalid: [],
			inviteUrl: 'https://matterchat.test/invite/NewLink',
			inviteId: 'invite-2',
			days: 15,
			maxUses: 0,
		});
	const revokeInvite = revoke ?? jest.fn().mockResolvedValue({ revoked: true });

	const root = mockAppRoot()
		.withEndpoint('GET', '/v1/firms.invites.list', listInvites)
		.withEndpoint('POST', '/v1/firms.invite', createInvite)
		.withEndpoint('POST', '/v1/firms.invites.revoke', revokeInvite)
		.build();

	return { root, listInvites, createInvite, revokeInvite };
};

describe('FirmInvitesSection', () => {
	it('lists a live link with its uses and expiry', async () => {
		const { root } = buildRoot();
		render(<FirmInvitesSection />, { wrapper: root });

		expect(await screen.findByText(liveInvite.url)).toBeInTheDocument();
		// maxUses 0 means unlimited, which must not render as "3 of 0 used".
		expect(screen.getByText(/Firm_Invite_Uses_Unlimited_Count/)).toBeInTheDocument();
	});

	it('says so when there are no live links', async () => {
		const { root } = buildRoot({ list: jest.fn().mockResolvedValue({ invites: [] }) });
		render(<FirmInvitesSection />, { wrapper: root });

		expect(await screen.findByText('Firm_Invites_Empty')).toBeInTheDocument();
	});

	it('surfaces a list failure with a retry rather than an empty section', async () => {
		const { root } = buildRoot({ list: jest.fn().mockRejectedValue(new Error('error-not-allowed')) });
		render(<FirmInvitesSection />, { wrapper: root });

		expect(await screen.findByText('Firm_Invites_Load_Failed')).toBeInTheDocument();
		expect(screen.getByText('error-not-allowed')).toBeInTheDocument();
	});

	it('creates an invite with the whitelisted defaults', async () => {
		const { root, createInvite } = buildRoot();
		render(<FirmInvitesSection />, { wrapper: root });

		await userEvent.type(screen.getByLabelText('Firm_invite_emails'), 'jane@firm.com, john@firm.com');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_invite_send_action' }));

		await waitFor(() =>
			expect(createInvite).toHaveBeenCalledWith({
				emails: ['jane@firm.com', 'john@firm.com'],
				days: 15,
				maxUses: 0,
			}),
		);
	});

	it('only ever sends whitelist-legal expiry and use limits', async () => {
		const { root, createInvite } = buildRoot();
		render(<FirmInvitesSection />, { wrapper: root });

		await userEvent.type(screen.getByLabelText('Firm_invite_emails'), 'jane@firm.com');

		// Expiry: the 15-day default -> 1 day. (7/15/30 all render as the same
		// bare key without translations, so the 1-day option is the one that can
		// be addressed unambiguously here.)
		// react-aria names the trigger after its CURRENT VALUE, not its label, so
		// these selectors read as the option showing right now.
		await userEvent.click(screen.getByRole('button', { name: 'Firm_Invite_Expiry_Days' }));
		await userEvent.click(await screen.findByRole('option', { name: 'Firm_Invite_Expiry_One_Day' }));

		// Max uses: unlimited -> 1 use.
		await userEvent.click(screen.getByRole('button', { name: 'Firm_Invite_Unlimited_Uses' }));
		await userEvent.click(await screen.findByRole('option', { name: 'Firm_Invite_Uses_Max_One' }));

		await userEvent.click(screen.getByRole('button', { name: 'Firm_invite_send_action' }));

		await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
		const [params] = createInvite.mock.calls[0];
		expect([0, 1, 7, 15, 30]).toContain(params.days);
		expect([0, 1, 5, 10, 25, 50, 100]).toContain(params.maxUses);
		expect(params).toEqual({ emails: ['jane@firm.com'], days: 1, maxUses: 1 });
	});

	it('refuses to call the endpoint with no addresses, and explains why', async () => {
		const { root, createInvite } = buildRoot();
		render(<FirmInvitesSection />, { wrapper: root });

		await userEvent.click(screen.getByRole('button', { name: 'Firm_invite_send_action' }));

		expect(await screen.findByText('Firm_Invite_Emails_Required')).toBeInTheDocument();
		expect(createInvite).not.toHaveBeenCalled();
	});

	it('shows a create failure inline instead of losing it', async () => {
		const { root } = buildRoot({ create: jest.fn().mockRejectedValue(new Error('error-invalid-invite-days')) });
		render(<FirmInvitesSection />, { wrapper: root });

		await userEvent.type(screen.getByLabelText('Firm_invite_emails'), 'jane@firm.com');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_invite_send_action' }));

		expect(await screen.findByText('error-invalid-invite-days')).toBeInTheDocument();
	});

	it('asks for confirmation before revoking, and does not call the endpoint until confirmed', async () => {
		const { root, revokeInvite } = buildRoot();
		render(<FirmInvitesSection />, { wrapper: root });

		await userEvent.click(await screen.findByRole('button', { name: 'Firm_Invite_Revoke' }));

		// The warning is up and nothing has happened yet.
		expect(await screen.findByText('Firm_Invite_Revoke_Confirm')).toBeInTheDocument();
		expect(revokeInvite).not.toHaveBeenCalled();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(revokeInvite).not.toHaveBeenCalled();
	});

	it('revokes once the warning is confirmed', async () => {
		const { root, revokeInvite } = buildRoot();
		render(<FirmInvitesSection />, { wrapper: root });

		await userEvent.click(await screen.findByRole('button', { name: 'Firm_Invite_Revoke' }));
		expect(await screen.findByText('Firm_Invite_Revoke_Confirm')).toBeInTheDocument();

		// The modal's confirm button carries the same label as the row button, so
		// take the one inside the dialog.
		const dialog = screen.getByRole('dialog');
		await userEvent.click(within(dialog).getByRole('button', { name: 'Firm_Invite_Revoke' }));

		await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith({ inviteId: 'invite-1' }));
	});
});
