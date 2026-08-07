import type { IMessage, IRoom } from '@rocket.chat/core-typings';

import { forwardOutbound, isClientSyncEnabled } from './index';
import { callbacks } from '../../callbacks';
import { settings } from '../../../settings';
import { SystemLogger } from '../../logger/system';

/**
 * OUTBOUND leg registration: the afterSaveMessage subscriber that forwards staff messages typed
 * in a "Client" channel out to the CasePro portal.
 *
 * Unique callback id (`CaseProClientSync_Out`) so it coexists with the other afterSaveMessage
 * subscribers (threads, read-receipts, search, slackbridge, connector-bridge, and the sibling
 * comms-auto-log lane). The forward is a no-op for any room that is NOT `clientChannel: true`,
 * so it never touches the internal matter channel that the comms-log lane owns.
 *
 * Registration is gated on the live setting: when CasePro_Client_Sync_Enabled flips OFF the
 * callback is removed (zero traffic when gated off); when it flips ON it's (re)added.
 */

const CALLBACK_ID = 'CaseProClientSync_Out';

async function onMessageSaved(message: IMessage, room: IRoom): Promise<IMessage> {
	// Cheap gate first: only Client channels are relevant. (forwardOutbound re-checks + gates.)
	if (!room?.clientChannel) {
		return message;
	}
	try {
		await forwardOutbound(message, room);
	} catch (err) {
		// Never let a sync failure break message save.
		SystemLogger.warn({ msg: 'casepro.clientSync.hook.failed', mid: message._id, err });
	}
	return message;
}

/** Idempotently (re)register or remove the outbound callback based on the enable settings. */
function reconcileHook(): void {
	if (isClientSyncEnabled()) {
		callbacks.add(
			'afterSaveMessage',
			(message: IMessage, { room }: { room: IRoom }) => onMessageSaved(message, room),
			callbacks.priority.LOW,
			CALLBACK_ID,
		);
	} else {
		callbacks.remove('afterSaveMessage', CALLBACK_ID);
	}
}

/** Wire the outbound hook to the enable toggles. Call once at server startup. */
export function registerClientSyncOutbound(): void {
	settings.watch('CasePro_Enabled', () => reconcileHook());
	settings.watch('CasePro_Client_Sync_Enabled', () => reconcileHook());
	reconcileHook();
}
