import { Settings } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../lib/logger/system';

/**
 * MATTERCHAT: De-brand the stock account emails.
 *
 * Stock Rocket.Chat's enrollment, admin-welcome and invitation email bodies all hardcode the
 * variable {Visit_Site_Url_and_try_the_best_open_source_chat_solution_available_today}, which renders
 * as "...try the best open source chat solution available today!" — Rocket.Chat marketing copy that
 * has no place in a MatterChat onboarding email.
 *
 * Rather than edit the stock i18n defaults or the core email settings (both merge-hostile), we
 * override the stored setting VALUE at startup, only when it still contains the Rocket.Chat marker.
 * This is:
 *   - idempotent — after the swap the marker is gone, so a re-run is a no-op;
 *   - admin-safe — if an admin has already customised the body (marker removed), we don't touch it;
 *   - live — Settings.updateValueById propagates through the settings change stream, so the mailer
 *     re-caches the branded template without a restart.
 */
const RC_MARKER = '{Visit_Site_Url_and_try_the_best_open_source_chat_solution_available_today}';

const BRANDED_COPY =
	"Your account is ready — MatterChat is your team's secure hub for messaging, boards, and Chi, your built-in AI assistant.";

const TEMPLATE_SETTINGS = ['Accounts_Enrollment_Email', 'Accounts_UserAddedEmail_Email', 'Invitation_Email'];

export function applyMatterChatEmailBranding(): void {
	Meteor.startup(async () => {
		for (const settingId of TEMPLATE_SETTINGS) {
			try {
				const setting = await Settings.findOneById(settingId, { projection: { value: 1 } });
				const value = setting?.value;

				if (typeof value === 'string' && value.includes(RC_MARKER)) {
					await Settings.updateValueById(settingId, value.split(RC_MARKER).join(BRANDED_COPY));
					SystemLogger.info({ msg: 'MatterChat: rebranded account email template', setting: settingId });
				}
			} catch (err) {
				SystemLogger.error({ msg: 'MatterChat: failed to rebrand account email template', setting: settingId, err });
			}
		}
	});
}
