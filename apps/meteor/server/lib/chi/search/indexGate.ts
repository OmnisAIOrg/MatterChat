import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { isEditedMessage } from '@rocket.chat/core-typings';

/**
 * The afterSaveMessage gate for live Chi search indexing (F9), kept pure so it is unit-testable
 * without Meteor — same shape as server/lib/caseProCommsLog/hookGate.ts.
 *
 * Order matters for cost: this runs on every message saved anywhere on the workspace, so the
 * cheapest and most commonly-false check goes first. With no embedding provider configured —
 * the default — a message costs one boolean.
 *
 * ## What is deliberately NOT indexed
 *
 *  - **System messages, and messages with neither text nor an attachment.** "X joined the
 *    channel" is not something anybody asks Chi about, and it would dilute every passage it
 *    landed in. An upload posted with no caption DOES count as content — the indexer describes
 *    it by filename, because "did anyone send the deposition transcript?" is a real question.
 *  - **Hidden messages.** `_hidden` is how a deleted-but-retained message is tombstoned. A
 *    retrieval system for a law firm that can quote a message somebody deleted is a liability,
 *    not a feature.
 *  - **Edits.** The indexer is watermark-driven (`ts > lastIndexed`), so an edit of an older
 *    message would not be re-read anyway and noting it only buys a wasted provider call. The
 *    consequence is honest and bounded: an edited message keeps its original text in the index
 *    until someone rebuilds. Correcting that properly means re-chunking the passage the message
 *    landed in, which is a rebuild of that room, not an incremental pass.
 *  - **Chi's own posts.** Chi answers by quoting passages; indexing its answers would let a
 *    later answer cite an earlier answer as if it were something a person had said. Grounding
 *    has to bottom out in what humans actually wrote.
 */
export type IndexHookDecision = { action: 'skip' } | { action: 'index' };

const SKIP: IndexHookDecision = { action: 'skip' };

/** Cheap structural check — mirrors the `$or` in the indexer's own query. */
const hasAttachment = (message: Pick<IMessage, 'file' | 'files'>): boolean =>
	Boolean(message.file) || Boolean(message.files?.length);

export function evaluateMessageForIndexing(
	message: IMessage | undefined,
	room: Pick<IRoom, '_id' | 't'> | undefined,
	enabled: boolean,
	botUserId?: string,
): IndexHookDecision {
	// Cheapest gate first: unset = off, and off must cost nothing.
	if (!enabled) {
		return SKIP;
	}
	if (!room?._id || !message) {
		return SKIP;
	}
	if (message.t) {
		return SKIP;
	}
	// Text OR an attachment. Only a message carrying neither is nothing to index.
	if (!message.msg?.trim() && !hasAttachment(message)) {
		return SKIP;
	}
	if (message._hidden) {
		return SKIP;
	}
	if (botUserId && message.u?._id === botUserId) {
		return SKIP;
	}
	if (isEditedMessage(message)) {
		return SKIP;
	}
	return { action: 'index' };
}
