import type { CommsLogBatcherDeps, CommsLogMessage, CommsLogRoomTarget } from './batcher';
import { CommsLogBatcher, DEFAULT_FLUSH_INTERVAL_MS, DEFAULT_MAX_BATCH } from './batcher';

const T0 = Date.parse('2026-07-01T12:00:00.000Z');

const msg = (id: string, offsetMs: number, text = `text-${id}`): CommsLogMessage & { ts: Date } => ({
	message_id: id,
	sender_name: `sender-${id}`,
	sent_at: new Date(T0 + offsetMs).toISOString(),
	text,
	ts: new Date(T0 + offsetMs),
});

type Harness = {
	batcher: CommsLogBatcher;
	deps: jest.Mocked<CommsLogBatcherDeps>;
	target: CommsLogRoomTarget;
	store: { messages: (CommsLogMessage & { ts: Date })[] };
};

const makeHarness = (targetOverrides: Partial<CommsLogRoomTarget> = {}, options = {}): Harness => {
	const target: CommsLogRoomTarget = {
		rid: 'room-1',
		matterId: 'matter-1',
		channelName: 'doe-v-roe',
		enabled: true,
		cursorTs: null,
		...targetOverrides,
	};
	const store: Harness['store'] = { messages: [] };
	const deps: jest.Mocked<CommsLogBatcherDeps> = {
		getRoomTarget: jest.fn(async (rid) => (rid === target.rid ? { ...target } : null)),
		fetchLoggableMessagesSince: jest.fn(async (_rid, since, limit) =>
			store.messages.filter((m) => m.ts.getTime() > since.getTime()).slice(0, limit),
		),
		postBatch: jest.fn(async (_target, _payload) => undefined),
		setCursor: jest.fn(async (_rid, lastTs, _lastId) => {
			target.cursorTs = lastTs;
		}),
		onError: jest.fn(),
		onInfo: jest.fn(),
	};
	return { batcher: new CommsLogBatcher(deps, options), deps, target, store };
};

describe('CommsLogBatcher — batching & flush triggers', () => {
	it('does not flush a small batch before the flush interval elapses', async () => {
		const { batcher, deps, store } = makeHarness();
		store.messages = [msg('m1', 0)];
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);

		await batcher.flushDue(T0 + 5_000);
		expect(deps.postBatch).not.toHaveBeenCalled();

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);
		expect(deps.postBatch).toHaveBeenCalledTimes(1);
	});

	it('flushes immediately once maxBatch messages are pending', async () => {
		const { batcher, deps, store } = makeHarness();
		store.messages = Array.from({ length: DEFAULT_MAX_BATCH }, (_, i) => msg(`m${i}`, i * 1000));
		for (const m of store.messages) {
			batcher.noteMessageSaved('room-1', { ts: m.ts }, undefined, T0 + 30_000);
		}
		// noteMessageSaved fires the flush asynchronously (void promise) — settle it.
		await new Promise(process.nextTick);
		expect(deps.postBatch).toHaveBeenCalledTimes(1);
		const payload = deps.postBatch.mock.calls[0][1];
		expect(payload.messages).toHaveLength(DEFAULT_MAX_BATCH);
	});

	it('sends the full digest payload shape (matter, channel, chronological messages)', async () => {
		const { batcher, deps, store } = makeHarness();
		store.messages = [msg('m2', 60_000), msg('m1', 30_000)].sort((a, b) => a.ts.getTime() - b.ts.getTime());
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0 + 30_000);
		batcher.noteMessageSaved('room-1', { ts: store.messages[1].ts }, undefined, T0 + 60_000);

		await batcher.flushDue(T0 + 30_000 + DEFAULT_FLUSH_INTERVAL_MS);

		const payload = deps.postBatch.mock.calls[0][1];
		expect(payload.matter_id).toBe('matter-1');
		expect(payload.channel_id).toBe('room-1');
		expect(payload.channel_name).toBe('doe-v-roe');
		expect(payload.messages.map((m: CommsLogMessage) => m.message_id)).toEqual(['m1', 'm2']);
		// The payload never leaks the internal `ts` helper field.
		expect(Object.keys(payload.messages[0]).sort()).toEqual(['message_id', 'sender_name', 'sent_at', 'text']);
	});

	it('rooms without a matter link never reach the batcher (wiring gate) and unknown rooms are dropped', async () => {
		const { batcher, deps } = makeHarness();
		// Simulate a room whose matter link was removed between enqueue and flush.
		deps.getRoomTarget.mockResolvedValue(null);
		batcher.noteMessageSaved('room-1', { ts: new Date(T0) }, undefined, T0);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);

		expect(deps.postBatch).not.toHaveBeenCalled();
		expect(deps.fetchLoggableMessagesSince).not.toHaveBeenCalled();
		expect(batcher.pendingRooms()).toEqual([]);
	});
});

describe('CommsLogBatcher — cursor', () => {
	it('advances the cursor to the last fetched message after a successful flush', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 - 1) });
		store.messages = [msg('m1', 0), msg('m2', 1_000)];
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);

		expect(deps.setCursor).toHaveBeenCalledWith('room-1', store.messages[1].ts, 'm2');
	});

	it('resumes from the persisted cursor after a restart (resumeRoom drains history)', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 + 500) });
		// Two messages arrived while the server was down; m1 was already logged.
		store.messages = [msg('m1', 0), msg('m2', 1_000), msg('m3', 2_000)];

		batcher.resumeRoom('room-1', T0 + 60_000);
		await batcher.flushDue(T0 + 60_000);

		const payload = deps.postBatch.mock.calls[0][1];
		expect(payload.messages.map((m: CommsLogMessage) => m.message_id)).toEqual(['m2', 'm3']);
		expect(deps.setCursor).toHaveBeenCalledWith('room-1', store.messages[2].ts, 'm3');
	});

	it('does not advance the cursor when the POST fails', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 - 1) });
		store.messages = [msg('m1', 0)];
		deps.postBatch.mockRejectedValueOnce(new Error('CasePro down'));
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);

		expect(deps.setCursor).not.toHaveBeenCalled();
		expect(deps.onError).toHaveBeenCalled();
		// The room stays queued for retry — nothing is lost silently.
		expect(batcher.pendingRooms()).toEqual(['room-1']);
	});

	it('a room with no cursor logs from the first observed message, never the room history', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: null });
		// Months of pre-link history…
		store.messages = [msg('old-1', -86_400_000), msg('old-2', -3_600_000), msg('m1', 0)];
		// …but the hook only observed m1.
		batcher.noteMessageSaved('room-1', { ts: store.messages[2].ts }, undefined, T0);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);

		const payload = deps.postBatch.mock.calls[0][1];
		expect(payload.messages.map((m: CommsLogMessage) => m.message_id)).toEqual(['m1']);
	});
});

describe('CommsLogBatcher — retry & backoff', () => {
	it('backs off exponentially and retries until the endpoint recovers', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 - 1) }, { baseBackoffMs: 30_000 });
		store.messages = [msg('m1', 0)];
		deps.postBatch.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('still down'));
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);

		const t1 = T0 + DEFAULT_FLUSH_INTERVAL_MS + 1;
		await batcher.flushDue(t1); // fail #1 → backoff 30s
		expect(deps.postBatch).toHaveBeenCalledTimes(1);

		await batcher.flushDue(t1 + 10_000); // still inside backoff → no attempt
		expect(deps.postBatch).toHaveBeenCalledTimes(1);

		await batcher.flushDue(t1 + 31_000); // fail #2 → backoff 60s
		expect(deps.postBatch).toHaveBeenCalledTimes(2);

		await batcher.flushDue(t1 + 31_000 + 61_000); // recovers
		expect(deps.postBatch).toHaveBeenCalledTimes(3);
		expect(deps.setCursor).toHaveBeenCalledWith('room-1', store.messages[0].ts, 'm1');
		expect(batcher.pendingRooms()).toEqual([]);
	});

	it('keeps draining with a full fetch page (busy room catches up across flushes)', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 - 1) }, { fetchLimit: 2 });
		store.messages = [msg('m1', 0), msg('m2', 1_000), msg('m3', 2_000)];
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);
		expect(deps.postBatch.mock.calls[0][1].messages.map((m: CommsLogMessage) => m.message_id)).toEqual(['m1', 'm2']);

		// Full page ⇒ room stays dirty and due on the next tick (no extra hook events needed).
		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 10_000);
		expect(deps.postBatch.mock.calls[1][1].messages.map((m: CommsLogMessage) => m.message_id)).toEqual(['m3']);
	});
});

describe('CommsLogBatcher — idempotent ids & edits', () => {
	it('re-sends an edit of an already-logged message with the SAME id (idempotent upstream)', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 + 10_000) });
		// m1 was logged long ago (behind the cursor); it just got edited.
		store.messages = [msg('m1', 0)];
		const edited: CommsLogMessage = { message_id: 'm1', sender_name: 'sender-m1', sent_at: new Date(T0).toISOString(), text: 'edited text' };
		batcher.noteMessageSaved('room-1', { ts: new Date(T0) }, edited, T0 + 20_000);

		await batcher.flushDue(T0 + 20_000 + DEFAULT_FLUSH_INTERVAL_MS);

		const payload = deps.postBatch.mock.calls[0][1];
		expect(payload.messages).toEqual([edited]);
		// Extras never advance the cursor.
		expect(deps.setCursor).not.toHaveBeenCalled();
	});

	it('drops an edit duplicate when the cursor fetch already covers the same id', async () => {
		const { batcher, deps, store } = makeHarness({ cursorTs: new Date(T0 - 1) });
		store.messages = [msg('m1', 0)];
		const edited: CommsLogMessage = { message_id: 'm1', sender_name: 'sender-m1', sent_at: new Date(T0).toISOString(), text: 'edited fast' };
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, edited, T0 + 1_000);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);

		const payload = deps.postBatch.mock.calls[0][1];
		expect(payload.messages.map((m: CommsLogMessage) => m.message_id)).toEqual(['m1']);
	});
});

describe('CommsLogBatcher — toggles', () => {
	it('toggle-off at flush time produces ZERO traffic and drops the queue (cursor untouched)', async () => {
		const { batcher, deps, store } = makeHarness({ enabled: false, cursorTs: new Date(T0 - 1) });
		store.messages = [msg('m1', 0)];
		batcher.noteMessageSaved('room-1', { ts: store.messages[0].ts }, undefined, T0);

		await batcher.flushDue(T0 + DEFAULT_FLUSH_INTERVAL_MS + 1);

		expect(deps.postBatch).not.toHaveBeenCalled();
		expect(deps.fetchLoggableMessagesSince).not.toHaveBeenCalled();
		expect(deps.setCursor).not.toHaveBeenCalled();
		expect(batcher.pendingRooms()).toEqual([]);
	});
});
