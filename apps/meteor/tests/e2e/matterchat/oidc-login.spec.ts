import { expect, test } from '../utils/test';

/**
 * @matterchat OIDC "Sign in with OmnisAI" login smoke.
 *
 * WHY @skip (not flaky-red): the OmnisAI OIDC login is a server-driven PKCE flow
 * (`GET /_omnisai/authorize` → CentralizedAuth consent → `/_omnisai/callback` → one-time token
 * redeemed at `/omnisai/:token`). Exercising it end-to-end needs the app booted with the
 * `OMNISAI_OIDC_*` env pointing at an issuer, and a mock IdP answering discovery + token +
 * userinfo. A mock harness DOES exist (`~/omnis-counsel/mc-mock-oidc.js`, default :9100), but it
 * lives in another repo and is NOT wired into the e2e-gate CI boot (`docker-compose-e2e-gate.yml`
 * boots a plain CE monolith with `TEST_MODE=true` and no OIDC env). Running this without that
 * harness would 502/redirect-loop — a flaky red, not a signal.
 *
 * TO UN-SKIP: in the gate compose, set `OMNISAI_OIDC_ENABLED=true`,
 * `OMNISAI_OIDC_ISSUER=http://mock-oidc:9100`, `OMNISAI_OIDC_CLIENT_ID`/`_SECRET`, and add the
 * mock-oidc service (from `~/omnis-counsel/mc-mock-oidc.js`). Then drop the `test.skip` below.
 * The assertion shape is written out so the flow is ready to run the moment the IdP is present.
 */

test.describe('@matterchat oidc login', () => {
	test.skip(
		process.env.OMNISAI_OIDC_ENABLED !== 'true',
		'OmnisAI OIDC needs a live/mock IdP + OMNISAI_OIDC_* env not present in the e2e-gate CI boot. See file header to un-skip.',
	);

	test('"Sign in with OmnisAI" completes the PKCE flow and lands on /home', async ({ page }) => {
		await page.goto('/');

		// the OIDC login service registers a "Sign in with OmnisAI" button on the login screen
		const omnisaiButton = page.getByRole('button', { name: /OmnisAI/i });
		await expect(omnisaiButton).toBeVisible();
		await omnisaiButton.click();

		// server bounces through /_omnisai/authorize → mock IdP consent → /_omnisai/callback →
		// /omnisai/:token, which redeems the one-time token and navigates home.
		await expect(page).toHaveURL(/\/home/, { timeout: 30_000 });

		// the redeemed session is a real logged-in Meteor user
		await expect(page.locator('#main-content')).toBeVisible();
	});

	test('the /_omnisai/authorize route is reachable when OIDC is enabled', async ({ request }) => {
		// a lightweight guard that the server route exists (redirects to the IdP rather than 404)
		const res = await request.get('/_omnisai/authorize', { maxRedirects: 0 });
		expect([302, 303, 307].includes(res.status())).toBeTruthy();
	});
});

// A tiny always-runs guard so the file is never "0 tests" in a report and the storageState import
// stays meaningful: the OmnisAI login button must NOT appear when OIDC is disabled (the default),
// proving the feature is correctly gated off on a bare CE gate.
test.describe('@matterchat oidc login gating', () => {
	test('with OIDC disabled, no OmnisAI login button is shown on the login screen', async ({ browser }) => {
		test.skip(process.env.OMNISAI_OIDC_ENABLED === 'true', 'only meaningful when OIDC is disabled (the default gate config)');

		// a fresh, logged-out context sees the standard login form with no OmnisAI button
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto('/');
			await expect(page.getByRole('button', { name: /OmnisAI/i })).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});
