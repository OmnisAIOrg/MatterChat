import { resolveAutoDocConfig } from './config';
import { autoDocTransport } from './transport';
import type { AutoDocDocument } from './transport';
import { OmnisFeedPoller } from '../omnis/feedPoller';
import type { OmnisFeedItem } from '../omnis/feedPoller';

/**
 * AutoDoc's feed poller — one per workspace.
 *
 * AutoDoc stamps every document with `status_changed_at` specifically to make
 * this diff cheap, so that field is the change marker. Clients never poll: the
 * widget updates the moment OCR finishes rather than up to one interval later.
 *
 * Event name is `autodoc-feed`; clients subscribe to `${uid}/autodoc-feed` over
 * the existing notify-user stream and only users holding `view-document-queue`
 * are sent anything.
 */

export const AUTODOC_FEED_EVENT = 'autodoc-feed';

type AutoDocFeedDelta = OmnisFeedItem & { document: AutoDocDocument };

function toFeedItem(document: AutoDocDocument): AutoDocFeedDelta {
	return { id: document.id, changedAt: document.status_changed_at, document };
}

export const autoDocFeedPoller = new OmnisFeedPoller<AutoDocFeedDelta>({
	product: 'AutoDoc',
	event: AUTODOC_FEED_EVENT,
	viewPermission: 'view-document-queue',
	intervalSeconds: () => resolveAutoDocConfig().pollIntervalSeconds,
	isEnabled: () => resolveAutoDocConfig().enabled,
	async fetchFeed() {
		const cfg = resolveAutoDocConfig();
		const { items } = await autoDocTransport(cfg).listFeed();
		return items.map(toFeedItem);
	},
});

/** Started at boot from `server/lib/autodoc/index.ts`. */
export function startAutoDocFeedPoller(): void {
	autoDocFeedPoller.start();
}
