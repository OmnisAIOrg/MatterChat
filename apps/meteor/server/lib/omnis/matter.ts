import { Rooms, Subscriptions } from '@rocket.chat/models';

import { caseProClient } from '../boards/casepro/client';
import { SystemLogger } from '../logger/system';

/**
 * The matter-context rule, server side. This is the most important behaviour in
 * the Omnis widget spec, and both halves of it are load-bearing:
 *
 *   > If the active screen is a matter channel, the matter is inherited and the
 *   > user does nothing. If it is not, the user is asked — with a search over
 *   > every matter in the firm.
 *
 * **Never guess.** No "most recent matter", no "their only open matter". Filing
 * a signed fee agreement into the wrong matter is materially worse than one
 * extra click, and a wrong guess is invisible at the moment it is made.
 *
 * `IRoom.matterId` is the CasePro `matters.id` mirrored onto the room. There is
 * **no `matterName`** on the room — the display name comes from the CasePro
 * snapshot, and `MatterHeaderBannerContent` falls back to `room.fname ?? room.name`.
 * {@link resolveRoomMatter} does the same so every widget agrees with the header.
 */

export type OmnisMatterRef = {
	matterId: string;
	/** Display name. Falls back to the room's own name, as the matter banner does. */
	matterName: string;
	matterNumber?: string;
	stageName?: string;
	/** Where this reference came from — the client labels a guess differently. */
	source: 'channel' | 'search' | 'recent' | 'guess';
	/** 0–1, only meaningful when `source === 'guess'`. */
	confidence?: number;
};

/** Matter bound to a room, or null when the room is not matter-linked. */
export async function resolveRoomMatter(rid: string): Promise<OmnisMatterRef | null> {
	const room = await Rooms.findOneById(rid, { projection: { matterId: 1, clientChannel: 1, fname: 1, name: 1 } });
	if (!room?.matterId) {
		return null;
	}
	return {
		matterId: room.matterId,
		matterName: room.fname ?? room.name ?? room.matterId,
		source: 'channel',
	};
}

/** True when the room is client-facing — the hard gate on posting work product. */
export async function isClientChannel(rid: string): Promise<boolean> {
	const room = await Rooms.findOneById(rid, { projection: { clientChannel: 1 } });
	return room?.clientChannel === true;
}

/**
 * Tier 3 of the picker: live search across every matter in the firm, matching
 * name, matter number, or client name.
 *
 * Backed by the EXISTING CasePro client rather than a second path to the CRM.
 * A read, so it degrades: an unreachable CasePro yields an empty list and one
 * warning, never an exception that takes the panel down.
 */
export async function searchMatters(query: string, limit = 20): Promise<OmnisMatterRef[]> {
	const needle = query.trim().toLowerCase();
	try {
		const { matters } = await caseProClient.listAllMatters();
		const mapped = matters.map(
			(m): OmnisMatterRef => ({
				matterId: m.matterId,
				matterName: m.matterName ?? m.matterNumber ?? m.matterId,
				...(m.matterNumber ? { matterNumber: m.matterNumber } : {}),
				...(m.stageName ? { stageName: m.stageName } : {}),
				source: 'search',
			}),
		);
		if (!needle) {
			return mapped.slice(0, limit);
		}
		return mapped
			.filter(
				(m) =>
					m.matterName.toLowerCase().includes(needle) ||
					(m.matterNumber ?? '').toLowerCase().includes(needle) ||
					m.matterId.toLowerCase().includes(needle),
			)
			.slice(0, limit);
	} catch (err) {
		SystemLogger.warn({ msg: 'Omnis matter search failed — returning no results', err });
		return [];
	}
}

/**
 * Tier 2 of the picker: matters this user actually works in, derived from the
 * matter channels they are subscribed to.
 *
 * This is a *listing* convenience, never a default selection — see the "never
 * guess" note above. Nothing here is pre-selected by any caller.
 */
export async function recentMattersForUser(uid: string, limit = 8): Promise<OmnisMatterRef[]> {
	try {
		const subscriptions = await Subscriptions.find({ 'u._id': uid }, { projection: { rid: 1 }, sort: { ls: -1 }, limit: 200 }).toArray();
		const roomIds = subscriptions.map((s) => s.rid);
		if (roomIds.length === 0) {
			return [];
		}

		const rooms = await Rooms.find(
			{ _id: { $in: roomIds }, matterId: { $exists: true, $ne: '' } },
			{ projection: { matterId: 1, fname: 1, name: 1, lm: 1 }, sort: { lm: -1 } },
		).toArray();

		const seen = new Set<string>();
		const out: OmnisMatterRef[] = [];
		for (const room of rooms) {
			if (!room.matterId || seen.has(room.matterId)) {
				continue;
			}
			seen.add(room.matterId);
			out.push({
				matterId: room.matterId,
				matterName: room.fname ?? room.name ?? room.matterId,
				source: 'recent',
			});
			if (out.length >= limit) {
				break;
			}
		}
		return out;
	} catch (err) {
		SystemLogger.warn({ msg: 'Omnis recent-matter lookup failed — returning no results', err });
		return [];
	}
}

/**
 * Resolve a display name for a bare matter id (receipts, completion webhooks
 * arriving days after the send). Prefers a matter channel's own name so the
 * receipt reads the way the channel header does; falls back to CasePro, then to
 * the id itself — a receipt must never fail to post for want of a pretty name.
 */
export async function matterDisplayName(matterId: string): Promise<string> {
	const room = await Rooms.findOne({ matterId }, { projection: { fname: 1, name: 1 } });
	if (room) {
		return room.fname ?? room.name ?? matterId;
	}
	try {
		const { matters } = await caseProClient.listAllMatters();
		const match = matters.find((m) => m.matterId === matterId);
		return match?.matterName ?? match?.matterNumber ?? matterId;
	} catch {
		return matterId;
	}
}
