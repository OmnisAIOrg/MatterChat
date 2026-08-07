import { Meteor } from 'meteor/meteor';

import * as Mailer from '../../lib/notifications/email/api';
import { settings } from '../../settings';
import { SystemLogger } from '../../lib/logger/system';

/**
 * MATTERCHAT: Branded "Welcome to MatterChat" email for self-registered users.
 *
 * Stock Rocket.Chat sends a welcome/enrollment email only for admin-created users. We send this to
 * every self-signup (in addition to the verification email) so new users get a friendly, branded
 * confirmation that their account is live. Gated by the MatterChat_Welcome_Email_Enabled setting.
 *
 * The template HTML is watched off the MatterChat_Welcome_Email setting and inlined with the shared
 * email CSS (Mailer.getTemplate), exactly like app/lib/server/functions/saveUser/sendUserEmail.ts.
 */
let welcomeHtml = '';
Meteor.startup(() => {
	Mailer.getTemplate('MatterChat_Welcome_Email', (template) => {
		welcomeHtml = template;
	});
});

export async function sendMatterChatWelcomeEmail(userData: { email: string; name?: string }): Promise<void> {
	if (!userData.email) {
		return;
	}

	if (!settings.get<boolean>('MatterChat_Welcome_Email_Enabled')) {
		return;
	}

	if (!welcomeHtml) {
		// Template not cached yet (e.g. very early boot). Non-fatal — skip rather than send an empty body.
		SystemLogger.warn({ msg: 'Skipping MatterChat welcome email: template not ready', to: userData.email });
		return;
	}

	const email = {
		to: userData.email,
		from: settings.get<string>('From_Email'),
		subject: settings.get<string>('MatterChat_Welcome_Email_Subject') || 'Welcome to MatterChat',
		html: welcomeHtml,
		data: {
			name: userData.name?.trim() || 'there',
			email: userData.email,
		},
	};

	try {
		await Mailer.send(email);
	} catch (error) {
		// Non-fatal: a failed welcome email must never block or roll back registration.
		SystemLogger.error({ msg: 'Failed to send MatterChat welcome email', to: userData.email, err: error });
	}
}
