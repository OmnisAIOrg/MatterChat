import { expect, test } from '@playwright/test';

/**
 * Post-deploy smoke for https://matterchat.stg-omnisai.io (override with STAGING_URL).
 *
 * STRICTLY READ-ONLY: these run against the LIVE staging workspace. No logins, no user
 * creation, no messages, no settings changes — only unauthenticated GETs and rendering
 * the login screen.
 */

test.describe('staging post-deploy smoke (read-only)', () => {
	test('API /api/info responds with a version', async ({ request }) => {
		const response = await request.get('/api/info');
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.version).toBeTruthy();
	});

	test('liveness probe /livez responds', async ({ request }) => {
		const response = await request.get('/livez');
		expect(response.status()).toBe(200);
	});

	test('public settings API responds', async ({ request }) => {
		const response = await request.get('/api/v1/settings.public');
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(Array.isArray(body.settings)).toBe(true);
	});

	test('login screen renders in a browser', async ({ page }) => {
		await page.goto('/');
		// the SPA should hydrate into the login route with a form (regular login and/or
		// the "Sign in with OmnisAI" OIDC button)
		await expect(page.locator('form')).toBeVisible({ timeout: 20_000 });
		await expect(
			page.getByRole('button', { name: /login|sign in/i }).first(),
		).toBeVisible();
	});
});
