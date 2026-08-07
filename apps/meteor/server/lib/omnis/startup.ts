import { startAutoDoc } from '../autodoc';
import { startCaseNotes } from '../casenotes';
import { ensureDocumentTypes } from '../omnisproof/documentTypes';
import { SystemLogger } from '../logger/system';

/**
 * Boot for the Omnis product widgets. Side-effecting on import — registered
 * from `server/hooks/index.ts`, the same way the CasePro comms-log lane is.
 *
 * Everything here is cheap when the products are off:
 *   - the pollers re-read `isEnabled()` every tick, so nothing is fetched;
 *   - AutoDoc's message hook returns immediately unless the room is
 *     matter-linked AND auto-processing is explicitly on;
 *   - the OmnisProof document-type seed is a handful of `$setOnInsert` upserts.
 *
 * Registering unconditionally is what lets an admin flip `<Product>_Enabled` on
 * and have it take effect without a server restart.
 */
try {
	startAutoDoc();
	startCaseNotes();
	// Seeded eagerly so the send panel's type list is populated the first time
	// anyone opens it, rather than on first read.
	void ensureDocumentTypes();
} catch (err) {
	// A failure here must never stop the server booting — these are additive
	// product surfaces, not core chat.
	SystemLogger.error({ msg: 'Omnis widgets failed to start', err });
}
