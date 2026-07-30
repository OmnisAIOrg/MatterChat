import { Settings } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../lib/logger/system';
import { PRIVACY_POLICY_TEMPLATE, TERMS_OF_SERVICE_TEMPLATE } from './tosTemplates';

/**
 * MATTERCHAT: known-good settings corrections, applied at startup (2026-07-30 audit findings).
 *
 * Semantics per fix — every one is conditional so a deliberate admin change is respected:
 *
 * 1. OIDC signups: `Accounts_Registration_AuthenticationServices_Enabled=false` while
 *    `OmnisAI_OIDC_Enabled=true` blocks account CREATION through "Sign in with OmnisAI" — a new
 *    firm admin clicking the SSO button dead-ends. That combination is the accidental state found
 *    on prod; it is corrected (loudly logged) whenever observed. If the founder ever wants
 *    OIDC-login-without-OIDC-signup, disable this guard by customising this file.
 * 2. CasePro_Web_URL: trim stray whitespace (prod had a leading space, breaking deep links).
 *    Always safe, naturally idempotent.
 * 3. Two-factor: prod had the 2FA framework on but NO usable method (TOTP and email 2FA both
 *    off) — weak posture for a legal product. TOTP is enabled ONLY when no method is available;
 *    if an admin later disables TOTP while email 2FA exists, that choice sticks.
 * 4. ToS/Privacy: replace Rocket.Chat's stock "Go to APP SETTINGS → Layout..." placeholders with
 *    real MatterChat templates (tosTemplates.ts) ONLY while the stored value still contains the
 *    stock placeholder — admin/counsel versions are never overwritten.
 */

const getString = async (id: string): Promise<string | undefined> => {
	const setting = await Settings.findOneById(id, { projection: { value: 1 } });
	return typeof setting?.value === 'string' ? setting.value : undefined;
};

const getBool = async (id: string): Promise<boolean | undefined> => {
	const setting = await Settings.findOneById(id, { projection: { value: 1 } });
	return typeof setting?.value === 'boolean' ? setting.value : undefined;
};

export function applyMatterChatConfigFixes(): void {
	Meteor.startup(async () => {
		try {
			// 1. OIDC account creation must work while OmnisAI OIDC is the front door.
			if ((await getBool('OmnisAI_OIDC_Enabled')) === true && (await getBool('Accounts_Registration_AuthenticationServices_Enabled')) === false) {
				await Settings.updateValueById('Accounts_Registration_AuthenticationServices_Enabled', true);
				SystemLogger.warn(
					'MatterChat config fix: Accounts_Registration_AuthenticationServices_Enabled was false while OmnisAI OIDC is enabled — new users could not sign up via SSO. Enabled.',
				);
			}

			// 2. Trim malformed CasePro_Web_URL.
			const caseproUrl = await getString('CasePro_Web_URL');
			if (caseproUrl && caseproUrl !== caseproUrl.trim()) {
				await Settings.updateValueById('CasePro_Web_URL', caseproUrl.trim());
				SystemLogger.warn('MatterChat config fix: trimmed whitespace from CasePro_Web_URL.');
			}

			// 3. Ensure at least one usable 2FA method when the framework is on.
			if (
				(await getBool('Accounts_TwoFactorAuthentication_Enabled')) === true &&
				(await getBool('Accounts_TwoFactorAuthentication_By_TOTP_Enabled')) === false &&
				(await getBool('Accounts_TwoFactorAuthentication_By_Email_Enabled')) === false
			) {
				await Settings.updateValueById('Accounts_TwoFactorAuthentication_By_TOTP_Enabled', true);
				SystemLogger.warn('MatterChat config fix: 2FA framework was on with no usable method — enabled TOTP.');
			}

			// 4. Air-gap countdown tombstone: the EE code that updated this setting is gone, so the
			// last-written value is frozen in Mongo (9-10 days at removal time). The client banner
			// treats any NEGATIVE value as fully unrestricted (useAirGappedRestriction.ts), so pin -1
			// once and the banner class of issue is permanently closed.
			const remaining = await Settings.findOneById('Cloud_Workspace_AirGapped_Restrictions_Remaining_Days', { projection: { value: 1 } });
			if (typeof remaining?.value === 'number' && remaining.value >= 0) {
				await Settings.updateValueById('Cloud_Workspace_AirGapped_Restrictions_Remaining_Days', -1);
				SystemLogger.warn('MatterChat config fix: pinned the orphaned air-gap countdown setting to -1 (unrestricted).');
			}

			// 5. Real ToS/Privacy while the stock placeholder is still being served.
			const STOCK_PLACEHOLDER = 'APP SETTINGS';
			const tos = await getString('Layout_Terms_of_Service');
			if (tos?.includes(STOCK_PLACEHOLDER)) {
				await Settings.updateValueById('Layout_Terms_of_Service', TERMS_OF_SERVICE_TEMPLATE);
				SystemLogger.warn('MatterChat config fix: replaced stock Terms of Service placeholder with the MatterChat template.');
			}
			const privacy = await getString('Layout_Privacy_Policy');
			if (privacy?.includes(STOCK_PLACEHOLDER)) {
				await Settings.updateValueById('Layout_Privacy_Policy', PRIVACY_POLICY_TEMPLATE);
				SystemLogger.warn('MatterChat config fix: replaced stock Privacy Policy placeholder with the MatterChat template.');
			}
		} catch (err) {
			SystemLogger.error({ msg: 'MatterChat config fixes failed (non-fatal)', err });
		}
	});
}
