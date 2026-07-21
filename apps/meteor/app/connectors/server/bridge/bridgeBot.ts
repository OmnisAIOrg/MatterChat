/**
 * The connector-bridge bot — the RC account that AUTHORS inbound bridged messages from external
 * senders (Slack/Teams/Google), rendering the real author via the ALIAS mechanism.
 *
 * WHY (root cause of "bridged rooms never receive the other side" — founder bug, multiple days):
 * bridge inbound used to send AS the connection owner with `alias` set for non-owner authors, but
 * sendMessage's validateMessage requires the `message-impersonate` permission for ANY aliased
 * message — humans don't have it, so every message from the OTHER party threw
 * 'Not enough permission' and died (warn-logged only; the owner's own echoes carry no alias,
 * which is why outbound always looked fine). The `bot` role holds `message-impersonate` by
 * default (authorization constants), so a dedicated bot sender is the supported path — the same
 * pattern Rocket.Chat's stock bridges use.
 *
 * Mirrors chi/bot.ts: fixed _id/username, lazily created on first inbound, race-safe.
 */
import type { IUser } from '@rocket.chat/core-typings';
import { UserStatus } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { addUserRolesAsync } from '../../../../server/lib/roles/addUserRoles';

export const BRIDGE_BOT_ID = 'connector.bridge';

export async function getBridgeBotUser(): Promise<IUser> {
	const existing = await Users.findOneById(BRIDGE_BOT_ID);
	if (existing) {
		return existing;
	}

	try {
		await Users.create({
			_id: BRIDGE_BOT_ID,
			name: 'Bridge',
			username: BRIDGE_BOT_ID,
			status: UserStatus.ONLINE,
			statusDefault: UserStatus.ONLINE,
			utcOffset: 0,
			active: true,
			type: 'bot',
		});
		await addUserRolesAsync(BRIDGE_BOT_ID, ['bot']);
	} catch (err) {
		// Race with a concurrent inbound (duplicate key) — fall through to the re-read.
	}

	const created = await Users.findOneById(BRIDGE_BOT_ID);
	if (!created) {
		throw new Error('Could not create the connector bridge bot user');
	}
	return created;
}
