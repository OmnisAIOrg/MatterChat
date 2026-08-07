import { UserStatus } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { SystemLogger } from '../logger/system';
import notifications from '../notifications/core/lib/Notifications';
import { hasPermissionAsync } from '../authorization/hasPermission';

/**
 * Shared server-side feed poller — "realtime, not polling" from the widget spec.
 *
 * MatterChat already has websockets, so clients must NOT poll. One poller per
 * workspace fetches the product feed, diffs it, and pushes only the deltas over
 * the existing notify-user stream to the users holding the product's view
 * permission.
 *
 * ### Why a server poller and not a webhook
 *
 * Polling server-side keeps the dependency one-directional (MatterChat knows
 * about AutoDoc; AutoDoc needs no knowledge of MatterChat) and runs ONE poller
 * per workspace instead of one per open browser tab. The trade-off accepted: a
 * webhook would be lower-latency with fewer moving parts, at the cost of
 * coupling the product to MatterChat's existence and adding a second auth
 * direction.
 *
 * ### The diff key
 *
 * Products stamp every item with a monotonic change marker (AutoDoc's is
 * `status_changed_at`, and it exists specifically to make this diff cheap). An
 * item is a delta when it is new, or when its marker moved.
 *
 * ### Error policy
 *
 * A failed poll is a READ failure: log once per interval and KEEP THE LAST
 * KNOWN STATE. Clearing the cache on error would emit the entire feed as
 * "changed" on the next successful poll, and — worse — a transient outage would
 * look to the user like every document had just been re-processed.
 */

export type OmnisFeedItem = {
	id: string;
	/** Monotonic change marker. Any value whose string form changes on update. */
	changedAt: string;
	[key: string]: unknown;
};

/**
 * The notify-user events this poller may emit.
 *
 * A literal union, not `string`: `notifyUser` is generic over the stream keys
 * declared in `packages/ddp-client/src/types/streams.ts`, so a widened `string`
 * collapses its payload parameter to `never`. Adding a product here means
 * adding its key there too — which is the correct coupling, since a client
 * cannot subscribe to a key the typings don't know about.
 */
export type OmnisFeedEvent = 'autodoc-feed' | 'casenotes-feed';

export type OmnisPollerOptions<T extends OmnisFeedItem> = {
	/** Product name, used in log lines. */
	product: string;
	/** notify-user event. Clients subscribe to `${uid}/${event}`. */
	event: OmnisFeedEvent;
	/** Only users holding this permission receive deltas. */
	viewPermission: string;
	/** Seconds between polls. Clamped to a floor of 5 by {@link startOmnisPoller}. */
	intervalSeconds: () => number;
	/** False = don't poll at all (product disabled). Re-checked every tick. */
	isEnabled: () => boolean;
	/** Fetch the current feed. Throwing is fine — the poller keeps the last state. */
	fetchFeed: () => Promise<T[]>;
};

const MIN_INTERVAL_SECONDS = 5;

export class OmnisFeedPoller<T extends OmnisFeedItem> {
	/** id → changedAt of the last successfully fetched feed. */
	private lastSeen = new Map<string, string>();

	private timer: NodeJS.Timeout | undefined;

	private running = false;

	/** True once a poll has succeeded — the first success must not spam every item as a delta. */
	private primed = false;

	constructor(private readonly options: OmnisPollerOptions<T>) {}

	/** Deltas in `items` versus the last known state, and the ids that vanished. */
	diff(items: T[]): { changed: T[]; removed: string[] } {
		const changed: T[] = [];
		const nextIds = new Set<string>();

		for (const item of items) {
			nextIds.add(item.id);
			const previous = this.lastSeen.get(item.id);
			if (previous === undefined || previous !== item.changedAt) {
				changed.push(item);
			}
		}

		const removed: string[] = [];
		for (const id of this.lastSeen.keys()) {
			if (!nextIds.has(id)) {
				removed.push(id);
			}
		}

		return { changed, removed };
	}

	/** Adopt `items` as the new known state. */
	private commit(items: T[]): void {
		this.lastSeen = new Map(items.map((item) => [item.id, item.changedAt]));
	}

	/** One poll cycle. Exported behaviour: never throws. */
	async tick(): Promise<void> {
		if (!this.options.isEnabled()) {
			return;
		}

		let items: T[];
		try {
			items = await this.options.fetchFeed();
		} catch (err) {
			// Read failure: keep the last known state. See the error policy above.
			SystemLogger.warn({ msg: `${this.options.product} feed poll failed — keeping last known state`, err });
			return;
		}

		const { changed, removed } = this.diff(items);
		const wasPrimed = this.primed;
		this.primed = true;
		this.commit(items);

		// First successful poll only establishes the baseline. Emitting it would
		// flash the entire feed as "just changed" on every server restart.
		if (!wasPrimed) {
			return;
		}
		if (changed.length === 0 && removed.length === 0) {
			return;
		}

		await this.broadcast({ changed, removed });
	}

	private async broadcast(payload: { changed: T[]; removed: string[] }): Promise<void> {
		try {
			const online = await Users.find(
				{ active: { $ne: false }, status: { $ne: UserStatus.OFFLINE } },
				{ projection: { _id: 1 }, limit: 500 },
			).toArray();

			await Promise.all(
				online.map(async (user) => {
					if (!(await hasPermissionAsync(user._id, this.options.viewPermission))) {
						return;
					}
					// `notifyUser` is generic over the concrete stream-key payloads
					// declared in packages/ddp-client. This poller is generic over T,
					// so no single declared payload can match statically even though
					// every instantiation does at runtime — each product's T IS the
					// shape declared for its key. Narrowed at the one call site rather
					// than by loosening the declarations, which would remove the
					// type safety from the clients that consume them.
					(notifications.notifyUser as (uid: string, event: OmnisFeedEvent, args: unknown) => void)(
						user._id,
						this.options.event,
						payload,
					);
				}),
			);
		} catch (err) {
			SystemLogger.warn({ msg: `${this.options.product} feed broadcast failed`, err });
		}
	}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		const schedule = (): void => {
			if (!this.running) {
				return;
			}
			const seconds = Math.max(this.options.intervalSeconds(), MIN_INTERVAL_SECONDS);
			this.timer = setTimeout(() => {
				void this.tick().finally(schedule);
			}, seconds * 1000);
		};
		schedule();
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	/** Test seam. */
	seed(items: T[]): void {
		this.commit(items);
		this.primed = true;
	}
}

/** Construct and start a poller. Returns it so callers can stop it in tests. */
export function startOmnisPoller<T extends OmnisFeedItem>(options: OmnisPollerOptions<T>): OmnisFeedPoller<T> {
	const poller = new OmnisFeedPoller(options);
	poller.start();
	return poller;
}
