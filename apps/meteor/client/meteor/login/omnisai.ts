import { Meteor } from 'meteor/meteor';

import { type LoginCallback, callLoginMethod, handleLogin } from '../../lib/2fa/overrideLoginMethod';

declare module 'meteor/meteor' {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Meteor {
		function loginWithOmnisaiToken(credentialToken: string, callback?: LoginCallback): void;

		function loginWithOmnisai(): void;
	}
}

// Kicks off the server-driven PKCE OIDC flow (see app/omnisai-oauth/server).
Meteor.loginWithOmnisai = () => {
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
