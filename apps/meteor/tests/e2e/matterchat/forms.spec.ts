import { faker } from '@faker-js/faker';

import { Users } from '../fixtures/userStates';
import { expect, test } from '../utils/test';
import { archiveBoard, createBoard, createList, getCards } from './fixtures/boards-api';

/**
 * @matterchat Forms — public intake form → card on the target list.
 *
 * We create the form via `boards.forms.create` (API-seed; the FormsManager UI is exercised
 * separately by the API harness), grab its public slug, then load `/form/<slug>` in a
 * LOGGED-OUT browser context (no storageState — proving the public route needs no auth), fill
 * and submit it, and assert a card with the templated title lands on the target list.
 */

test.describe.serial('@matterchat forms', () => {
	// admin context to seed the form + read cards back
	test.use({ storageState: Users.admin.state });

	let boardId: string;
	let targetListId: string;
	let slug: string;
	const applicant = `Jane ${faker.string.alpha(6)}`;

	test.beforeAll(async ({ api }) => {
		boardId = await createBoard(api, `Intake ${faker.string.uuid()}`);
		targetListId = await createList(api, boardId, 'New leads');
		const res = await api.post('/boards.forms.create', {
			boardId,
			targetListId,
			title: 'Client intake',
			description: 'Tell us about your matter',
			titleTemplate: 'Intake — {{name}}',
			fields: [
				{ id: 'name', label: 'Name', type: 'text', required: true },
				{ id: 'source', label: 'How did you hear about us?', type: 'select', options: ['Referral', 'Web', 'Other'] },
				{ id: 'email', label: 'Email', type: 'email' },
			],
		});
		const json = await res.json();
		slug = json?.form?.slug;
		expect(typeof slug).toBe('string');
		expect(slug.length).toBeGreaterThanOrEqual(40);
	});

	test.afterAll(async ({ api }) => {
		if (boardId) {
			await archiveBoard(api, boardId);
		}
	});

	test('a logged-out visitor can submit the public form and it creates a card', async ({ browser, api }) => {
		// fresh context with NO storageState → truly logged out
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto(`/form/${slug}`);

			// the public page renders the form title + fields (inputs are id=bf-<fieldId>)
			await expect(page.getByRole('heading', { name: 'Client intake' })).toBeVisible();
			await page.locator('#bf-name').fill(applicant);
			await page.locator('#bf-source').selectOption('Referral');
			await page.locator('#bf-email').fill('jane@example.com');

			await page.getByRole('button', { name: 'Submit' }).click();

			// success confirmation renders in-place (no auth, no redirect)
			await expect(page.getByText('your submission has been received', { exact: false })).toBeVisible();
		} finally {
			await context.close();
		}

		// the submission created a card with the templated title on the target list
		await expect
			.poll(async () => (await getCards(api, boardId)).find((c) => c.title === `Intake — ${applicant}`)?.listId, {
				timeout: 15_000,
			})
			.toBe(targetListId);
	});
});
