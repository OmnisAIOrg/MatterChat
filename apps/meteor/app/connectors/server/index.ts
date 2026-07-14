/**
 * Server entry for the external-workspace connectors foundation.
 *
 * Importing this module constructs the providerRegistry (freezing the 'slack' | 'teams' →
 * ChatProvider map with the current stub implementations). The REST surface lives under
 * apps/meteor/app/api/server/v1/external-workspaces.ts and is wired through the api index.
 *
 * Public surface (for the parallel build streams to import against):
 *   - ChatProvider interface + supporting types  ('./ChatProvider')
 *   - providerRegistry                            ('./providerRegistry')
 *   - tokenCrypto (encrypt/decrypt credentials)   ('./tokenCrypto')
 *   - connectionService (per-user lifecycle)      ('./connectionService')
 *
 * It also registers the authenticated Meteor methods (`./methods`) the client rail calls to begin a
 * connect flow cookie-free (e.g. `connectors:getAuthorizeUrl`).
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md.
 */
import { Meteor } from 'meteor/meteor';

import './providerRegistry';
import './methods';
// Live message bridge: mounts /_connectors/teams/{webhook,lifecycle} (validation handshake +
// fail-closed clientState verification; inert until TEAMS_WEBHOOK_CLIENT_STATE_SECRET is set).
import './providers/teams/webhook';
// Slack live message bridge: mounts /_slack/events (url_verification handshake + fail-closed
// signing-secret verification; inert until Slack_Signing_Secret / SLACK_SIGNING_SECRET is set).
import './providers/slack/events';
import { startBridgeRuntime } from './bridge/bridgeService';

export type * from './ChatProvider';
export { providerRegistry } from './providerRegistry';
export * from './tokenCrypto';
export * from './connectionService';
export * from './bridge/bridgeService';

// Boot the bridge runtime: registers the outbound afterSaveMessage mirror and starts the
// subscription reconcile/renewal loop (renew at ~T-12h; recreate dropped subs; close gaps).
Meteor.startup(() => {
	startBridgeRuntime();
});
