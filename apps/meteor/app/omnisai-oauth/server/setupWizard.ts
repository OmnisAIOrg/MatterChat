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
 * We use a `settings.watch` (not a one-shot `Meteor.startup`) deliberately: startup ordering
 * between this app and the cloud-registration migration is not guaranteed, so a one-shot hook
 * could run first and lose the race. Watching reacts to the revert whenever it happens. There is
 * no loop — re-asserting to 'completed' fires the watcher once more, which sees 'completed' and
 * returns. Gated on OmnisAI mode so a vanilla MatterChat keeps stock wizard behavior.
 */
import { Settings } from '@rocket.chat/models';

import { SystemLogger } from '../../../server/lib/logger/system';
import { notifyOnSettingChangedById } from '../../lib/server/lib/notifyListener';
import { settings } from '../../settings/server';

function omnisaiModeEnabled(): boolean {
	return Boolean(settings.get('OmnisAI_OIDC_Enabled')) || process.env.OMNISAI_OIDC_ENABLED === 'true';
}

// Re-entrancy guard: our own write re-fires the watcher; combined with the `=== 'completed'`
// early-return below this guarantees we never write twice for one revert.
let reasserting = false;

async function holdSetupWizardCompleted(value: unknown): Promise<void> {
	if (!omnisaiModeEnabled()) {
		return; // vanilla MatterChat: leave the stock first-run wizard alone
	}
	if (value === 'completed') {
		return; // already skipped — nothing to do (and stops the watcher looping on our own write)
	}
	if (reasserting) {
		return;
	}

	reasserting = true;
	try {
		const { modifiedCount } = await Settings.updateValueById('Show_Setup_Wizard', 'completed');
		if (modifiedCount) {
			// Broadcast so connected clients (the login screen) and other instances pick it up live.
			void notifyOnSettingChangedById('Show_Setup_Wizard');
			SystemLogger.info({
				msg: 'OmnisAI mode: re-asserted Show_Setup_Wizard=completed (cloud-registration reverts it, which would hide the login screen + the "Sign in with OmnisAI" button)',
				revertedFrom: value,
			});
		}
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI mode: failed to re-assert Show_Setup_Wizard=completed', err });
	} finally {
		reasserting = false;
	}
}

// Fires once with the current value when settings become ready, then on every change — including
// the boot-time revert from cloudRegistration — so this is immune to startup ordering.
settings.watch('Show_Setup_Wizard', (value) => {
	void holdSetupWizardCompleted(value);
});
