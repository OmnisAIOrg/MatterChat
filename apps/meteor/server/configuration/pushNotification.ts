import { getWorkspaceAccessToken } from '../lib/cloud';
import { Push } from '../lib/notifications/push';
// MATTERCHAT: pure resolver that picks between certificate (.p12/PEM) and token (.p8) APNs auth.
import type { ApnAuthConfig } from '../lib/notifications/push/apnConfig';
import { resolveApnConfig } from '../lib/notifications/push/apnConfig';
import type { ICachedSettings } from '../settings/CachedSettings';

export async function configurePushNotifications(settings: ICachedSettings): Promise<void> {
	settings.watch<boolean>('Push_enable', async (enabled) => {
		if (!enabled) {
			await Push.unconfigure();
			return;
		}
		const gateways =
			settings.get('Push_enable_gateway') && settings.get('Register_Server') && settings.get('Cloud_Service_Agree_PrivacyTerms')
				? settings.get<string>('Push_gateway').split('\n')
				: undefined;

		let apn: ApnAuthConfig;
		let gcm:
			| {
					apiKey: string;
					projectNumber: string;
			  }
			| undefined;

		//  TODO: this part of the code should be refactored as the deprecated GCM methods are no longer being used and FCM is preferred.
		if (!gateways) {
			gcm = {
				apiKey: 'TO_BE_REFACTORED',
				projectNumber: 'TO_BE_REFACTORED',
			};

			// MATTERCHAT: env-first with graceful degradation — PUSH_APN_* env vars win over the
			// admin settings, and incomplete credentials leave `apn` undefined (APNs simply off).
			// All the branching lives in the pure `resolveApnConfig` so it is unit-testable.
			apn = resolveApnConfig({
				authType: process.env.PUSH_APN_AUTH_TYPE || settings.get<string>('Push_APN_Auth_Type'),
				production: settings.get('Push_production') === true,
				passphrase: settings.get<string>('Push_apn_passphrase'),
				key: settings.get<string>('Push_apn_key'),
				cert: settings.get<string>('Push_apn_cert'),
				devPassphrase: settings.get<string>('Push_apn_dev_passphrase'),
				devKey: settings.get<string>('Push_apn_dev_key'),
				devCert: settings.get<string>('Push_apn_dev_cert'),
				tokenKey: process.env.PUSH_APN_TOKEN_KEY || settings.get<string>('Push_APN_Token_Key'),
				tokenKeyId: process.env.PUSH_APN_TOKEN_KEY_ID || settings.get<string>('Push_APN_Token_Key_ID'),
				teamId: process.env.PUSH_APN_TEAM_ID || settings.get<string>('Push_APN_Team_ID'),
				bundleId: process.env.PUSH_APN_BUNDLE_ID || settings.get<string>('Push_APN_Bundle_ID'),
			});

			if (!gcm.apiKey || gcm.apiKey.trim() === '' || !gcm.projectNumber || gcm.projectNumber.trim() === '') {
				gcm = undefined;
			}
		}

		Push.configure({
			apn,
			gcm,
			production: settings.get('Push_production'),
			gateways,
			uniqueId: settings.get('uniqueID'),
			async getAuthorization() {
				return `Bearer ${await getWorkspaceAccessToken()}`;
			},
		});
	});
}
