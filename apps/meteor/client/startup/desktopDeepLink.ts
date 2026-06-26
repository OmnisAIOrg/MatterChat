/**
 * Desktop deep-link handler — completes the `matterchat://` OAuth/SSO hand-off inside the renderer.
 *
 * When the MatterChat desktop shell (Electron) runs an OAuth/SSO flow it opens the SYSTEM browser
 * (Microsoft/Google block embedded-webview OAuth — spec §A.4) and the server returns to the app via
 * the `matterchat://` custom scheme. The OS hands that URL to the running app, whose preload bridge
 * forwards it to this renderer via `window.matterchatDesktop.onDeepLink`. This module turns those
 * deep-links into the right finishing action:
 *
 *   matterchat://oauth/<provider>?status=ok|error[&reason=…]
 *       → a connector OAuth finished. Refresh the workspace rail (invalidate the
 *         `external-workspaces.list` query so the new tile appears) + show a toast. NO token is on the
 *         URL — only a status (spec §A.4).
 *   matterchat://login?token=<credentialToken>
 *       → OmnisAI SSO finished. Redeem the single-use credential token into a real Meteor session
 *         (the same path the web `/omnisai/:token` route uses), then go home (spec §A.5).
 *   matterchat://login?status=error&reason=…
 *       → SSO failed before a token could be minted; surface the reason.
 *
 * NO-OP on web/PWA: `onDesktopDeepLink` returns a no-op unsubscribe when the bridge is absent, so
 * importing this at startup is harmless in the browser (it just never fires).
 *
 * Clean-room: uses only the public client surface already in this repo (the singleton queryClient,
 * Meteor.loginWithOmnisaiToken, the dispatched toast event). Nothing under apps/meteor/ee/ was read.
 */
import { Meteor } from 'meteor/meteor';

import '../meteor/login'; // ensure Meteor.loginWithOmnisaiToken is defined before a deep-link arrives
import { onDesktopDeepLink } from '../lib/desktop/desktopBridge';
import { queryClient } from '../lib/queryClient';
import { dispatchToastMessage } from '../lib/toast';

/** Refresh the org-switcher rail so a freshly connected external workspace tile appears. */
function refreshWorkspaceRail(): void {
	// Same query key the rail's useExternalWorkspaces() subscribes to.
	void queryClient.invalidateQueries({ queryKey: ['external-workspaces.list'] });
}

function handleConnectorDeepLink(params: URLSearchParams, provider: string): void {
	const status = params.get('status');
	if (status === 'ok') {
		refreshWorkspaceRail();
		dispatchToastMessage({ type: 'success', message: `Connected ${provider}.` });
		return;
	}
	const reason = params.get('reason') || 'unknown_error';
	dispatchToastMessage({ type: 'error', message: `Could not connect ${provider} (${reason}).` });
}

function handleLoginDeepLink(params: URLSearchParams): void {
	const token = params.get('token');
	if (token) {
		// Redeem the one-time credential token into a real Meteor session, then go home — mirrors the
		// in-app /omnisai/:token route (OmnisAILoginRoute).
		Meteor.loginWithOmnisaiToken(token, (error?: unknown) => {
			if (error) {
				dispatchToastMessage({ type: 'error', message: error });
				return;
			}
			window.location.replace('/home');
		});
		return;
	}
	const reason = params.get('reason') || 'unknown_error';
	dispatchToastMessage({ type: 'error', message: `Could not sign in (${reason}).` });
}

onDesktopDeepLink(({ url }) => {
	try {
		// `matterchat://oauth/<provider>?...` and `matterchat://login?...`. The URL constructor parses
		// custom schemes; for `matterchat://oauth/teams` the host is `oauth` and the path is `/teams`.
		const parsed = new URL(url);
		if (parsed.protocol !== 'matterchat:') {
			return;
		}
		const params = parsed.searchParams;
		if (parsed.host === 'oauth') {
			const provider = parsed.pathname.replace(/^\/+/, '') || 'workspace';
			handleConnectorDeepLink(params, provider);
			return;
		}
		if (parsed.host === 'login') {
			handleLoginDeepLink(params);
		}
	} catch {
		// Malformed deep-link — ignore (never throw out of the bridge callback).
	}
});
