import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { IndexQueueDeps, IndexQueueFlushResult } from '../../../../../../server/lib/chi/search/indexQueue';
import { SearchIndexQueue } from '../../../../../../server/lib/chi/search/indexQueue';

const T0 = Date.parse('2026-08-15T12:00:00.000Z');

type Harness = {
	queue: SearchIndexQueue;
	calls: string[];
	errors: { context: string; err: unknown }[];
	/** Rooms whose next flush should reject; the entry is consumed by that flush. */
	failNext: Set<string>;
	/** Rooms whose next flush reports a capped pass (more history behind it). */
	moreNext: Set<string>;
};

const makeHarness = (options: ConstructorParameters<typeof SearchIndexQueue>[1] = {}): Harness => {
	const calls: string[] = [];
	const errors: Harness['errors'] = [];
	const failNext = new Set<string>();
	const moreNext = new Set<string>();
	const deps: IndexQueueDeps = {
		async flushRoom(rid): Promise<IndexQueueFlushResult> {
			calls.push(rid);
			if (failNext.has(rid)) {
				failNext.delete(rid);
				throw new Error(`boom-${rid}`);
			}
			const more = moreNext.has(rid);
			moreNext.delete(rid);
			return { indexed: 1, more };
		},
		onError(context, err) {
			errors.push({ context, err });
		},
	};
	return { queue: new SearchIndexQueue(deps, options), calls, errors, failNext, moreNext };
};

describe('chi search index queue', () => {
	describe('the hot path', () => {
		it('does no work beyond tracking the room', async () => {
			const h = makeHarness();
			h.queue.noteMessageSaved('room-1', T0);
			expect(h.calls).to.deep.equal([]);
			expect(h.queue.pendingRooms()).to.deep.equal(['room-1']);
			expect(h.queue.stats()).to.deep.include({ rooms: 1, pending: 1, dropped: 0 });
		});

		it('flushes early once a room reaches maxBatch', async () => {
			const h = makeHarness({ maxBatch: 3 });
			h.queue.noteMessageSaved('room-1', T0);
			h.queue.noteMessageSaved('room-1', T0);
			expect(h.calls).to.deep.equal([]);
			h.queue.noteMessageSaved('room-1', T0);
			// The size-triggered flush is fire-and-forget; let the microtask queue drain.
			await Promise.resolve();
			await Promise.resolve();
			expect(h.calls).to.deep.equal(['room-1']);
		});

		it('turns rooms away at the ceiling instead of evicting a tracked one', () => {
			const h = makeHarness({ maxTrackedRooms: 2 });
			h.queue.noteMessageSaved('room-1', T0);
			h.queue.noteMessageSaved('room-2', T0);
			h.queue.noteMessageSaved('room-3', T0);
			h.queue.noteMessageSaved('room-4', T0);
			expect(h.queue.pendingRooms()).to.deep.equal(['room-1', 'room-2']);
			expect(h.queue.stats().dropped).to.equal(2);
		});

		it('still counts messages for a room already tracked at the ceiling', () => {
			const h = makeHarness({ maxTrackedRooms: 1 });
			h.queue.noteMessageSaved('room-1', T0);
			h.queue.noteMessageSaved('room-1', T0);
			expect(h.queue.stats()).to.deep.include({ rooms: 1, pending: 2, dropped: 0 });
		});
	});

	describe('flushDue', () => {
		it('leaves a freshly-dirtied room alone until the interval elapses', async () => {
			const h = makeHarness({ flushIntervalMs: 60_000 });
			h.queue.noteMessageSaved('room-1', T0);
			await h.queue.flushDue(T0 + 30_000);
			expect(h.calls).to.deep.equal([]);
			await h.queue.flushDue(T0 + 60_000);
			expect(h.calls).to.deep.equal(['room-1']);
		});

		it('forgets a room once its backlog is drained', async () => {
			const h = makeHarness({ flushIntervalMs: 1000 });
			h.queue.noteMessageSaved('room-1', T0);
			await h.queue.flushDue(T0 + 1000);
			expect(h.queue.pendingRooms()).to.deep.equal([]);
		});

		it('drains oldest-dirty first, so a chatty room cannot starve a quiet one', async () => {
			const h = makeHarness({ flushIntervalMs: 1000, maxRoomsPerTick: 2 });
			h.queue.noteMessageSaved('busy', T0 + 500);
			h.queue.noteMessageSaved('quiet', T0);
			h.queue.noteMessageSaved('middle', T0 + 200);
			await h.queue.flushDue(T0 + 5000);
			expect(h.calls).to.deep.equal(['quiet', 'middle']);
		});

		it('honours the per-tick provider budget', async () => {
			const h = makeHarness({ flushIntervalMs: 1000, maxRoomsPerTick: 2 });
			['a', 'b', 'c', 'd'].forEach((rid) => h.queue.noteMessageSaved(rid, T0));
			await h.queue.flushDue(T0 + 5000);
			expect(h.calls).to.have.lengthOf(2);
			await h.queue.flushDue(T0 + 5000);
			expect(h.calls).to.have.lengthOf(4);
			expect([...h.calls].sort()).to.deep.equal(['a', 'b', 'c', 'd']);
		});

		it('keeps a room queued when the pass hit its message cap', async () => {
			const h = makeHarness({ flushIntervalMs: 1000 });
			h.queue.noteMessageSaved('room-1', T0);
			h.moreNext.add('room-1');
			await h.queue.flushDue(T0 + 1000);
			expect(h.queue.pendingRooms()).to.deep.equal(['room-1']);
			await h.queue.flushDue(T0 + 1000);
			expect(h.calls).to.deep.equal(['room-1', 'room-1']);
			expect(h.queue.pendingRooms()).to.deep.equal([]);
		});

		it('keeps messages that arrive mid-flush', async () => {
			const h = makeHarness({ flushIntervalMs: 1000 });
			h.queue.noteMessageSaved('room-1', T0);
			const flushing = h.queue.flushRoom('room-1', T0 + 1000);
			h.queue.noteMessageSaved('room-1', T0 + 1001);
			await flushing;
			expect(h.queue.stats()).to.deep.include({ rooms: 1, pending: 1 });
		});
	});

	describe('failure', () => {
		it('backs a room off rather than dropping its work', async () => {
			const h = makeHarness({ flushIntervalMs: 1000, baseBackoffMs: 10_000 });
			h.queue.noteMessageSaved('room-1', T0);
			h.failNext.add('room-1');
			await h.queue.flushDue(T0 + 1000);
			expect(h.errors).to.have.lengthOf(1);
			expect(h.queue.pendingRooms()).to.deep.equal(['room-1']);

			// Inside the backoff window: nothing.
			await h.queue.flushDue(T0 + 5000);
			expect(h.calls).to.have.lengthOf(1);

			// Past it: retried, and this time it succeeds.
			await h.queue.flushDue(T0 + 12_000);
			expect(h.calls).to.deep.equal(['room-1', 'room-1']);
			expect(h.queue.pendingRooms()).to.deep.equal([]);
		});

		it('doubles the backoff on repeated failure, up to the cap', async () => {
			const h = makeHarness({ flushIntervalMs: 1000, baseBackoffMs: 1000, maxBackoffMs: 3000 });
			h.queue.noteMessageSaved('room-1', T0);

			h.failNext.add('room-1');
			await h.queue.flushDue(T0 + 1000); // fails → backoff 1000, next at 2000
			h.failNext.add('room-1');
			await h.queue.flushDue(T0 + 2000); // fails → backoff 2000, next at 4000
			await h.queue.flushDue(T0 + 3000); // still inside the window
			expect(h.calls).to.have.lengthOf(2);

			h.failNext.add('room-1');
			await h.queue.flushDue(T0 + 4000); // fails → backoff capped at 3000, next at 7000
			await h.queue.flushDue(T0 + 6000);
			expect(h.calls).to.have.lengthOf(3);
			await h.queue.flushDue(T0 + 7000);
			expect(h.calls).to.have.lengthOf(4);
		});

		it('never lets a size-triggered flush fire inside a backoff window', async () => {
			const h = makeHarness({ maxBatch: 2, flushIntervalMs: 1000, baseBackoffMs: 60_000 });
			h.queue.noteMessageSaved('room-1', T0);
			h.failNext.add('room-1');
			await h.queue.flushRoom('room-1', T0);
			expect(h.calls).to.have.lengthOf(1);

			h.queue.noteMessageSaved('room-1', T0 + 1);
			h.queue.noteMessageSaved('room-1', T0 + 2);
			await Promise.resolve();
			await Promise.resolve();
			expect(h.calls).to.have.lengthOf(1);
		});
	});

	describe('resumeRoom', () => {
		it('makes a room due on the very next tick', async () => {
			const h = makeHarness({ flushIntervalMs: 60_000 });
			h.queue.resumeRoom('room-1', T0);
			await h.queue.flushDue(T0);
			expect(h.calls).to.deep.equal(['room-1']);
		});

		it('respects the ceiling', () => {
			const h = makeHarness({ maxTrackedRooms: 1 });
			h.queue.resumeRoom('room-1', T0);
			h.queue.resumeRoom('room-2', T0);
			expect(h.queue.pendingRooms()).to.deep.equal(['room-1']);
			expect(h.queue.stats().dropped).to.equal(1);
		});
	});

	it('does not run two flushes for the same room concurrently', async () => {
		const h = makeHarness({ flushIntervalMs: 1000 });
		h.queue.noteMessageSaved('room-1', T0);
		const first = h.queue.flushRoom('room-1', T0 + 1000);
		const second = h.queue.flushRoom('room-1', T0 + 1000);
		await Promise.all([first, second]);
		expect(h.calls).to.deep.equal(['room-1']);
	});
});
