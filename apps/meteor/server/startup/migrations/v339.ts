import { BoardsCards } from '@rocket.chat/models';

import { addMigration } from '../../lib/migrations';

// Backfill required array fields on EXISTING board cards that predate them.
//
// Root cause: CasePro-synced matter cards seeded by an earlier `bindMatterCard` were inserted
// WITHOUT `labels` / `comments` / `checklists` / `attachments`. The IBoardCard type declares
// all four as REQUIRED arrays, so the client reads them unguarded (`card.comments.map(...)`,
// `card.checklists.reduce(...)`) — and a legacy doc missing the field crashes the whole board
// on open. The client now guards these defensively, but healing the data at rest makes every
// reader (client AND server) safe and keeps the documents type-honest.
//
// SAFETY: one $exists:false-filtered $set per field — only fills the gap, NEVER overwrites a
// populated array. Idempotent: re-running matches nothing. No upsert, so it touches only
// existing docs.

const REQUIRED_CARD_ARRAYS = ['labels', 'comments', 'checklists', 'attachments'] as const;

addMigration({
	version: 339,
	name: 'Backfill missing required array fields (labels/comments/checklists/attachments) on legacy board cards',
	async up() {
		for (const field of REQUIRED_CARD_ARRAYS) {
			await BoardsCards.updateMany({ [field]: { $exists: false } }, { $set: { [field]: [] } });
		}
	},
});
