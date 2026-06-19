import type { IActionEnrollSequence, IActionStopSequence } from '@rocket.chat/core-typings';
import { BoardsLeads } from '@rocket.chat/models';

import { enrollLead, stopSequencesForLead } from '../../../lib/boards/leads/sequences';
import type { AutomationContext } from '../context';
import { ok, skipped, errored, planned } from './types';

/**
 * Drip-sequence action handlers (M7 — §5.3). These DO NOT reimplement drip logic — they
 * call the EXISTING M6 sequence engine (`enrollLead`, `stopSequencesForLead`). The engine
 * cron tick (scheduled.ts) is what advances due enrollments via `advanceEnrollment`; a
 * `enrollSequence` action only schedules step 0, and `stopSequence` halts active drips.
 *
 * Sequences are lead-scoped, so both resolve the lead from the subject (direct lead, or
 * the card's lead link) and skip cleanly for non-lead subjects.
 */

async function resolveLead(ctx: AutomationContext) {
	if (ctx.subject.lead) {
		return ctx.subject.lead;
	}
	if (ctx.subject.card) {
		return BoardsLeads.findOneByCardId(ctx.subject.card._id);
	}
	return null;
}

export async function handleEnrollSequence(action: IActionEnrollSequence, ctx: AutomationContext, index: number) {
	try {
		const lead = await resolveLead(ctx);
		if (!lead) {
			return skipped(index, action.type, 'unsupported', 'enrollSequence requires a lead subject');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `enroll lead ${lead._id} in sequence ${action.sequenceId}`);
		}
		const { enrollment, alreadyEnrolled } = await enrollLead(ctx.actor, action.sequenceId, lead._id);
		return ok(index, action.type, alreadyEnrolled ? `already enrolled (${enrollment._id})` : `enrolled (${enrollment._id})`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}

export async function handleStopSequence(action: IActionStopSequence, ctx: AutomationContext, index: number) {
	try {
		const lead = await resolveLead(ctx);
		if (!lead) {
			return skipped(index, action.type, 'unsupported', 'stopSequence requires a lead subject');
		}
		if (ctx.dryRun) {
			return planned(index, action.type, `stop sequence(s) for lead ${lead._id}`);
		}
		// The M6 engine stops by lead with a reason; `sequenceId` (when set) is informational —
		// stopSequencesForLead halts ALL active enrollments for the lead (the manual-stop reason).
		await stopSequencesForLead(lead._id, 'manual-stop');
		return ok(index, action.type, `stopped drips for lead ${lead._id}`);
	} catch (err) {
		return errored(index, action.type, err);
	}
}
