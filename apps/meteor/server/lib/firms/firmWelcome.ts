import type { ITeam, IUser } from '@rocket.chat/core-typings';
import { Rooms } from '@rocket.chat/models';

import type { ChannelSpec } from './firmTemplates';
import { renderWelcome } from './firmWelcomeText';
import { getChiBotUser } from '../chi/bot';
import { SystemLogger } from '../logger/system';
import { sendMessage } from '../messages/sendMessage';

/**
 * MATTERCHAT: post Chi's welcome into a brand-new firm.
 *
 * The message text is built by the pure `firmWelcomeText` module; this is only
 * the delivery half. Best-effort by design: the firm already exists and is
 * usable, so a failure to post must not fail the signup the user is standing in
 * front of.
 */
export async function postFirmWelcome(team: ITeam, firmName: string, channels: ChannelSpec[], owner?: IUser): Promise<void> {
	try {
		const bot = await getChiBotUser();
		const room = await Rooms.findOneById(team.roomId);
		if (!room) {
			return;
		}
		await sendMessage(bot, { rid: room._id, msg: renderWelcome(firmName, channels, owner?.username) }, room);
	} catch (err) {
		SystemLogger.debug({ msg: 'firms.welcome.failed', err });
	}
}
