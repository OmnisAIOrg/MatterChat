import { caseProMode } from './config';

/**
 * "Is a LIVE CasePro transport configured?" — the transport-live gate for
 * anything that would WRITE into CasePro (automation write-backs, card→task
 * push sync). RECONCILED onto the unified config model: live ⇔ the integration
 * is ENABLED (`caseProMode().enabled` — setting-first kill switch) AND the
 * effective transport is not the stub ('native' or 'mcp'). The default stub
 * transport is NOT live — writes against it only touch the in-memory stub
 * store and must stay audit-only in production paths.
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

export function isLiveTransportConfigured(): boolean {
	if (testOverride !== undefined) {
		return testOverride;
	}
	const mode = caseProMode();
	return mode.enabled && mode.transport !== 'stub';
}
