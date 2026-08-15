import { cronJobs } from '@rocket.chat/cron';
import type { IUser } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { getChiBotUser } from '../lib/chi/bot';
import { gatherUnreadDigest } from '../lib/chi/digest/unreadDigest';
import { SystemLogger } from '../lib/logger/system';
import { sendMessage } from '../lib/messages/sendMessage';
import { createDirectRoom } from '../lib/rooms/createDirectRoom';
import { settings } from '../settings';

/**
 * MATTERCHAT: Chi's morning brief.
 *
 * Once a day, DM every user who opted in a digest of what they missed, with a
 * jump link per message.
 *
 * ## Opt-in, deliberately
 *
 * A daily unsolicited DM is a cost, and one the user should choose to pay. The
 * workspace toggle (`Chi_Morning_Brief_Enabled`) only makes the feature
 * available; a user still has to switch it on for themselves
 * (`settings.chi.morningBrief`). Defaulting this on would train people to
 * ignore Chi's DMs, which is expensive to undo — the brief is only useful while
 * a message from Chi still means something.
 *
 * ## Graceful degrade
 *
 * Mirrors boardsDigestCron: the whole job no-ops when the toggle is off, the
 * schedule is watched so an admin can change cadence with no redeploy, and a
 * per-user failure is swallowed so one bad account cannot abort the sweep.
 * Users with nothing unread are skipped entirely — "you have no unread
 * messages" every morning is noise wearing a helpful face.
 */

const BRIEF_JOB = 'ChiMorningBrief';

const DEFAULT_SCHEDULE = '0 7 * * 1-5';

function briefEnabled(): boolean {
	try {
		return settings.get('Chi_Morning_Brief_Enabled') === true;
	} catch {
		return false;
	}
}

function briefSchedule(): string {
	try {
		const raw = settings.get<string>('Chi_Morning_Brief_Schedule');
		return raw && raw.trim() ? raw.trim() : DEFAULT_SCHEDULE;
	} catch {
		return DEFAULT_SCHEDULE;
	}
}

/** Deliver one user's brief as a DM from the Chi bot. */
async function sendBriefTo(bot: IUser, user: Pick<IUser, '_id' | 'username'>): Promise<boolean> {
	const { channels, text } = await gatherUnreadDigest(user._id);
	if (!channels.length) {
		return false; // nothing waiting — say nothing.
	}

	// Reuse the existing Chi DM when there is one — forceNew would give the user
	// a fresh, empty conversation every single morning.
	const room = await createDirectRoom([bot, user as IUser], {}, { creator: bot._id });
	if (!room?._id) {
		return false;
	}

	const greeting = user.username ? `Good morning, @${user.username} — here's what you missed.` : "Here's what you missed.";
	await sendMessage(bot, { rid: room._id, msg: `${greeting}\n\n${text}` }, room);
	return true;
}

/**
 * The sweep. Returns counts for the run log; never throws.
 */
export async function runMorningBriefSweep(): Promise<{ candidates: number; sent: number; skipped: number }> {
	if (!briefEnabled()) {
		SystemLogger.debug({ msg: 'chi.morningBrief.skipped', reason: 'disabled' });
		return { candidates: 0, sent: 0, skipped: 0 };
	}

	let bot: IUser;
	try {
		bot = await getChiBotUser();
	} catch (err) {
		SystemLogger.warn({ msg: 'chi.morningBrief.noBotUser', err });
		return { candidates: 0, sent: 0, skipped: 0 };
	}

	let candidates = 0;
	let sent = 0;
	let skipped = 0;

	// Only opted-in, active humans. The query does the filtering so a workspace
	// with thousands of users does not load them all to discard most.
	const cursor = Users.find<Pick<IUser, '_id' | 'username'>>(
		{ 'active': { $ne: false }, 'type': { $ne: 'bot' }, 'settings.chi.morningBrief': true },
		{ projection: { username: 1 } },
	);

	for await (const user of cursor) {
		candidates += 1;
		try {
			if (await sendBriefTo(bot, user)) {
				sent += 1;
			} else {
				skipped += 1;
			}
		} catch (err) {
			skipped += 1;
			SystemLogger.debug({ msg: 'chi.morningBrief.userFailed', userId: user._id, err });
		}
	}

	SystemLogger.debug({ msg: 'chi.morningBrief.swept', candidates, sent, skipped });
	return { candidates, sent, skipped };
}

let registeredSchedule: string | undefined;

async function syncBriefJob(): Promise<void> {
	const enabled = briefEnabled();
	const schedule = briefSchedule();
	const has = await cronJobs.has(BRIEF_JOB);

	if (!enabled) {
		if (has) {
			await cronJobs.remove(BRIEF_JOB);
			registeredSchedule = undefined;
			SystemLogger.debug({ msg: 'chi.morningBrief.disabled' });
		}
		return;
	}

	if (has && registeredSchedule === schedule) {
		return;
	}
	if (has) {
		await cronJobs.remove(BRIEF_JOB);
	}
	await cronJobs.add(BRIEF_JOB, schedule, async () => {
		await runMorningBriefSweep();
	});
	registeredSchedule = schedule;
	SystemLogger.debug({ msg: 'chi.morningBrief.enabled', schedule });
}

/** Register the brief cron. Called from cron/start.ts. */
export async function chiMorningBriefCron(): Promise<void> {
	settings.watch('Chi_Morning_Brief_Enabled', async () => {
		await syncBriefJob();
	});
	settings.watch('Chi_Morning_Brief_Schedule', async () => {
		await syncBriefJob();
	});
	await syncBriefJob();
}
