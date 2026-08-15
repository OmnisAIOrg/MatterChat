import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen } from '@testing-library/react';

import FirmConsolePage from './FirmConsolePage';

/**
 * MATTERCHAT: the console is the screen that replaces a trip into the admin
 * area, so the two things that must never regress are (a) a non-owner does not
 * meet controls that will 403 on them, and (b) nothing here can blank the page.
 *
 * With no `.withTranslations(...)` the mock i18n renders keys verbatim, so the
 * assertions are on keys rather than English copy.
 */

global.ResizeObserver = jest.fn().mockImplementation(() => ({
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
}));

const ownedFirm = { firmId: 'firm-1', name: 'Smith & Co', roomId: 'room-1', isOwner: true };
const memberFirm = { ...ownedFirm, isOwner: false };

type BuildOptions = {
	mine?: jest.Mock;
	members?: jest.Mock;
};

const buildRoot = ({ mine, members }: BuildOptions = {}) =>
	mockAppRoot()
		.withEndpoint('GET', '/v1/firms.mine', mine ?? jest.fn().mockResolvedValue({ enabled: true, firm: ownedFirm }))
		.withEndpoint(
			'GET',
			'/v1/firms.templates',
			jest.fn().mockResolvedValue({ practiceAreas: [{ id: 'personal-injury', label: 'Personal injury' }] }),
		)
		.withEndpoint(
			'GET',
			'/v1/rooms.info',
			jest.fn().mockResolvedValue({ room: { _id: 'room-1', customFields: { firmPracticeAreas: ['personal-injury'] } } }),
		)
		.withEndpoint('GET', '/v1/teams.members', members ?? jest.fn().mockResolvedValue({ members: [], total: 0, count: 0, offset: 0 }))
		.withEndpoint('GET', '/v1/firms.invites.list', jest.fn().mockResolvedValue({ invites: [] }))
		.withEndpoint('GET', '/v1/firms.domains.list', jest.fn().mockResolvedValue({ domains: [] }))
		.build();

describe('FirmConsolePage', () => {
	it('shows an owner the management sections', async () => {
		render(<FirmConsolePage />, { wrapper: buildRoot() });

		expect(await screen.findByText('Firm_Invites')).toBeInTheDocument();
		expect(screen.getByText('Firm_Domains')).toBeInTheDocument();
		expect(screen.getByText('Firm_QR_Title')).toBeInTheDocument();
		expect(screen.queryByText('Firm_Console_Readonly_Notice')).not.toBeInTheDocument();
	});

	it('gives a non-owner the read-only half rather than controls that would fail', async () => {
		const mine = jest.fn().mockResolvedValue({ enabled: true, firm: memberFirm });
		render(<FirmConsolePage />, { wrapper: buildRoot({ mine }) });

		// The firm and its roster still render — a member is not shown a dead end.
		expect(await screen.findByText('Firm_Console_Readonly_Notice')).toBeInTheDocument();
		expect(screen.getByText('Members')).toBeInTheDocument();
		expect(screen.getByText('Smith & Co')).toBeInTheDocument();

		// ...but the owner/admin-only endpoints are never even offered.
		expect(screen.queryByText('Firm_Invites')).not.toBeInTheDocument();
		expect(screen.queryByText('Firm_Domains')).not.toBeInTheDocument();
		expect(screen.queryByText('Firm_QR_Title')).not.toBeInTheDocument();
	});

	it('surfaces a failure to load the firm instead of rendering nothing', async () => {
		const mine = jest.fn().mockRejectedValue(new Error('error-not-allowed'));
		render(<FirmConsolePage />, { wrapper: buildRoot({ mine }) });

		expect(await screen.findByText('Firm_Console_Load_Failed')).toBeInTheDocument();
		expect(screen.getByText('error-not-allowed')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	it('explains itself when the user has no firm', async () => {
		const mine = jest.fn().mockResolvedValue({ enabled: true, firm: null });
		render(<FirmConsolePage />, { wrapper: buildRoot({ mine }) });

		expect(await screen.findByText('Firm_Console_No_Firm')).toBeInTheDocument();
	});

	it('explains itself when self-serve firms are switched off', async () => {
		const mine = jest.fn().mockResolvedValue({ enabled: false, firm: null });
		render(<FirmConsolePage />, { wrapper: buildRoot({ mine }) });

		expect(await screen.findByText('Firm_Console_Disabled')).toBeInTheDocument();
	});

	it('renders the roster with each member’s role', async () => {
		const members = jest.fn().mockResolvedValue({
			members: [
				{ user: { _id: 'u1', username: 'jane', name: 'Jane Smith' }, roles: ['owner'], createdBy: { _id: 'u1' }, createdAt: new Date() },
				{ user: { _id: 'u2', username: 'john', name: 'John Doe' }, roles: ['member'], createdBy: { _id: 'u1' }, createdAt: new Date() },
			],
			total: 2,
			count: 2,
			offset: 0,
		});
		render(<FirmConsolePage />, { wrapper: buildRoot({ members }) });

		expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
		expect(screen.getByText('John Doe')).toBeInTheDocument();
		expect(screen.getByText('Owner')).toBeInTheDocument();
		expect(screen.getByText('Firm_Member_Role_member')).toBeInTheDocument();
	});

	it('keeps the page up when the roster fails to load', async () => {
		const members = jest.fn().mockRejectedValue(new Error('team-does-not-exist'));
		render(<FirmConsolePage />, { wrapper: buildRoot({ members }) });

		expect(await screen.findByText('Firm_Members_Load_Failed')).toBeInTheDocument();
		// The rest of the console is unaffected — the section boundary contained it.
		expect(screen.getByText('Firm_Invites')).toBeInTheDocument();
	});
});
