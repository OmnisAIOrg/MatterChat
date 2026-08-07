import { OmnisFeedPoller } from './feedPoller';
import type { OmnisFeedItem } from './feedPoller';

const notifyUser = jest.fn();

jest.mock('@rocket.chat/models', () => ({
	Users: { find: jest.fn(() => ({ toArray: jest.fn(async () => [{ _id: 'u1' }]) })) },
}));

jest.mock('../notifications/core/lib/Notifications', () => ({
	__esModule: true,
	default: { notifyUser: (...args: unknown[]) => notifyUser(...args) },
}));

jest.mock('../authorization/hasPermission', () => ({
	hasPermissionAsync: jest.fn(async () => true),
}));

jest.mock('../logger/system', () => ({ SystemLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

type Item = OmnisFeedItem;

const item = (id: string, changedAt: string): Item => ({ id, changedAt });

const makePoller = (fetchFeed: () => Promise<Item[]>) =>
	new OmnisFeedPoller<Item>({
		product: 'Test',
		event: 'test-feed',
		viewPermission: 'view-document-queue',
		intervalSeconds: () => 5,
		isEnabled: () => true,
		fetchFeed,
	});

beforeEach(() => {
	notifyUser.mockClear();
});

describe('diff', () => {
	it('reports a brand-new item as changed', () => {
		const poller = makePoller(async () => []);
		expect(poller.diff([item('a', '1')]).changed.map((i) => i.id)).toEqual(['a']);
	});

	it('reports an item whose change marker moved', () => {
		const poller = makePoller(async () => []);
		poller.seed([item('a', '1')]);

		expect(poller.diff([item('a', '2')]).changed.map((i) => i.id)).toEqual(['a']);
	});

	it('does NOT report an item whose change marker is unchanged', () => {
		const poller = makePoller(async () => []);
		poller.seed([item('a', '1')]);

		expect(poller.diff([item('a', '1')]).changed).toEqual([]);
	});

	it('reports ids that vanished from the feed', () => {
		const poller = makePoller(async () => []);
		poller.seed([item('a', '1'), item('b', '1')]);

		expect(poller.diff([item('a', '1')]).removed).toEqual(['b']);
	});
});

describe('tick', () => {
	it('emits nothing on the FIRST successful poll — it only establishes the baseline', async () => {
		// Otherwise every server restart would flash the entire feed as "just
		// changed" to every user holding the view permission.
		const poller = makePoller(async () => [item('a', '1'), item('b', '1')]);
		await poller.tick();

		expect(notifyUser).not.toHaveBeenCalled();
	});

	it('emits the delta on a subsequent poll', async () => {
		let feed: Item[] = [item('a', '1')];
		const poller = makePoller(async () => feed);

		await poller.tick(); // baseline
		feed = [item('a', '2')];
		await poller.tick();

		expect(notifyUser).toHaveBeenCalledTimes(1);
		const [uid, event, payload] = notifyUser.mock.calls[0] as [string, string, { changed: Item[]; removed: string[] }];
		expect(uid).toBe('u1');
		expect(event).toBe('test-feed');
		expect(payload.changed.map((i) => i.id)).toEqual(['a']);
	});

	it('does not emit twice for the same unchanged item', async () => {
		const feed = [item('a', '1')];
		const poller = makePoller(async () => feed);

		await poller.tick(); // baseline
		await poller.tick();
		await poller.tick();

		expect(notifyUser).not.toHaveBeenCalled();
	});

	it('keeps the last known state when a poll fails, and emits nothing', async () => {
		let shouldFail = false;
		let feed: Item[] = [item('a', '1')];
		const poller = makePoller(async () => {
			if (shouldFail) {
				throw new Error('upstream down');
			}
			return feed;
		});

		await poller.tick(); // baseline: a@1

		shouldFail = true;
		await poller.tick(); // must not throw, must not emit
		expect(notifyUser).not.toHaveBeenCalled();

		// Recovery with the SAME data must still be silent. If the failure had
		// cleared the cache, a transient outage would look to the user like every
		// item had just been re-processed.
		shouldFail = false;
		feed = [item('a', '1')];
		await poller.tick();
		expect(notifyUser).not.toHaveBeenCalled();
	});

	it('does not poll at all while the product is disabled', async () => {
		const fetchFeed = jest.fn(async () => [item('a', '1')]);
		const poller = new OmnisFeedPoller<Item>({
			product: 'Test',
			event: 'test-feed',
			viewPermission: 'view-document-queue',
			intervalSeconds: () => 5,
			isEnabled: () => false,
			fetchFeed,
		});

		await poller.tick();
		expect(fetchFeed).not.toHaveBeenCalled();
	});
});
