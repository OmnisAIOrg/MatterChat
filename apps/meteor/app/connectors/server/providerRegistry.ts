/**
 * providerRegistry — the frozen 'slack' | 'teams' → IChatProvider map.
 *
 * The whole point of the abstraction: callers (REST routes, the future BridgeCore, the rail's
 * server endpoints) ask the registry for a provider by its ExternalProvider key and program
 * against the IChatProvider interface — they NEVER `new SlackProvider()` or branch on provider.
 * Adding a provider later = register one implementation here; no caller changes.
 *
 * Slack, Teams, and Google Chat are all registered with REAL implementations behind these keys;
 * future providers drop in the same way (register one implementation here, no caller changes).
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §1.2.
 */
import type { ExternalProvider } from '@rocket.chat/core-typings';

import type { IChatProvider } from './ChatProvider';
import { GoogleChatProvider } from './providers/GoogleChatProvider';
import { SlackProvider } from './providers/SlackProvider';
import { TeamsProvider } from './providers/TeamsProvider';

class ProviderRegistry {
	private readonly providers = new Map<ExternalProvider, IChatProvider>();

	/** Register (or replace) the implementation for a provider key. */
	register(provider: IChatProvider): void {
		this.providers.set(provider.provider, provider);
	}

	/** Get a provider implementation, or throw if none is registered for the key. */
	get(kind: ExternalProvider): IChatProvider {
		const provider = this.providers.get(kind);
		if (!provider) {
			throw new Error(`No IChatProvider registered for '${kind}'`);
		}
		return provider;
	}

	/** Whether a provider is registered for the key. */
	has(kind: ExternalProvider): boolean {
		return this.providers.has(kind);
	}

	/** All registered provider keys (e.g. to drive the "connect a workspace" picker). */
	list(): ExternalProvider[] {
		return [...this.providers.keys()];
	}
}

/** Singleton registry. Import this everywhere; do not instantiate providers directly. */
export const providerRegistry = new ProviderRegistry();

// Freeze the providers behind their keys. Real implementations replace any stubs in place.
providerRegistry.register(new SlackProvider());
providerRegistry.register(new TeamsProvider());
providerRegistry.register(new GoogleChatProvider());
