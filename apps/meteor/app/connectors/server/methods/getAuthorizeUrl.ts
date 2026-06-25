/**
 * connectors:getAuthorizeUrl — authenticated Meteor method that mints a provider OAuth authorize
 * URL for the SIGNED-IN user, cookie-free.
 *
 * Why a method (not the `/_teams/oauth/start` route) for the "Connect" button: the route resolves
 * the user from the rc_uid/rc_token cookie, which is fragile for a button-triggered top-level nav
 * (cookie may be SameSite-stripped, or absent on some embeds). This method runs AUTHENTICATED over
 * DDP, so it uses `this.userId` directly — no cookie. The client calls it, then does a full-page
 * redirect to the returned URL. The existing `/_teams/oauth/callback` resolves the user from the
 * parked state (which `buildTeamsAuthorizeUrl` binds to `this.userId`), so the round-trip completes
 * the same way it does for the cookie-based `/start` flow.
 *
 * STANDALONE-SAFE: for 'teams' this throws `teams-not-configured` (a clear, client-readable error)
 * when Teams is disabled or no client secret is configured, so the UI can tell the admin to set the
 * secret + enable Teams. Other providers throw `provider-not-implemented` for now.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3.1.
 */
import type { ExternalProvider } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { buildGoogleAuthorizeUrl } from '../providers/google/routes';
import { buildTeamsAuthorizeUrl } from '../providers/teams/routes';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'connectors:getAuthorizeUrl'(provider: ExternalProvider): Promise<string>;
	}
}

Meteor.methods<ServerMethods>({
	async 'connectors:getAuthorizeUrl'(provider) {
		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'Not authorized', { method: 'connectors:getAuthorizeUrl' });
		}

		if (provider === 'teams') {
			try {
				const { authorizeUrl } = await buildTeamsAuthorizeUrl(this.userId);
				return authorizeUrl;
			} catch (err) {
				// Surface the standalone-safe gate as a clean, client-readable error so the UI can tell
				// the admin to paste the secret + enable Teams.
				if (err instanceof Error && err.message === 'teams-not-configured') {
					throw new Meteor.Error('teams-not-configured', 'Microsoft Teams is not enabled or configured', {
						method: 'connectors:getAuthorizeUrl',
					});
				}
				throw err;
			}
		}

		if (provider === 'google') {
			try {
				const { authorizeUrl } = await buildGoogleAuthorizeUrl(this.userId);
				return authorizeUrl;
			} catch (err) {
				// Surface the standalone-safe gate as a clean, client-readable error so the UI can tell
				// the admin to paste the secret + enable Google Chat.
				if (err instanceof Error && err.message === 'google-not-configured') {
					throw new Meteor.Error('google-not-configured', 'Google Chat is not enabled or configured', {
						method: 'connectors:getAuthorizeUrl',
					});
				}
				throw err;
			}
		}

		// Per-user Slack OAuth (and any other provider) is a later milestone; the rail surfaces Slack
		// via the SlackBridge admin deep-link instead.
		throw new Meteor.Error('provider-not-implemented', `No authorize URL for provider '${provider}'`, {
			method: 'connectors:getAuthorizeUrl',
		});
	},
});
