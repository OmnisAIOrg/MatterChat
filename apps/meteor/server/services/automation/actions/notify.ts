import type { IActionNotify, IActionNotifyEmail, IActionNotifySms, IBoardCard } from '@rocket.chat/core-typings';
import { BoardsActivities, BoardsLeads } from '@rocket.chat/models';

import { settings } from '../../../settings';
import { sendTemplate } from '../../../lib/boards/leads/comms';
import { deliverToUsers, deliverCardEvent } from '../../../lib/boards/notifications';
import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * Notify / communicate action handlers (M7 — §5.3 "Actions — Notify/comm"; DELIVERY
 * wired in M8).
 *
 * `notify` now DELIVERS: it resolves the recipient set (owner / assignees / watchers /
 * a named user) and writes a `boards_notifications` row per recipient via the M8
 * notifications lib (`deliverToUsers`), so the message lands in the Boards bell/inbox.
 * It still records the owner-visible `boards_activities` audit row (the run-log + card
 * timeline signal). Delivery honors `Boards_Notifications_InApp_Enabled` inside the lib
 * and degrades gracefully (never throws into the run).
 *
 * notifyEmail / notifySms route through the EXISTING M6 comm sender (`sendTemplate`) when
 * the subject is a lead with a templateId; SMS is additionally gated by
 * `Boards_Automation_SMS_Enabled` (P3 telephony). The inline (no-template) email branch
 * additionally drops an in-app notification to the card's followers so the intent is
 * visible in the bell, not just the audit feed.
 *
 * Dry-run is preserved end-to-end: every handler returns a `planned(...)` result before
 * any delivery/comm side effect when `ctx.dryRun` is set.
 */

function smsEnabled(): boolean {
	try {
		return settings.get('Boards_Automation_SMS_Enabled') === true;
	} catch {
		return false;
	}
}

/** Resolve the lead for a comm action (direct lead subject, or the card's lead link). */
async function resolveLead(ctx: AutomationContext) {
	if (ctx.subject.lead) {
		return ctx.subject.lead;
	}
	if (ctx.subject.card) {
		return BoardsLeads.findOneByCardId(ctx.subject.card._id);
	}
	return null;
}

export async function handleNotify(action: IActionNotify, ctx: AutomationContext, index: number) {
	try {
		const { value: message } = interpolateString(action.message, ctx);
		if (ctx.dryRun) {
			return planned(index, action.type, `notify ${action.target} "${message.slice(0, 40)}"`);
		}
		// Resolve the recipient set from the action target.
		const card = ctx.subject.card;
		let recipients: string[] = [];
		switch (action.target) {
			case 'owner':
				recipients = card?.createdBy ? [card.createdBy] : [];
				break;
			case 'assignees':
				recipients = card?.assignees ?? [];
				break;
			case 'watchers':
				recipients = card?.watchers ?? [];
				break;
			case 'user':
				recipients = action.userId ? [action.userId] : [];
				break;
			default:
				recipients = [];
		}

		// Audit signal (run-log + card timeline) — kept as the canonical activity record.
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(card ? { listId: card.listId, cardId: card._id } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'automation.notified',
			to: { automationNotify: true, target: action.target, recipients, message },
			ts: new Date(),
		});

		// DELIVER (M8): write a boards_notifications row per recipient so the message
		// reaches the Boards bell/inbox. The actor is the automation (not a user), so no
		// recipient is excluded as "self". Best-effort + toggle-gated inside the lib.
		const title = ctx.automation.name ? `Automation: ${ctx.automation.name}` : 'Board notification';
		const result = await deliverToUsers(recipients, {
			kind: 'field.changed',
			title,
			body: message,
			actor: `automation:${ctx.automation._id}`,
			...(card ? { boardId: ctx.boardId, cardId: card._id, link: `/boards/b/${ctx.boardId}/board/${card._id}` } : { boardId: ctx.boardId }),
		});

		const detail = result.suppressed
			? `notified ${action.target} (${recipients.length}; in-app delivery disabled)`
			: `notified ${action.target} (${result.delivered}/${recipients.length} delivered)`;
		return ok(index, action.type, detail);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleNotifyEmail(action: IActionNotifyEmail, ctx: AutomationContext, index: number) {
	try {
		const lead = await resolveLead(ctx);
		if (!lead) {
			return skipped(index, action.type, 'unsupported', 'notifyEmail requires a lead subject');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, action.templateId ? `email template ${action.templateId}` : 'email (inline)');
		}
		if (action.templateId) {
			await sendTemplate(ctx.actor, lead._id, action.templateId);
			return ok(index, action.type, `sent email template ${action.templateId}`);
		}
		// Inline subject/body without a template: no external email provider seam yet (P3) —
		// record intent AND surface it in-app so it isn't silently dropped. Deliver to the
		// lead-card's followers when the lead is carded (degrades cleanly for un-carded leads).
		const { value: body } = interpolateString(action.body ?? '', ctx);
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'automation.notified',
			to: { automationEmail: true, leadId: lead._id, inline: true, preview: body.slice(0, 120) },
			ts: new Date(),
		});
		// Surface in-app to the lead card's followers. Prefer the card already resolved on
		// the context (carries the real assignees/watchers); else fall back to the lead's
		// cardId with empty inline arrays (subscription rows still resolve recipients).
		const followCard: Pick<IBoardCard, '_id' | 'boardId' | 'assignees' | 'watchers'> | null =
			ctx.subject.card ?? (lead.cardId ? { _id: lead.cardId, boardId: ctx.boardId, assignees: [], watchers: [] } : null);
		if (followCard) {
			await deliverCardEvent(followCard, {
				kind: 'field.changed',
				title: ctx.automation.name ? `Email queued: ${ctx.automation.name}` : 'Email queued for lead',
				...(action.subject ? { body: action.subject } : body ? { body: body.slice(0, 280) } : {}),
				actor: `automation:${ctx.automation._id}`,
				leadId: lead._id,
			});
		}
		return ok(index, action.type, 'queued inline email (no template)');
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleNotifySms(action: IActionNotifySms, ctx: AutomationContext, index: number) {
	try {
		if (!smsEnabled()) {
			return skipped(index, action.type, 'unsupported', 'SMS automations disabled (Boards_Automation_SMS_Enabled)');
		}
		const lead = await resolveLead(ctx);
		if (!lead) {
			return skipped(index, action.type, 'unsupported', 'notifySms requires a lead subject');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, action.templateId ? `sms template ${action.templateId}` : 'sms (inline)');
		}
		if (action.templateId) {
			await sendTemplate(ctx.actor, lead._id, action.templateId);
			return ok(index, action.type, `sent sms template ${action.templateId}`);
		}
		// Inline body without a template — provider send is P3; record intent.
		const { value: body } = interpolateString(action.body ?? '', ctx);
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'automation.notified',
			to: { automationSms: true, leadId: lead._id, inline: true, preview: body.slice(0, 120) },
			ts: new Date(),
		});
		return ok(index, action.type, 'queued inline sms (no template)');
	} catch (err) {
		return errored(index, action.type, err);
	}
}
