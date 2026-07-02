import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { isEditedMessage } from '@rocket.chat/core-typings';

/**
 * The afterSaveMessage gate for the CasePro comms-log, kept pure so it is
 * unit-testable without Meteor. Ordering matters for cost: the matterId check is
 * first so every normal room exits with zero further work (mirrors the Teams
 * bridge's importIds cheap gate in bridgeCore.ts).
 */
export type CommsLogHookDecision = { action: 'skip' } | { action: 'log'; edited: boolean };

export function evaluateMessageForCommsLog(
	message: IMessage,
	room: IRoom | undefined,
	globallyEnabled: boolean,
): CommsLogHookDecision {
	// Cheap gate: rooms without a linked matter never pay anything.
	if (!room?.matterId) {
		return { action: 'skip' };
	}
	// Global kill switch (CasePro_Enabled && CasePro_Comms_Log_Enabled).
	if (!globallyEnabled) {
		return { action: 'skip' };
	}
	// Per-channel opt-out. `undefined` ⇒ ON by default for matter-linked channels
	// (the founder's "auto log"); an explicit false excludes a sensitive channel.
	if (room.caseProCommsLog?.enabled === false) {
		return { action: 'skip' };
	}
	// System messages (joins, topic changes, …) and file-only messages stay out.
	if (message.t || !message.msg?.trim()) {
		return { action: 'skip' };
	}
	// Edits are re-sent with the SAME message id — the CasePro ingest is
	// idempotent per id, so an edit of an already-logged message is a no-op
	// upstream and must not advance the cursor here.
	return { action: 'log', edited: isEditedMessage(message) };
}
