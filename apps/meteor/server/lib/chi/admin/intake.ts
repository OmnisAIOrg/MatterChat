/**
 * Chi Admin Assistant — DM intake.
 *
 * Registers the afterSaveMessage listener (same mechanism as the connector bridge outbound
 * mirror in app/connectors/server/bridge/bridgeCore.ts). The callback stays CHEAP and
 * synchronous-fast: a few field checks, then fire-and-forget into the service — message send
 * latency for everyone else is never coupled to model calls.
 *
 * Triggers ONLY for: direct rooms (t === 'd') that include the Chi bot, human-authored,
 * non-system, non-edit messages. Chi's own posts are excluded by author id (no echo loop).
 */
import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { isEditedMessage } from '@rocket.chat/core-typings';

import { CHI_BOT_ID } from '../bot';
import { handleChiAdminDm, isChiAdminEnabled } from './service';
import { callbacks } from '../../callbacks';
import { SystemLogger } from '../../logger/system';

const CALLBACK_ID = 'chi-admin-assistant-intake';

export function registerChiAdminIntake(): void {
	callbacks.add(
		'afterSaveMessage',
		(message: IMessage, { room }: { room: IRoom }) => {
			if (
				!isChiAdminEnabled() ||
				room.t !== 'd' ||
				!room.uids?.includes(CHI_BOT_ID) ||
				message.u?._id === CHI_BOT_ID ||
				message.t || // system messages
				isEditedMessage(message) ||
				!message.msg?.trim()
			) {
				return message;
			}
			handleChiAdminDm(message, room).catch((err) => {
				SystemLogger.error({ msg: 'Chi admin DM handling failed', err: String(err) });
			});
			return message;
		},
		callbacks.priority.LOW,
		CALLBACK_ID,
	);
}
