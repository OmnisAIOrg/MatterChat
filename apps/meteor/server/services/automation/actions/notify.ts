import type { IActionNotify, IActionNotifyEmail, IActionNotifySms } from '@rocket.chat/core-typings';
import { BoardsActivities, BoardsLeads } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { sendTemplate } from '../../../lib/boards/leads/comms';
import type { AutomationContext } from '../context';
import { interpolateString } from '../interpolate';
import { ok, skipped, errored, planned } from './types';

/**
 * Notify / communicate action handlers (M7 — §5.3 "Actions — Notify/comm").
 *
 * In-app notify is a clean M8 seam: there is no Boards-native notification collection
 * yet (the M5 deadline tickler degrades the same way), so `notify` records an
 * owner-visible `boards_activities` row and leaves a TODO(M8) to fan out to the RC bell
 * + email digest. notifyEmail / notifySms route through the EXISTING M6 comm sender
 * (`sendTemplate`) when the subject is a lead with a templateId; SMS is additionally
 * gated by `Boards_Automation_SMS_Enabled` (P3 telephony).
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
		// Resolve the recipient set for the audit signal (full delivery is M8).
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
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(card ? { listId: card.listId, cardId: card._id } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'field.changed',
			to: { automationNotify: true, target: action.target, recipients, message },
			ts: new Date(),
		});
		// TODO(M8): deliver via boards_notifications + the RC bell / email digest.
		return ok(index, action.type, `notified ${action.target} (${recipients.length})`);
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
		// Inline subject/body without a template: no provider seam yet (P3) — record intent.
		const { value: body } = interpolateString(action.body ?? '', ctx);
		await BoardsActivities.log({
			boardId: ctx.boardId,
			...(lead.cardId ? { cardId: lead.cardId } : {}),
			actor: `automation:${ctx.automation._id}`,
			verb: 'field.changed',
			to: { automationEmail: true, leadId: lead._id, inline: true, preview: body.slice(0, 120) },
			ts: new Date(),
		});
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
			verb: 'field.changed',
			to: { automationSms: true, leadId: lead._id, inline: true, preview: body.slice(0, 120) },
			ts: new Date(),
		});
		return ok(index, action.type, 'queued inline sms (no template)');
	} catch (err) {
		return errored(index, action.type, err);
	}
}
