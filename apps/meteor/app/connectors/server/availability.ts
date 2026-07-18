import type { ExternalWorkspaceAvailability } from '@rocket.chat/rest-typings';

import { getGoogleConfig, isGoogleConfigured } from './providers/google/config';
import { getSlackConfig, isSlackConfigured } from './providers/slack/config';
import { getTeamsConfig, isTeamsConfigured } from './providers/teams/config';

/**
 * SERVER-side truth for "which connectors can this instance offer?".
 *
 * The client previously gated the "Connect Teams/Google Chat" menu items on the PUBLIC
 * settings only (`useSetting('Teams_Enabled')`), but the server enables Teams via an env
 * fallback too (teams/config.ts: `Teams_Enabled || TEAMS_ENABLED`) — so an env-enabled
 * deployment had a working connector with NO way to reach it from the UI. This helper is
 * the one place that computes availability from the SAME config functions the providers
 * themselves use, env fallbacks included. Exposed via GET /v1/external-workspaces.availability.
 *
 * `enabled` — the connector is switched on (setting or env).
 * `configured` — it also has the credentials to complete an OAuth connect. The UI shows
 * enabled-but-unconfigured providers as "needs setup" instead of hiding them, so the
 * connect surface is discoverable (founder ask: adding Teams/GChat must be self-evident).
 */
export function getConnectorAvailability(): ExternalWorkspaceAvailability {
	return {
		slack: { enabled: getSlackConfig().enabled, configured: isSlackConfigured() },
		teams: { enabled: getTeamsConfig().enabled, configured: isTeamsConfigured() },
		google: { enabled: getGoogleConfig().enabled, configured: isGoogleConfigured() },
	};
}
