import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FirmOnboardingPage from './FirmOnboardingPage';

/**
 * MATTERCHAT: the setup concierge is the first screen a new firm ever sees, and
 * a bug here costs a customer before they have used the product once. These
 * drive the real controls rather than asserting on internals.
 *
 * Endpoint paths are declared in rest-typings, so `withEndpoint` types cleanly.
 */

const templates = {
	practiceAreas: [
		{ id: 'personal-injury', label: 'Personal injury' },
		{ id: 'litigation', label: 'Litigation' },
	],
};

const buildRoot = (overrides?: { create?: jest.Mock; invite?: jest.Mock; templates?: jest.Mock }) => {
	const create = overrides?.create ?? jest.fn().mockResolvedValue({ firm: { firmId: 'f1', name: 'Smith & Co', roomId: 'r1', isOwner: true } });
	const invite = overrides?.invite ?? jest.fn().mockResolvedValue({ sent: ['a@b.com'], invalid: [], inviteUrl: 'https://x/invite/abc' });
	const listTemplates = overrides?.templates ?? jest.fn().mockResolvedValue(templates);

	const root = mockAppRoot()
		.withEndpoint('GET', '/v1/firms.templates', listTemplates)
		.withEndpoint('POST', '/v1/firms.create', create)
		.withEndpoint('POST', '/v1/firms.invite', invite)
		.build();

	return { root, create, invite, listTemplates };
};

describe('FirmOnboardingPage', () => {
	it('blocks the first step until the firm name is long enough', async () => {
		const { root } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));

		expect(await screen.findByText('Firm_name_too_short')).toBeInTheDocument();
		// Still on step one — the practice-area heading has not appeared.
		expect(screen.queryByText('Firm_areas_title')).not.toBeInTheDocument();
	});

	it('walks name → practice areas → create, sending the selected areas', async () => {
		const { root, create } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));

		expect(await screen.findByText('Firm_areas_title')).toBeInTheDocument();
		await userEvent.click(await screen.findByLabelText('Personal injury'));
		await userEvent.click(screen.getByRole('button', { name: 'Firm_create_action' }));

		await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Smith & Co', practiceAreas: ['personal-injury'] }));
	});

	it('creates with no practice areas when none are chosen', async () => {
		const { root, create } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Solo Practice');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Firm_create_action' }));

		await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Solo Practice', practiceAreas: [] }));
	});

	it('deselects an area when its checkbox is clicked twice', async () => {
		const { root, create } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));

		const checkbox = await screen.findByLabelText('Litigation');
		await userEvent.click(checkbox);
		await userEvent.click(checkbox);
		await userEvent.click(screen.getByRole('button', { name: 'Firm_create_action' }));

		await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Smith & Co', practiceAreas: [] }));
	});

	it('keeps the typed name when stepping back', async () => {
		const { root } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Firm_onboarding_back' }));

		expect(screen.getByRole('textbox')).toHaveValue('Smith & Co');
	});

	it('surfaces a create failure instead of advancing', async () => {
		const create = jest.fn().mockRejectedValue(new Error('error-already-in-firm'));
		const { root } = buildRoot({ create });
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Firm_create_action' }));

		expect(await screen.findByText('error-already-in-firm')).toBeInTheDocument();
		expect(screen.queryByText('Firm_invite_subtitle')).not.toBeInTheDocument();
	});

	it('still lets a firm be created when practice areas fail to load', async () => {
		// A template-fetch failure must not block signup.
		const templatesFail = jest.fn().mockRejectedValue(new Error('boom'));
		const { root, create } = buildRoot({ templates: templatesFail });
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));

		expect(await screen.findByText('Firm_areas_unavailable')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Firm_create_action' }));

		await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Smith & Co', practiceAreas: [] }));
	});

	it('reaches the invite step and sends the entered addresses', async () => {
		const { root, invite } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Firm_create_action' }));

		const textarea = await screen.findByRole('textbox');
		await userEvent.type(textarea, 'jane@firm.com, john@firm.com');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_invite_send_action' }));

		await waitFor(() => expect(invite).toHaveBeenCalledWith({ emails: ['jane@firm.com', 'john@firm.com'] }));
	});

	it('does not call the invite endpoint when no addresses are entered', async () => {
		const { root, invite } = buildRoot();
		render(<FirmOnboardingPage />, { wrapper: root });

		await userEvent.type(screen.getByRole('textbox'), 'Smith & Co');
		await userEvent.click(screen.getByRole('button', { name: 'Firm_onboarding_continue' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Firm_create_action' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Firm_invite_send_action' }));

		await waitFor(() => expect(invite).not.toHaveBeenCalled());
	});
});
