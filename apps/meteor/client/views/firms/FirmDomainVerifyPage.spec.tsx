import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen, waitFor } from '@testing-library/react';

import FirmDomainVerifyPage from './FirmDomainVerifyPage';

/**
 * MATTERCHAT: this page is the other end of every domain-verification email in
 * the product. Both outcomes have to be legible, and the token must be spent
 * exactly once — a second POST with a consumed token turns a success into a
 * bogus failure.
 */

global.ResizeObserver = jest.fn().mockImplementation(() => ({
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
}));

const buildRoot = (verify: jest.Mock, token?: string) => {
	let builder = mockAppRoot().withEndpoint('POST', '/v1/firms.domains.verify', verify);
	if (token !== undefined) {
		builder = builder.withRouteParameter('token', token);
	}
	return builder.build();
};

describe('FirmDomainVerifyPage', () => {
	it('confirms the domain for a valid token', async () => {
		const verify = jest.fn().mockResolvedValue({
			domain: { _id: 'd1', domain: 'smithlaw.com', verified: true, createdAt: '2026-08-01T00:00:00.000Z' },
		});
		render(<FirmDomainVerifyPage />, { wrapper: buildRoot(verify, 'good-token') });

		expect(await screen.findByText('Firm_Domain_Verify_Success')).toBeInTheDocument();
		expect(screen.getByText('Firm_Domain_Confirmed')).toBeInTheDocument();
		expect(verify).toHaveBeenCalledWith({ token: 'good-token' });
	});

	it('reports a spent or forged token instead of pretending it worked', async () => {
		const verify = jest.fn().mockRejectedValue(new Error('error-domain-not-found'));
		render(<FirmDomainVerifyPage />, { wrapper: buildRoot(verify, 'bad-token') });

		expect(await screen.findByText('Firm_Domain_Verify_Failed')).toBeInTheDocument();
		expect(screen.getByText('error-domain-not-found')).toBeInTheDocument();
		expect(screen.queryByText('Firm_Domain_Confirmed')).not.toBeInTheDocument();
	});

	it('spends the token exactly once', async () => {
		const verify = jest.fn().mockResolvedValue({
			domain: { _id: 'd1', domain: 'smithlaw.com', verified: true, createdAt: '2026-08-01T00:00:00.000Z' },
		});
		const { rerender } = render(<FirmDomainVerifyPage />, { wrapper: buildRoot(verify, 'good-token') });

		expect(await screen.findByText('Firm_Domain_Verify_Success')).toBeInTheDocument();
		rerender(<FirmDomainVerifyPage />);

		await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
	});

	it('says the link is incomplete when there is no token at all', async () => {
		const verify = jest.fn();
		render(<FirmDomainVerifyPage />, { wrapper: buildRoot(verify) });

		expect(await screen.findByText('Firm_Domain_Verify_Missing_Token')).toBeInTheDocument();
		expect(verify).not.toHaveBeenCalled();
	});

	it('offers a way back to the console once it has an answer', async () => {
		const verify = jest.fn().mockResolvedValue({
			domain: { _id: 'd1', domain: 'smithlaw.com', verified: true, createdAt: '2026-08-01T00:00:00.000Z' },
		});
		render(<FirmDomainVerifyPage />, { wrapper: buildRoot(verify, 'good-token') });

		expect(await screen.findByRole('button', { name: 'Firm_Domain_Verify_Go_To_Console' })).toBeInTheDocument();
	});
});
