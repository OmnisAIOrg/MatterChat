/**
 * MATTERCHAT: MIT pass-through replacing the EE canned-responses before-save hook
 * (was ee/server/hooks/messages/BeforeSaveCannedResponse — removed with the Enterprise tree).
 * Canned responses are a livechat-enterprise feature MatterChat does not use; message text is
 * returned unchanged.
 */
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';

export class BeforeSaveCannedResponse {
	async replacePlaceholders({
		message,
	}: {
		message: IMessage;
		room: IRoom;
		user: Pick<IUser, '_id' | 'username' | 'name'>;
	}): Promise<IMessage> {
		return message;
	}
}
