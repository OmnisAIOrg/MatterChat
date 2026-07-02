import { defineConfig } from '@playwright/test';

/**
 * Read-only smoke against the LIVE staging deployment.
 * No globalSetup on purpose: the main suite's globalSetup seeds users/settings directly in
 * Mongo — running that against a live environment would be destructive. These specs must
 * never create users, rooms, or messages.
 */
export default defineConfig({
	testDir: '.',
	// verified live 2026-07-01: the login-screen hydration test takes ~29s on staging, so
	// 30s was too tight
	timeout: 60_000,
	retries: 2,
	workers: 1,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'html-report' }]],
	use: {
		baseURL: process.env.STAGING_URL ?? 'https://matterchat.stg-omnisai.io',
		trace: 'retain-on-failure',
	},
});
