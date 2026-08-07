import { cronJobs } from '@rocket.chat/cron';
import type { IBoardNotification, IUser } from '@rocket.chat/core-typings';
import { BoardsNotifications, Users } from '@rocket.chat/models';
import { escapeHTML } from '@rocket.chat/string-helpers';

import * as Mailer from '../lib/notifications/email/api';
import { isSMTPConfigured } from '../lib/utils/functions/isSMTPConfigured';
import { settings } from '../settings';
import { SystemLogger } from '../lib/logger/system';

/**
 * Boards notification EMAIL DIGEST cron (M8 — §B "Reporting + Notifications"). Once per
 * configured period, sweep every user who has unread `boards_notifications` and send them
 * ONE email summarizing those items (the inbox is the source of truth; the digest is a
 * pull-forward so a user who isn't watching the bell still finds out).
 *
 * GRACEFUL DEGRADE (the hard rule): the whole job no-ops unless
 *   1. `Boards_Email_Digest_Enabled` is true, AND
 *   2. SMTP is actually configured (`isSMTPConfigured()` — SMTP_Host or MAIL_URL).
 * With no SMTP the digest is silently skipped (logged at debug), never thrown. Per-user
 * send failures are swallowed so one bad address can't abort the sweep. The digest does
 * NOT mark notifications read — they stay unread in the bell until the user opens them
 * (the email is a heads-up, not an acknowledgement).
 *
 * SCHEDULING: the cron expression comes from `Boards_Email_Digest_Schedule` (default
 * `0 8 * * *` = daily 08:00, firm-local using the same tz convention as the automation
 * cron). We watch BOTH the enable toggle and the schedule string and re-register the job
 * exactly like `automationEngine.ts`/`cronPruneMessages.ts`, so an admin can change the
 * cadence or silence the digest with no redeploy. Registered from `cron/start.ts` after
 * the scheduler has a live driver.
 */

const DIGEST_JOB = 'BoardsNotificationDigest';

/** Cap how many unread items we itemize per user in the email (the rest are summarized as a count). */
const MAX_ITEMS_PER_USER = 25;

/** Digest enabled = the toggle is on AND we actually have a mail transport. */
function digestEnabled(): boolean {
	try {
		return settings.get('Boards_Email_Digest_Enabled') === true && isSMTPConfigured();
	} catch {
		return false;
	}
}

/** The schedule cron string (degrades to daily-08:00 if unset/blank). */
function digestSchedule(): string {
	try {
		const raw = settings.get<string>('Boards_Email_Digest_Schedule');
		return raw && raw.trim() ? raw.trim() : '0 8 * * *';
	} catch {
		return '0 8 * * *';
	}
}

/** Build the HTML body for one user's unread items. Plain, inline-safe, escaped. */
function renderDigestHtml(siteName: string, items: IBoardNotification[], totalUnread: number): string {
	const rows = items
		.map((n) => {
			const when = n.createdAt ? new Date(n.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '';
			const title = escapeHTML(n.title ?? '');
			const body = n.body ? `<br/><span style="color:#6c727a">${escapeHTML(n.body)}</span>` : '';
			return `<li style="margin-bottom:8px"><b>${title}</b> <span style="color:#9ea2a8;font-size:12px">${when}</span>${body}</li>`;
		})
		.join('');
	const more = totalUnread > items.length ? `<p style="color:#6c727a">…and ${totalUnread - items.length} more.</p>` : '';
	return [
		`<p>You have <b>${totalUnread}</b> unread board notification${totalUnread === 1 ? '' : 's'} in ${escapeHTML(siteName)}.</p>`,
		`<ul style="padding-left:18px">${rows}</ul>`,
		more,
		`<p style="color:#9ea2a8;font-size:12px">Open ${escapeHTML(siteName)} to view and clear these in your board inbox.</p>`,
	].join('');
}

/**
 * The sweep. Best-effort end to end:
 *   - distinct userIds with unread rows (cheap index hit on {userId,read}),
 *   - per user: load their unread items (newest first, capped) + a real email address,
 *   - send one digest email.
 * Returns counts for the run log. Never throws.
 */
export async function runDigestSweep(): Promise<{ users: number; sent: number; skipped: number }> {
	if (!digestEnabled()) {
		SystemLogger.debug({ msg: 'boards.notifications.digest.skipped', reason: 'disabled-or-no-smtp' });
		return { users: 0, sent: 0, skipped: 0 };
	}

	const siteName = (() => {
		try {
			return settings.get<string>('Site_Name') || 'MatterChat';
		} catch {
			return 'MatterChat';
		}
	})();
	const from = (() => {
		try {
			return settings.get<string>('From_Email') || '';
		} catch {
			return '';
		}
	})();

	let users = 0;
	let sent = 0;
	let skipped = 0;

	let userIds: string[] = [];
	try {
		// distinct() over the {userId,read} index — the set of users with anything unread.
		userIds = (await BoardsNotifications.col.distinct('userId', { read: false })) as string[];
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.notifications.digest.distinctFailed', err });
		return { users: 0, sent: 0, skipped: 0 };
	}

	for (const userId of userIds) {
		users += 1;
		try {
			const totalUnread = await BoardsNotifications.countUnread(userId);
			if (totalUnread === 0) {
				continue;
			}
			const items = await BoardsNotifications.findUnreadByUser(userId, { limit: MAX_ITEMS_PER_USER }).toArray();

			const user = await Users.findOneById<Pick<IUser, '_id' | 'emails' | 'active'>>(userId, {
				projection: { emails: 1, active: 1 },
			});
			const address = user?.emails?.find((e) => e?.address)?.address;
			if (!user || user.active === false || !address || !Mailer.checkAddressFormat(address)) {
				skipped += 1;
				continue; // no deliverable address — leave the items unread for the bell.
			}

			await Mailer.send({
				to: address,
				from,
				subject: `${siteName}: ${totalUnread} unread board notification${totalUnread === 1 ? '' : 's'}`,
				html: renderDigestHtml(siteName, items, totalUnread),
			});
			sent += 1;
		} catch (err) {
			skipped += 1;
			SystemLogger.debug({ msg: 'boards.notifications.digest.userFailed', userId, err });
		}
	}

	SystemLogger.debug({ msg: 'boards.notifications.digest.swept', users, sent, skipped });
	return { users, sent, skipped };
}

/**
 * Add/remove/re-schedule the digest job to match the enable toggle + schedule string.
 * Idempotent: removes a stale job before re-adding when the schedule changed (cronJobs
 * keys by name, so we drop+add to pick up a new expression). Mirrors `syncTickJob`.
 */
let registeredSchedule: string | undefined;

async function syncDigestJob(): Promise<void> {
	const enabled = (() => {
		try {
			return settings.get('Boards_Email_Digest_Enabled') === true;
		} catch {
			return false;
		}
	})();
	const schedule = digestSchedule();
	const has = await cronJobs.has(DIGEST_JOB);

	if (!enabled) {
		if (has) {
			await cronJobs.remove(DIGEST_JOB);
			registeredSchedule = undefined;
			SystemLogger.debug({ msg: 'boards.notifications.digest.disabled' });
		}
		return;
	}

	// enabled — (re)register if not present or the schedule changed.
	if (has && registeredSchedule === schedule) {
		return;
	}
	if (has) {
		await cronJobs.remove(DIGEST_JOB);
	}
	await cronJobs.add(DIGEST_JOB, schedule, async () => {
		await runDigestSweep();
	});
	registeredSchedule = schedule;
	SystemLogger.debug({ msg: 'boards.notifications.digest.enabled', schedule });
}

/**
 * Register the digest cron. Watches the enable toggle + schedule string (add/remove/
 * re-schedule) and evaluates once at boot for the initial state. Called from
 * `cron/start.ts`, mirroring `boardsMattersCron` / `automationEngineCron`.
 */
export async function boardsDigestCron(): Promise<void> {
	settings.watch('Boards_Email_Digest_Enabled', async () => {
		await syncDigestJob();
	});
	settings.watch('Boards_Email_Digest_Schedule', async () => {
		await syncDigestJob();
	});
	// initial state (the watches fire on change; this covers boot).
	await syncDigestJob();
}
