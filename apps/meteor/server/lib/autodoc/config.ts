import type { OmnisProductConfig } from '../omnis/config';
import { readInt, resolveOmnisConfig } from '../omnis/config';

/**
 * AutoDoc connection config. The seven shared connection settings come from
 * `server/lib/omnis/config.ts`; the extras below exist only for auto-processing,
 * which is the one part of this integration that spends money without a human
 * in the loop.
 */

export const AUTODOC_NS = { setting: 'AutoDoc', env: 'AUTODOC' } as const;

export type AutoDocConfig = OmnisProductConfig & {
	/** Seconds between server-side feed polls (the poller clamps to a floor of 5). */
	pollIntervalSeconds: number;
	/** Per-file ceiling for auto-processing, in megabytes. */
	autoProcessMaxMb: number;
	/** Per-channel, per-day auto-process ceiling. */
	autoProcessDailyCap: number;
};

export function resolveAutoDocConfig(): AutoDocConfig {
	return {
		...resolveOmnisConfig(AUTODOC_NS),
		pollIntervalSeconds: readInt('AUTODOC_POLL_INTERVAL', 'AutoDoc_Poll_Interval', 15, 5),
		autoProcessMaxMb: readInt('AUTODOC_AUTO_PROCESS_MAX_MB', 'AutoDoc_Auto_Process_Max_MB', 25, 1),
		autoProcessDailyCap: readInt('AUTODOC_AUTO_PROCESS_DAILY_CAP', 'AutoDoc_Auto_Process_Daily_Cap', 50, 0),
	};
}
