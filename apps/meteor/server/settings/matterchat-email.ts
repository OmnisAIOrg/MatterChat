import { settingsRegistry } from '.';
import { WELCOME_BODY } from '../omnis/email/theme';

/**
 * MATTERCHAT: New-user onboarding email settings.
 *
 * Stock Rocket.Chat only auto-sends a *verification* email on self-registration. We add a branded
 * "Welcome to MatterChat" email that goes out to every self-registered user (see
 * server/omnis/email/matterchatWelcomeEmail.ts, called from server/methods/registerUser.ts).
 *
 * - MatterChat_Welcome_Email_Enabled : master switch (on by default). Turn off to suppress the
 *                                      welcome email without a redeploy.
 * - MatterChat_Welcome_Email_Subject : email subject line.
 * - MatterChat_Welcome_Email         : HTML body. Supports the mailer's variables:
 *                                      [Site_URL], [Site_Name] and [name] (the new user's name).
 *                                      Rendered inside the shared Email_Header/Email_Footer wrapper.
 *
 * These live in their OWN settings module (registered in server/settings/index.ts) so they merge
 * clean across upstream Rocket.Chat updates — no in-place edit to the stock email settings.
 */
export const createMatterChatEmailSettings = () =>
	settingsRegistry.addGroup('Email', async function () {
		await this.section('MatterChat_Onboarding', async function () {
			await this.add('MatterChat_Welcome_Email_Enabled', true, {
				type: 'boolean',
				public: false,
				i18nLabel: 'MatterChat_Welcome_Email_Enabled',
				i18nDescription: 'MatterChat_Welcome_Email_Enabled_Description',
			});

			await this.add('MatterChat_Welcome_Email_Subject', 'Welcome to MatterChat', {
				type: 'string',
				public: false,
				i18nLabel: 'Subject',
			});

			await this.add('MatterChat_Welcome_Email', WELCOME_BODY, {
				type: 'code',
				code: 'text/html',
				multiline: true,
				public: false,
				i18nLabel: 'Body',
			});
		});
	});
