import { Settings } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../lib/logger/system';
import {
	EMAIL_HEADER,
	EMAIL_FOOTER,
	EMAIL_STYLE,
	THEME_VERSION,
	THEMED_BODIES,
	REPLACEABLE_SIGNATURES,
	shouldApplyTheme,
} from './theme';

/**
 * MATTERCHAT: apply the high-end MatterChat email theme (see ./theme.ts).
 *
 * Stock Rocket.Chat account emails render in a plain, blue, Rocket.Chat-branded shell. We replace the
 * email chrome (Email_Header / Email_Footer / email_style) and the per-template bodies (verification,
 * forgot-password, enrollment, admin-welcome, invitation, plus our welcome email) with the branded
 * versions, so every onboarding email looks like the MatterChat product.
 *
 * Applied at startup via Settings.updateValueById, which propagates through the settings change
 * stream so the mailer re-caches the templates without a restart. It is:
 *   - idempotent   — each themed value carries the THEME_VERSION sentinel; a re-run is a no-op;
 *   - upgradeable  — an older mc-email-theme-* value is replaced with the current one;
 *   - admin-safe   — a value an admin has customised (no stock signature, no theme marker) is left
 *                    untouched, and a message is logged instead.
 */
async function maybeApply(settingId: string, value: string, signatures: string[]): Promise<void> {
	const setting = await Settings.findOneById(settingId, { projection: { value: 1 } });
	const current = typeof setting?.value === 'string' ? setting.value : undefined;

	if (!shouldApplyTheme(current, signatures)) {
		if (current && !current.includes(THEME_VERSION)) {
			SystemLogger.info({ msg: 'MatterChat email theme: skipping admin-customised setting', setting: settingId });
		}
		return;
	}

	await Settings.updateValueById(settingId, value);
	SystemLogger.info({ msg: 'MatterChat email theme: applied', setting: settingId });
}

export function applyMatterChatEmailTheme(): void {
	Meteor.startup(async () => {
		try {
			// The shell (header/footer/style) is applied as ONE gated unit, keyed on the Email_Header
			// value: apply all three only if the header is still stock (or an older theme) — never over
			// an admin-customised header — and skip entirely once the current theme is in place.
			const header = await Settings.findOneById('Email_Header', { projection: { value: 1 } });
			const headerValue = typeof header?.value === 'string' ? header.value : undefined;
			if (shouldApplyTheme(headerValue, ['If you delete this tag'])) {
				await Settings.updateValueById('Email_Header', EMAIL_HEADER);
				await Settings.updateValueById('Email_Footer', EMAIL_FOOTER);
				await Settings.updateValueById('email_style', EMAIL_STYLE);
				SystemLogger.info({ msg: 'MatterChat email theme: applied shell (header/footer/style)' });
			} else if (headerValue && !headerValue.includes(THEME_VERSION)) {
				SystemLogger.info({ msg: 'MatterChat email theme: skipping admin-customised email shell' });
			}

			// Per-template bodies.
			for (const [settingId, body] of Object.entries(THEMED_BODIES)) {
				await maybeApply(settingId, body, REPLACEABLE_SIGNATURES[settingId] ?? []);
			}
		} catch (err) {
			SystemLogger.error({ msg: 'MatterChat email theme: failed to apply', err });
		}
	});
}
