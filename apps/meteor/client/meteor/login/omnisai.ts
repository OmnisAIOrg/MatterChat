import { Meteor } from 'meteor/meteor';

import { type LoginCallback, callLoginMethod, handleLogin } from '../../lib/2fa/overrideLoginMethod';
import { isDesktopApp, openAuthorizeUrl } from '../../lib/desktop/desktopBridge';

declare module 'meteor/meteor' {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Meteor {
		function loginWithOmnisaiToken(credentialToken: string, callback?: LoginCallback): void;

		function loginWithOmnisai(): void;
	}
}

// Kicks off the server-driven PKCE OIDC flow (see app/omnisai-oauth/server).
//
// DESKTOP (spec §A.5): pass `?client=desktop` so the server returns via `matterchat://login?token=…`,
// and open the authorize URL in the SYSTEM browser (CentralizedAuth consent must not run in an
// embedded webview). The desktop deep-link handler (startup/desktopDeepLink) finishes login in-window.
// WEB/PWA: a normal full-page navigation to the authorize endpoint — unchanged.
Meteor.loginWithOmnisai = () => {
	if (isDesktopApp()) {
		openAuthorizeUrl(Meteor.absoluteUrl('_omnisai/authorize?client=desktop'));
		return;
	}
	window.location.href = '_omnisai/authorize';
};

const loginWithOmnisaiToken = (credentialToken: string) =>
	callLoginMethod({
		methodArguments: [
			{
				omnisai: true,
				credentialToken,
			},
		],
	});

const loginWithOmnisaiTokenAndTOTP = (credentialToken: string, code: string) =>
	callLoginMethod({
		methodArguments: [
			{
				totp: {
					login: {
						omnisai: true,
						credentialToken,
					},
					code,
				},
			},
		],
	});

Meteor.loginWithOmnisaiToken = handleLogin(loginWithOmnisaiToken, loginWithOmnisaiTokenAndTOTP);
