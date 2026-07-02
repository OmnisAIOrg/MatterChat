import type { IRocketChatRecord } from './IRocketChatRecord';

export type BoardsActivityVerb =
	| 'board.created'
	| 'board.updated'
	| 'board.archived'
	| 'list.created'
	| 'list.updated'
	| 'list.moved'
	| 'list.archived'
	| 'card.created'
	| 'card.updated'
	| 'card.moved'
	| 'card.archived'
	| 'card.deleted'
	| 'card.copied'
	| 'card.mirrored'
	| 'card.linked'
	| 'card.converted'
	| 'channel.linked'
	| 'channel.unlinked'
	| 'label.added'
	| 'label.removed'
	| 'member.added'
	| 'member.removed'
	| 'due.set'
	| 'due.completed'
	| 'checklist.created'
	| 'checklistItem.toggled'
	| 'comment.added'
	| 'attachment.added'
	| 'field.changed'
	| 'automation.ran'
	| 'automation.notified'
	| 'casepro.snapshot.refreshed'
	| 'casepro.stage.pushed'
	| 'form.intake.routed'
	| 'form.intake.failed';

/**
 * Append-only audit feed. Every mutation across the Boards feature writes one
 * of these. `actor` is a Rocket.Chat user `_id`, or `automation:<automationId>`
 * / `casepro:sync` for non-user actors. Never updated, never trashed.
 */
export interface IBoardActivity extends IRocketChatRecord {
	boardId: string;
	listId?: string;
	cardId?: string;
	actor: string; // user _id | 'automation:<id>' | 'casepro:sync'
	verb: BoardsActivityVerb;
	from?: unknown;
	to?: unknown;
	ts: Date;
}
