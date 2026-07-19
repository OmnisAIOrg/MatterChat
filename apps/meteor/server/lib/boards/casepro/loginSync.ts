import { callbacks } from '../../../callbacks';
import { pullFromCasePro as pullLeadsFromCasePro } from '../leads';
import { pullFromCasePro as pullMattersFromCasePro } from '../matters';
import { SystemLogger } from '../../logger/system';

/**
 * Debounce state for login sync: tracks the last time a login-triggered sync ran.
 * We skip syncs within 5 minutes of the last one to avoid stampeding under burst
 * logins (e.g. a whole team signing in at once).
 */
let lastLoginSyncAt: Date | null = null;
const SYNC_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * afterValidateLogin hook: trigger background matters+leads sync on user login.
 *
 * Debounced so a burst of logins doesn't stampede the syncs. The sync runs
 * in the background (never blocks login) and always succeeds (errors are
 * logged but don't propagate). Uses the just-logged-in user's uid as the
 * actor for the activity feed.
 *
 * Both syncs are independent: if one fails, the other still runs.
 */
callbacks.add('afterValidateLogin', (login: { user: any }) => {
	const now = new Date();
	if (lastLoginSyncAt && now.getTime() - lastLoginSyncAt.getTime() < SYNC_DEBOUNCE_MS) {
		return;
	}
	lastLoginSyncAt = now;

	// Fire and forget: background sync never blocks login.
	setImmediate(async () => {
		try {
			const uid = login.user._id;
			// Sync both leads and matters in parallel; ignore errors.
			await Promise.all([pullLeadsFromCasePro(uid).catch(() => null), pullMattersFromCasePro(uid).catch(() => null)]);
		} catch (err) {
			// Swallow errors; log only if needed for debugging.
			SystemLogger.debug({ msg: 'boards.casepro.loginSync.failed', err });
		}
	});
});
