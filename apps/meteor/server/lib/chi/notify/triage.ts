/**
 * Chi smart notifications (F5) — the stateful half, and the ONLY thing Rocket.Chat core calls.
 *
 * The decision itself is next door in ./triageDecision (pure, exhaustively tested). This file
 * exists to answer one question cheaply on the hottest path in the product: *does this
 * receiver's own triage want this message held back?*
 *
 * ## The cost budget, which is the entire design
 *
 * `sendNotification` runs once per receiver per message. Anything here is therefore multiplied
 * by room size and by traffic, so it is built to bottom out as early as possible:
 *
 *  1. A cached settings read (the admin kill switch). Off ⇒ one boolean, done.
 *  2. The receiver's rules come off the user document the notification aggregation ALREADY
 *     loaded — a widened projection, not a query. No rules ⇒ done, still zero I/O.
 *  3. Sender roles are needed only by rules that name a role ("unless it's from a partner").
 *     Almost none do, so almost nothing pays for it; when something does, the lookup is
 *     memoised for a short window so a chatty sender costs one query, not one per message.
 *
 * A user who has never written a rule therefore adds a settings read and a property access to
 * their notifications, forever, and nothing else.
 *
 * ## Failure is always "notify"
 *
 * Every error path returns "do not suppress". A triage bug must never be able to swallow a
 * message; the worst it may do is fail to hold one back.
 */
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import type { NotificationEvent } from './notificationRules';
import type { TriageOutcome } from './triageDecision';
import { TRIAGE_PASS, readNotificationRules, rulesReferenceSenderRoles, triage, tzOffsetMinutes } from './triageDecision';
import { settings } from '../../../settings';
import { SystemLogger } from '../../logger/system';

/** Admin kill switch. Defaults ON: the real opt-in is a user writing a rule. */
function triageEnabled(): boolean {
	try {
		return settings.get('Chi_Notification_Triage_Enabled') !== false;
	} catch {
		return false;
	}
}

/* ───────────────────── sender roles, memoised ───────────────────── */

/**
 * Short-lived cache. Roles change rarely and a stale entry can only mis-triage for a few
 * seconds, whereas a lookup per receiver per message on a busy channel is a real cost.
 */
const ROLE_TTL_MS = 30_000;
const ROLE_CACHE_MAX = 500;
const roleCache = new Map<string, { roles: string[]; at: number }>();

async function senderRoles(userId: string, now = Date.now()): Promise<string[]> {
	const hit = roleCache.get(userId);
	if (hit && now - hit.at < ROLE_TTL_MS) {
		return hit.roles;
	}
	const user = await Users.findOneById<Pick<IUser, '_id' | 'roles'>>(userId, { projection: { roles: 1 } });
	const roles = Array.isArray(user?.roles) ? user.roles : [];
	if (roleCache.size >= ROLE_CACHE_MAX) {
		// Cheapest possible eviction: drop the oldest insertion. Map preserves insertion order.
		const oldest = roleCache.keys().next();
		if (!oldest.done) {
			roleCache.delete(oldest.value);
		}
	}
	roleCache.set(userId, { roles, at: now });
	return roles;
}

/** Test seam — the cache is process-global, so a spec that touches it must be able to reset it. */
export function __resetSenderRoleCache(): void {
	roleCache.clear();
}

/* ───────────────────────── the entry point ───────────────────────── */

export type TriageInput = {
	/** The receiver's user document as already loaded by the notification pipeline. */
	receiver: unknown;
	sender: Pick<IUser, '_id' | 'name' | 'username'>;
	room: Pick<IRoom, '_id' | 't' | 'name' | 'fname'>;
	message: Pick<IMessage, '_id' | 'msg'> & { ts?: Date };
	hasMentionToUser: boolean;
	hasMentionToAll: boolean;
	hasMentionToHere: boolean;
};

/**
 * The full outcome, for callers that want to know WHY (Chi explaining itself, the digest
 * filter). Core's notification path uses {@link chiTriageSuppresses} instead.
 */
export async function evaluateTriage(input: TriageInput): Promise<TriageOutcome> {
	try {
		if (!triageEnabled()) {
			return TRIAGE_PASS;
		}
		const rules = readNotificationRules(input.receiver);
		if (!rules.length) {
			return TRIAGE_PASS;
		}

		const isDM = input.room.t === 'd';
		const event: NotificationEvent = {
			roomId: input.room._id,
			roomName: input.room.name || input.room.fname,
			roomType: input.room.t,
			senderUsername: input.sender.username,
			text: input.message.msg,
			// @all and @here are group mentions, but the user was still named by them; the
			// engine's mention protection is meant to cover exactly that case.
			isMention: input.hasMentionToUser || input.hasMentionToAll || input.hasMentionToHere || isDM,
			isDM,
			at: input.message.ts instanceof Date ? input.message.ts : new Date(),
			tzOffsetMinutes: tzOffsetMinutes((input.receiver as { utcOffset?: number } | null)?.utcOffset),
		};

		if (rulesReferenceSenderRoles(rules)) {
			event.senderRoles = await senderRoles(input.sender._id);
		}

		return triage(rules, event);
	} catch (err) {
		// Fail open: notify.
		SystemLogger.warn({ msg: 'chi.triage.failed', err: String(err) });
		return TRIAGE_PASS;
	}
}

/**
 * The one call Rocket.Chat core makes. `true` ⇒ hold this message back from desktop, push and
 * email for this receiver; the message is still delivered to the room and still shows as
 * unread, so Catch Me Up and the morning brief can surface it.
 */
export async function chiTriageSuppresses(input: TriageInput): Promise<boolean> {
	const outcome = await evaluateTriage(input);
	return outcome.suppressDesktop && outcome.suppressMobile && outcome.suppressEmail;
}
