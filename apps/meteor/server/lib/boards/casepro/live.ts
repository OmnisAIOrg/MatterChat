import type { SettingValue } from '@rocket.chat/core-typings';

import { settings } from '../../../../app/settings/server';

/**
 * "Is a LIVE CasePro transport configured?" — the transport-live gate for
 * anything that would WRITE into CasePro (automation write-backs, card→task
 * push sync). Mirrors the selection rule in transport.ts
 * `resolveTransportFromConfig` WITHOUT touching the transport/client
 * internals (owned by the auth-wire lane): live ⇔ the 'rest' transport is
 * explicitly chosen (env `CASEPRO_TRANSPORT` or setting `CasePro_Transport`)
 * AND a base URL is present (env `CASEPRO_BASE_URL` or setting
 * `CasePro_Base_URL`). The default stub transport is NOT live — writes
 * against it must stay audit-only in production paths.
 *
 * Tests (and only tests) may force the answer via
 * {@link __forceLiveTransportForTests} so harness cases can exercise the
 * execute path against an injected StubTransport.
 */

let testOverride: boolean | undefined;

/** Test hook: force the live-transport answer (pass undefined to restore config). */
export function __forceLiveTransportForTests(value?: boolean): void {
	testOverride = value;
}

/** settings.get throws when the setting isn't registered yet (early boot / tests). */
function safeGetSetting<T extends SettingValue>(id: string): T | undefined {
	try {
		return settings.get<T>(id);
	} catch {
		return undefined;
	}
}

export function isLiveTransportConfigured(): boolean {
	if (testOverride !== undefined) {
		return testOverride;
	}
	const choice = (process.env.CASEPRO_TRANSPORT || safeGetSetting<string>('CasePro_Transport') || 'stub').toLowerCase();
	if (choice !== 'rest') {
		return false;
	}
	const baseUrl = process.env.CASEPRO_BASE_URL || safeGetSetting<string>('CasePro_Base_URL') || '';
	return Boolean(baseUrl);
}
