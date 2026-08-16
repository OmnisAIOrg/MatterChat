import { cronJobs } from '@rocket.chat/cron';
import type { IUser } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { getChiBotUser } from '../lib/chi/bot';
import { hasSomeoneReplied, roomStillExists } from '../lib/chi/admin/reminder-tools';
import { SystemLogger } from '../lib/logger/system';
import { sendMessage } from '../lib/messages/sendMessage';
import { createDirectRoom } from '../lib/rooms/createDirectRoom';
import { ChiReminders } from '../models/ChiReminders';

/**
 * MATTERCHAT: deliver due Chi reminders.
 *
 * Runs every minute. Reminders are claimed one at a time with a guarded
 * findOneAndUpdate (see ChiReminders.claimDue) because more than one app
 * instance runs this job — an unguarded find-then-send delivers every reminder
 * as many times as there are pods, which is the kind of bug that only shows up
 * in production.
 *
 * A `no-reply` follow-up re-checks its condition at delivery time and stays
 * silent if somebody replied in the meantime. That check has to happen HERE
 * rather than when the reminder was set, because the whole point is what
 * happened during the wait.
 */

const REMINDER_JOB = 'ChiReminders';
const SCHEDULE = '* * * * *';

/** Hard cap per tick so a backlog cannot monopolise the worker. */
const MAX_PER_TICK = 50;

async function deliver(bot: IUser, userId: string, text: string): Promise<boolean> {
	const user = await Users.findOneById<Pick<IUser, '_id' | 'username' | 'active'>>(userId, { projection: { username: 1, active: 1 } });
	if (!user || user.active === false) {
		return false;
	}
	const room = await createDirectRoom([bot, user as IUser], {}, { creator: bot._id });
	if (!room?._id) {
		return false;
	}
	await sendMessage(bot, { rid: room._id, msg: text }, room);
	return true;
}

export async function runRemindersSweep(now: Date = new Date()): Promise<{ fired: number; skipped: number }> {
	let fired = 0;
	let skipped = 0;

	let bot: IUser;
	try {
		bot = await getChiBotUser();
	} catch (err) {
		SystemLogger.warn({ msg: 'chi.reminders.noBotUser', err });
		return { fired: 0, skipped: 0 };
	}

	for (let i = 0; i < MAX_PER_TICK; i++) {
		const reminder = await ChiReminders.claimDue(now);
		if (!reminder) {
			break;
		}

		try {
			// A conditional follow-up asks its question again at delivery time.
			if (reminder.kind === 'no-reply' && reminder.rid) {
				if (!(await roomStillExists(reminder.rid))) {
					// reclassify, not resolve: claimDue already stamped this one 'fired'.
					await ChiReminders.reclassify(reminder._id, 'cancelled');
					skipped += 1;
					continue;
				}
				const since = reminder.watchSince ?? reminder.createdAt;
				if (await hasSomeoneReplied(reminder.rid, since, reminder.userId)) {
					// The thing they were waiting for happened. Say nothing — and RECORD that,
					// rather than leaving the claim's provisional 'fired' in place.
					await ChiReminders.reclassify(reminder._id, 'condition-met');
					skipped += 1;
					continue;
				}
			}

			const where = reminder.roomLabel ? ` in ${reminder.roomLabel}` : '';
			const body =
				reminder.kind === 'no-reply'
					? `⏰ Still no reply${where}${reminder.note ? ` — ${reminder.note}` : ''}.`
					: `⏰ Reminder${where}: ${reminder.note || 'you asked me to nudge you.'}`;

			if (await deliver(bot, reminder.userId, body)) {
				fired += 1;
			} else {
				skipped += 1;
			}
		} catch (err) {
			skipped += 1;
			SystemLogger.debug({ msg: 'chi.reminders.deliveryFailed', reminderId: reminder._id, err });
		}
	}

	if (fired || skipped) {
		SystemLogger.debug({ msg: 'chi.reminders.swept', fired, skipped });
	}
	return { fired, skipped };
}

/**
 * Register the reminders cron. Called from cron/start.ts.
 *
 * MUST re-add on every boot, and the early return that used to be here was a real outage.
 *
 * `cronJobs.has()` asks Agenda, whose job records live in MONGO and therefore survive a
 * restart. `cronJobs.add()` is what calls `define()` — which registers the callback IN THIS
 * PROCESS, because a closure cannot be persisted. So "the job already exists, nothing to do"
 * is exactly wrong: it leaves a scheduled job with no handler attached to the running pod.
 * The symptom is that reminders fire after the first ever boot of a fresh database and then
 * never again, silently, for the life of the deployment.
 *
 * Remove-then-add is what the morning brief already does (via its schedule-change sync), which
 * is why that one kept working. Verified live: without this, a due reminder sits unresolved
 * through every tick after a restart; with it, it fires within the minute.
 */
export async function chiRemindersCron(): Promise<void> {
	if (await cronJobs.has(REMINDER_JOB)) {
		await cronJobs.remove(REMINDER_JOB);
	}
	await cronJobs.add(REMINDER_JOB, SCHEDULE, async () => {
		await runRemindersSweep();
	});
}
