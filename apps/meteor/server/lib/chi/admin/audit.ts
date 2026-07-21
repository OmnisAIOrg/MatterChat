/**
 * Chi Admin Assistant — audit trail.
 *
 * Every EXECUTED tool call is mirrored into a private audit channel (default
 * `chi-admin-audit`, admin-configurable) as a bot message — searchable, in-product, visible to
 * whoever the founder adds to that channel — plus a SystemLogger line (names + tool + ok/err
 * only; argument VALUES are pre-masked by helpers.auditArgs and message contents are never
 * logged). No new Mongo collection: the channel IS the ledger (v1 decision, see PLAN.md).
 */
import type { IUser } from '@rocket.chat/core-typings';
import { Rooms } from '@rocket.chat/models';

import { hasRoleAsync } from '../../../../app/authorization/server/functions/hasRole';
import { createRoom } from '../../../../app/lib/server/functions/createRoom';
import { sendMessage } from '../../../../app/lib/server/functions/sendMessage';
import { settings } from '../../../../app/settings/server';
import { SystemLogger } from '../../logger/system';
import { getChiBotUser } from '../bot';

const DEFAULT_CHANNEL = 'chi-admin-audit';

const channelName = (): string =>
	String(settings.get('Chi_Assistant_Audit_Channel') || DEFAULT_CHANNEL)
		.replace(/^#/, '')
		.trim() || DEFAULT_CHANNEL;

/**
 * Post one audit line. Creates the private audit channel on first use (bot + the acting user
 * as members — but ONLY when that user is an admin; non-admin self-service calls are audited
 * without ever seating the non-admin in the audit channel). Audit must never break the action
 * it records: failures log and return.
 */
export async function postAuditEntry(actor: IUser, line: string): Promise<void> {
	try {
		const bot = await getChiBotUser();
		const name = channelName();
		let room = await Rooms.findOneByName(name);
		if (!room) {
			const seatActor = actor.username && (await hasRoleAsync(actor._id, 'admin'));
			const created = await createRoom('p', name, bot, seatActor && actor.username ? [actor.username] : [], false, false, {
				description: 'Chi Admin Assistant audit log — every executed admin action lands here.',
			});
			room = await Rooms.findOneById(created.rid);
		}
		if (!room) {
			throw new Error('audit room unavailable');
		}
		await sendMessage(bot, { rid: room._id, msg: line }, room);
	} catch (err) {
		SystemLogger.warn({ msg: 'Chi admin audit write failed', err: String(err) });
	}
}
