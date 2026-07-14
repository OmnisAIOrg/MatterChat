import type { CaseProTransportKind } from './config';
import { resolveCaseProConfig } from './config';
import { instantiateTransport } from './transport';

/**
 * Admin-facing connection status (design §5). A REST endpoint (another zone)
 * calls this — the shape below is a CONTRACT, do not change it without
 * coordinating with the boards admin API.
 */
export type CaseProStatus = {
	enabled: boolean;
	transport: CaseProTransportKind;
	baseUrl: string;
	authMode: string;
	orgId: string;
	reachable: boolean;
	latencyMs?: number;
	error?: string;
};

/** The probe's per-request timeout — a status check must stay cheap. */
const PROBE_TIMEOUT_MS = 2_500;

/**
 * Resolve config + run a cheap live probe (a `matter_stages` query, limit 1,
 * 2.5s wire timeout). The probe always exercises the CONFIGURED transport even
 * when `enabled` is false, so an admin can verify credentials before flipping
 * the switch. Stub → reachable true, latency 0 (nothing to probe).
 */
export async function caseProStatus(): Promise<CaseProStatus> {
	const cfg = resolveCaseProConfig();
	const base = {
		enabled: cfg.enabled,
		transport: cfg.transport,
		baseUrl: cfg.baseUrl,
		authMode: cfg.authMode,
		orgId: cfg.orgId,
	};

	if (cfg.transport === 'stub') {
		return { ...base, reachable: true, latencyMs: 0 };
	}

	// A dedicated short-timeout instance — never the memoized live transport, so a
	// probe can't disturb its lookup caches or long-timeout behavior.
	const probe = instantiateTransport(cfg.transport, cfg, { timeoutMs: PROBE_TIMEOUT_MS });
	const startedAt = Date.now();
	try {
		await probe.query('matter_stages', { limit: 1 });
		return { ...base, reachable: true, latencyMs: Date.now() - startedAt };
	} catch (err) {
		return {
			...base,
			reachable: false,
			latencyMs: Date.now() - startedAt,
			error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
		};
	}
}
