import { registerAutoDocAutoProcess } from './autoProcess';
import { resolveAutoDocConfig } from './config';
import { startAutoDocFeedPoller } from './feedPoller';
import { SystemLogger } from '../logger/system';

export { resolveAutoDocConfig } from './config';
export { listAutoDocFeed, getAutoDocDocument, submitAutoDocDocument, approveAutoDocDocument, rejectAutoDocDocument } from './client';
export { AUTODOC_FEED_EVENT } from './feedPoller';

/**
 * AutoDoc boot. Both the poller and the auto-process hook are cheap when the
 * integration is off — the poller re-reads `isEnabled()` every tick, and the
 * hook's first gate is `room.matterId && room.autodocAutoProcess === true`.
 * Registering them unconditionally means flipping `AutoDoc_Enabled` on takes
 * effect without a restart.
 */
export function startAutoDoc(): void {
	startAutoDocFeedPoller();
	registerAutoDocAutoProcess();

	const cfg = resolveAutoDocConfig();
	SystemLogger.info({
		msg: 'AutoDoc intake started',
		enabled: cfg.enabled,
		transport: cfg.transport,
	});
}
