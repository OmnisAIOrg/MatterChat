/**
 * Keep the first-run Setup Wizard skipped in OmnisAI-auth mode.
 *
 * Why this exists: `server/startup/cloudRegistration.ts` re-sets `Show_Setup_Wizard` back to
 * 'in_progress' on every boot whenever the workspace is NOT registered with Rocket.Chat Cloud
 * (which an OmnisAI deployment never is). That silently defeats the deployment's
 * `OVERWRITE_SETTING_Show_Setup_Wizard=completed` env var — the env applies the value at boot,
 * then cloud-registration immediately reverts it. The visible symptom: the first-run wizard takes
 * over the unauthenticated screen, so the normal login form — and with it the "Sign in with
 * OmnisAI" button — disappears, and regular logins detour through a "create workspace" screen.
 *
 * In OmnisAI mode the stock RC setup wizard is never the right flow: OIDC IS the login, and the
 * first OmnisAI user to sign in is auto-promoted to workspace admin (see loginHandler.ts). So we
 * hold the wizard at 'completed'.
 *
 * Defense in depth — three independent mechanisms, all gated on OmnisAI mode so a vanilla
 * MatterChat keeps stock wizard behavior:
 *
 *   1. `settings.watch` — fires once with the current value when settings become ready, then on
 *      every change, so any revert (whenever it happens, from any instance) is reacted to.
 *
 *   2. A `Meteor.startup` FORCE-set — `Meteor.startup` callbacks run AFTER all server modules
 *      finish loading. The cloud-registration flip happens during `server/startup/index.ts`'s
 *      `startup()`, which is awaited at top level in `server/main.ts` BEFORE Meteor signals
 *      startup. So this force-set is guaranteed to run after the boot-time flip and win the race
 *      regardless of module-load ordering.
 *
 *   3. Timed re-assertions over the first ~60s (5s/15s/30s/60s). Belt-and-suspenders against any
 *      deferred/async revert or a multi-instance cluster where another node flips it slightly
 *      after our startup hook ran. Cheap: each tick early-returns the instant the value is already
 *      'completed', so steady state is a no-op.
 *
 * No loop: every write path early-returns on `value === 'completed'`, and our own write only
 * re-fires the watcher once (which then sees 'completed' and returns). No log spam: we only write
 * and log when the value was actually NOT 'completed'.
 */
import { Settings } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../../server/lib/logger/system';
import { notifyOnSettingChangedById } from '../../../server/lib/notifyListener';
import { settings } from '../../../server/settings';

function omnisaiModeEnabled(): boolean {
	return Boolean(settings.get('OmnisAI_OIDC_Enabled')) || process.env.OMNISAI_OIDC_ENABLED === 'true';
}

// Re-entrancy guard: our own write re-fires the watcher; combined with the `=== 'completed'`
// early-returns below this guarantees we never write twice for one revert.
let reasserting = false;

/**
 * Force `Show_Setup_Wizard` back to 'completed' iff it isn't already. Idempotent and quiet:
 * reads current value first and returns without writing/logging when it's already 'completed'.
 * `reason` only colors the log line on an actual revert.
 */
async function forceSetupWizardCompleted(reason: string): Promise<void> {
	if (!omnisaiModeEnabled()) {
		return; // vanilla MatterChat: leave the stock first-run wizard alone
	}
	if (reasserting) {
		return;
	}

	reasserting = true;
	try {
		// Read-before-write so a steady state (already 'completed') is a pure no-op: no Mongo write,
		// no notify, no log. This is what keeps the timed ticks from being spammy.
		const current = await Settings.getValueById('Show_Setup_Wizard');
		if (current === 'completed') {
			return;
		}

		const { modifiedCount } = await Settings.updateValueById('Show_Setup_Wizard', 'completed');
		if (modifiedCount) {
			// Broadcast so connected clients (the login screen) and other instances pick it up live.
			void notifyOnSettingChangedById('Show_Setup_Wizard');
			SystemLogger.info({
				msg: 'OmnisAI mode: re-asserted Show_Setup_Wizard=completed (cloud-registration reverts it, which would hide the login screen + the "Sign in with OmnisAI" button)',
				revertedFrom: current,
				via: reason,
			});
		}
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI mode: failed to re-assert Show_Setup_Wizard=completed', err, via: reason });
	} finally {
		reasserting = false;
	}
}

// (1) Reactive watcher: fires once with the current value when settings become ready, then on
// every change — including the boot-time revert from cloudRegistration — so this is immune to
// startup ordering. The early-return on 'completed' (inside forceSetupWizardCompleted) stops the
// watcher from looping on our own write.
settings.watch('Show_Setup_Wizard', (value) => {
	if (value === 'completed') {
		return; // fast path: nothing to do, and avoids re-entering on our own write
	}
	void forceSetupWizardCompleted('settings.watch');
});

// (2) + (3) Meteor.startup runs AFTER the awaited boot-time cloudRegistration flip (see header),
// so the force-set here deterministically wins the race even if module-load order put the watcher
// before cloudRegistration. The timed re-assertions then mop up any deferred/multi-instance flip
// over the first ~60s. Each tick early-returns when already 'completed', so this self-terminates
// (the timers fire a fixed number of times and stop) — there is no loop and no steady-state cost.
Meteor.startup(() => {
	void forceSetupWizardCompleted('Meteor.startup');

	for (const delayMs of [5000, 15000, 30000, 60000]) {
		setTimeout(() => {
			void forceSetupWizardCompleted(`reassert+${delayMs}ms`);
		}, delayMs);
	}
});
