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
import './providerRegistry';
import './methods';

export type * from './ChatProvider';
export { providerRegistry } from './providerRegistry';
export * from './tokenCrypto';
export * from './connectionService';
