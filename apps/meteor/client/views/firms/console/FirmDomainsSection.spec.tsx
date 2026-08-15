import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FirmDomainsSection from './FirmDomainsSection';

/**
 * MATTERCHAT: the failure mode this section exists to prevent is an owner
 * claiming a domain, seeing it listed, and assuming it works. A claim is inert
 * until verified, so the pending state has to say so in words — these tests
 * pin that, not just the presence of a row.
 */

global.ResizeObserver = jest.fn().mockImplementation(() => ({
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
}));

const pendingDomain = {
	_id: 'domain-1',
	domain: 'smithlaw.com',
	verified: false,
	verificationEmail: 'admin@smithlaw.com',
	verificationExpiresAt: '2026-08-20T00:00:00.000Z',
	createdAt: '2026-08-01T00:00:00.000Z',
};

const verifiedDomain = {
	_id: 'domain-2',
	domain: 'verified.example',
	verified: true,
	createdAt: '2026-07-01T00:00:00.000Z',
	verifiedAt: '2026-07-02T00:00:00.000Z',
};

type BuildOptions = {
	list?: jest.Mock;
	claim?: jest.Mock;
	remove?: jest.Mock;
};

const buildRoot = ({ list, claim, remove }: BuildOptions = {}) => {
	const listDomains = list ?? jest.fn().mockResolvedValue({ domains: [pendingDomain, verifiedDomain] });
	const claimDomain = claim ?? jest.fn().mockResolvedValue({ domain: pendingDomain, sentTo: 'admin@smithlaw.com' });
	const removeDomain = remove ?? jest.fn().mockResolvedValue({ removed: true });

	const root = mockAppRoot()
		.withEndpoint('GET', '/v1/firms.domains.list', listDomains)
		.withEndpoint('POST', '/v1/firms.domains.claim', claimDomain)
		.withEndpoint('POST', '/v1/firms.domains.remove', removeDomain)
		.build();

	return { root, listDomains, claimDomain, removeDomain };
};

describe('FirmDomainsSection', () => {
	it('marks an unverified claim as pending and explains that it does nothing yet', async () => {
		const { root } = buildRoot();
		render(<FirmDomainsSection />, { wrapper: root });

		expect(await screen.findByText('smithlaw.com')).toBeInTheDocument();
		expect(screen.getByText('Firm_Domain_Pending_Verification')).toBeInTheDocument();
		expect(screen.getByText('Firm_Domain_Pending_Explainer_With_Email')).toBeInTheDocument();
	});

	it('marks a verified claim as verified, with no pending explanation', async () => {
		const { root } = buildRoot({ list: jest.fn().mockResolvedValue({ domains: [verifiedDomain] }) });
		render(<FirmDomainsSection />, { wrapper: root });

		expect(await screen.findByText('Firm_Domain_Verified')).toBeInTheDocument();
		expect(screen.queryByText('Firm_Domain_Pending_Explainer_With_Email')).not.toBeInTheDocument();
		expect(screen.queryByText('Firm_Domain_Pending_Explainer')).not.toBeInTheDocument();
	});

	it('claims a domain and shows the new claim as pending', async () => {
		const listDomains = jest
			.fn()
			.mockResolvedValueOnce({ domains: [] })
			.mockResolvedValue({ domains: [pendingDomain] });
		const { root, claimDomain } = buildRoot({ list: listDomains });
		render(<FirmDomainsSection />, { wrapper: root });

		expect(await screen.findByText('Firm_Domains_Empty')).toBeInTheDocument();

		await userEvent.type(screen.getByLabelText('Domain'), 'smithlaw.com');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_Domain_Claim' }));

		// No verification address typed, so the field is omitted rather than sent empty.
		await waitFor(() => expect(claimDomain).toHaveBeenCalledWith({ domain: 'smithlaw.com' }));
		expect(await screen.findByText('Firm_Domain_Pending_Verification')).toBeInTheDocument();
	});

	it('passes a verification address through when one is given', async () => {
		const { root, claimDomain } = buildRoot({ list: jest.fn().mockResolvedValue({ domains: [] }) });
		render(<FirmDomainsSection />, { wrapper: root });

		await userEvent.type(screen.getByLabelText('Domain'), 'smithlaw.com');
		await userEvent.type(screen.getByLabelText('Firm_Domain_Verification_Email'), 'admin@smithlaw.com');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_Domain_Claim' }));

		await waitFor(() => expect(claimDomain).toHaveBeenCalledWith({ domain: 'smithlaw.com', verificationEmail: 'admin@smithlaw.com' }));
	});

	it('does not call the endpoint with an empty domain', async () => {
		const { root, claimDomain } = buildRoot({ list: jest.fn().mockResolvedValue({ domains: [] }) });
		render(<FirmDomainsSection />, { wrapper: root });

		await userEvent.click(screen.getByRole('button', { name: 'Firm_Domain_Claim' }));

		expect(await screen.findByText('Firm_Domain_Required')).toBeInTheDocument();
		expect(claimDomain).not.toHaveBeenCalled();
	});

	it('shows a rejected claim inline', async () => {
		const { root } = buildRoot({
			list: jest.fn().mockResolvedValue({ domains: [] }),
			claim: jest.fn().mockRejectedValue(new Error('error-public-email-domain')),
		});
		render(<FirmDomainsSection />, { wrapper: root });

		await userEvent.type(screen.getByLabelText('Domain'), 'gmail.com');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_Domain_Claim' }));

		expect(await screen.findByText('error-public-email-domain')).toBeInTheDocument();
	});

	it('surfaces a list failure with a retry rather than an empty section', async () => {
		const { root } = buildRoot({ list: jest.fn().mockRejectedValue(new Error('error-not-allowed')) });
		render(<FirmDomainsSection />, { wrapper: root });

		expect(await screen.findByText('Firm_Domains_Load_Failed')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	it('confirms before releasing a domain', async () => {
		const { root, removeDomain } = buildRoot({ list: jest.fn().mockResolvedValue({ domains: [verifiedDomain] }) });
		render(<FirmDomainsSection />, { wrapper: root });

		await userEvent.click(await screen.findByRole('button', { name: 'Firm_Domain_Remove' }));

		expect(await screen.findByText('Firm_Domain_Remove_Confirm')).toBeInTheDocument();
		expect(removeDomain).not.toHaveBeenCalled();

		const dialog = screen.getByRole('dialog');
		await userEvent.click(within(dialog).getByRole('button', { name: 'Firm_Domain_Remove' }));

		await waitFor(() => expect(removeDomain).toHaveBeenCalledWith({ domainId: 'domain-2' }));
	});
});
