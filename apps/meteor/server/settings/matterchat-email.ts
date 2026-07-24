import { settingsRegistry } from '../../app/settings/server';

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

			await this.add(
				'MatterChat_Welcome_Email',
				[
					'<h2>Welcome to MatterChat</h2>',
					'<p>Hi [name], your MatterChat account is ready to go.</p>',
					"<p>MatterChat is your team's secure home for messaging, boards, and Chi — your built-in AI assistant. Sign in any time to pick up right where your team left off.</p>",
					'<a class="btn" target="_blank" href="[Site_URL]">Open MatterChat</a>',
					"<p class=\"advice\">If you didn't create this account, you can safely ignore this email.</p>",
				].join(''),
				{
					type: 'code',
					code: 'text/html',
					multiline: true,
					public: false,
					i18nLabel: 'Body',
				},
			);
		});
	});
