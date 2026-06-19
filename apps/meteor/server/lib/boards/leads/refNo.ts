import { db } from '../../../database/utils';

/**
 * Monotonic `refNo` allocator for leads.
 *
 * Phase-1 (Leads data model) deliberately left `boards_counters` / `nextRefNo()`
 * out of scope and assigned it to this (Leads server) phase. We back it with a
 * tiny `boards_counters` collection reached through the shared raw `db` handle —
 * no new registered model, no M1 file edits. The `findOneAndUpdate($inc, upsert)`
 * is atomic, so concurrent lead creates each get a unique increasing number.
 *
 * Doc shape: `{ _id: 'leadRefNo', seq: number }`. Reusable for other counters
 * (e.g. a future matter ref) by passing a different `counterId`.
 */

type CounterDoc = { _id: string; seq: number };

const COUNTERS_COLLECTION = 'boards_counters';

export async function nextSeq(counterId: string): Promise<number> {
	const col = db.collection<CounterDoc>(COUNTERS_COLLECTION);
	const doc = await col.findOneAndUpdate(
		{ _id: counterId },
		{ $inc: { seq: 1 } },
		{ upsert: true, returnDocument: 'after' },
	);
	return doc?.seq ?? 1;
}

/** Next human-facing lead reference number (monotonic, 1-based). */
export function nextLeadRefNo(): Promise<number> {
	return nextSeq('leadRefNo');
}
