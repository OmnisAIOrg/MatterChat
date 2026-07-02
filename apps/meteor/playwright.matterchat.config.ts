import type { PlaywrightTestConfig } from '@playwright/test';

import baseConfig from './playwright.config';
import { EE_ONLY_SPECS, EXTERNAL_DEPENDENCY_SPECS, SMOKE_SPECS } from './tests/e2e/matterchat-suites';

/**
 * MatterChat fork config for the e2e regression net (.github/workflows/e2e-gate.yml).
 *
 * Two projects over the upstream suite (spec lists live in tests/e2e/matterchat-suites.ts):
 *   --project=smoke     fast pre-merge tier (every PR to `staging`)
 *   --project=mit-core  full curated suite valid on the MIT/CE fork (workflow_dispatch)
 *
 * Everything else (globalSetup, timeouts, tracing, browser flags) is inherited from the
 * upstream playwright.config.ts. Reporters are overridden: the upstream Qase/Jira/Rocket.Chat
 * reporters point at rocket.chat's infrastructure, which we don't use.
 */

const ignoreGlobs = [...EE_ONLY_SPECS, ...EXTERNAL_DEPENDENCY_SPECS].map((spec) => `**/${spec}`);

export default {
	...baseConfig,
	// upstream's 40min globalTimeout is sized for a 6-way sharded run; the unsharded
	// mit-core tier needs hours. Harmless for smoke (per-test timeout still applies).
	globalTimeout: 5 * 60 * 60 * 1000,
	// upstream aborts after 5 failures in CI — right for a merge gate, wrong for a full
	// audit run. E2E_MAX_FAILURES=0 disables the cap (the e2e-gate workflow sets it for
	// `full` dispatch runs).
	maxFailures: process.env.E2E_MAX_FAILURES ? parseInt(process.env.E2E_MAX_FAILURES, 10) || undefined : baseConfig.maxFailures,
	reporter: [
		['list'],
		// NOTE: must live OUTSIDE outputDir (tests/e2e/.playwright), otherwise the HTML
		// reporter's directory gets cleared and Playwright warns about artifact loss.
		['html', { open: 'never', outputFolder: 'tests/e2e/.playwright-html' }],
	],
	projects: [
		{
			name: 'mit-core',
			testIgnore: ignoreGlobs,
		},
		{
			name: 'smoke',
			testMatch: SMOKE_SPECS.map((spec) => `**/${spec}`),
		},
	],
} as PlaywrightTestConfig;
