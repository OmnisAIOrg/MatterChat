import type { IUser } from '@rocket.chat/core-typings';
import { UserStatus } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { addUserRolesAsync } from '../roles/addUserRoles';

/**
 * CHI assistant — the "Chi" bot user that posts answers into channels.
 *
 * Mirrors the `rocket.cat` seeding in server/startup/initialData.ts, but lazily:
 * the user is created the first time /chi actually needs to post (so workspaces that
 * never configure CHI never grow an extra user). Fixed `_id`/username `chi.bot`
 * ("chi" alone could collide with a human); display name "Chi".
 */

export const CHI_BOT_ID = 'chi.bot';

export async function getChiBotUser(): Promise<IUser> {
	const existing = await Users.findOneById(CHI_BOT_ID);
	if (existing) {
		return existing;
	}

	try {
		await Users.create({
			_id: CHI_BOT_ID,
			name: 'Chi',
			username: CHI_BOT_ID,
			status: UserStatus.ONLINE,
			statusDefault: UserStatus.ONLINE,
			utcOffset: 0,
			active: true,
			type: 'bot',
		});
		await addUserRolesAsync(CHI_BOT_ID, ['bot']);
	} catch (err) {
		// Race with a concurrent /chi (duplicate key) — fall through to the re-read.
	}

	const created = await Users.findOneById(CHI_BOT_ID);
	if (!created) {
		throw new Error('Could not create the Chi bot user');
	}
	return created;
}
