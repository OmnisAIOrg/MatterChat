import type { IBoardForm, IBoardFormIntakeMapping, ILeadContact } from '@rocket.chat/core-typings';
import { BoardsActivities } from '@rocket.chat/models';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { settings } from '../../../settings';
import { createLead } from '../leads/service';

/**
 * Public-form → intake routing (the CasePro seam of the forms feature).
 *
 * A form with `intakeRouting` set does ONE extra thing on a public submit, in
 * addition to the always-created card:
 *
 *  - 'lead'           — {@link routeSubmissionToLead}: create a board lead from the
 *    mapped answers through the normal leads service (dedupe, refNo, lead card,
 *    speed-to-lead SLA, and the `CasePro_Enabled`-gated write-through all apply).
 *  - 'casepro-direct' — {@link deliverToCaseProCapture}: server-side POST of the
 *    mapped answers to CasePro's deliberately-public capture endpoint
 *    `{CasePro_Intake_Capture_Base}/api/v1/intake-questionnaires/capture?org=&source=`.
 *
 * INVARIANTS (both modes):
 *  - the public submitter ALWAYS gets the same `{ok:true}` — intake delivery is
 *    at-least-once-ATTEMPTED, never a submit blocker;
 *  - every attempt (success or failure) is recorded on the board's activity feed
 *    (`form.intake.routed` / `form.intake.failed`) — the form's audit trail;
 *  - nothing secret is ever written into the audit payload (no source token).
 *
 * OUTBOUND SSRF POSTURE ('casepro-direct'):
 *  - https-only (a non-https configured base refuses to send);
 *  - the URL is BUILT from the admin-configured base + a fixed path — per-form
 *    input (org id / source token) only ever lands in URL-encoded query params,
 *    so the request host is pinned to the configured base;
 *  - serverFetch SSRF validation stays ON, with the configured host as the only
 *    allow-list entry (DNS-pinned by server-fetch);
 *  - redirects are NOT followed; 3s timeout; fire-and-forget.
 */

const CAPTURE_PATH = '/api/v1/intake-questionnaires/capture';
const CAPTURE_TIMEOUT_MS = 3000;

/** settings.get throws if the setting is not yet registered (early boot / tests). */
function captureBase(): string {
	if (process.env.CASEPRO_INTAKE_CAPTURE_BASE) {
		return process.env.CASEPRO_INTAKE_CAPTURE_BASE;
	}
	try {
		return settings.get<string>('CasePro_Intake_Capture_Base') ?? '';
	} catch {
		return '';
	}
}

/** Resolve one mapped answer (mapping value = form field id) to its submitted string. */
function mapped(mapping: IBoardFormIntakeMapping | undefined, values: Map<string, string>, key: keyof IBoardFormIntakeMapping): string | undefined {
	const fieldId = mapping?.[key];
	return fieldId ? values.get(fieldId) : undefined;
}

/** The mapped contact/classification block both routing modes share (deriveCaptureInput shape). */
function mappedIntakeFields(form: IBoardForm, values: Map<string, string>) {
	const m = form.intakeMapping;
	return {
		fullName: mapped(m, values, 'fullName'),
		firstName: mapped(m, values, 'firstName'),
		lastName: mapped(m, values, 'lastName'),
		email: mapped(m, values, 'email'),
		phone: mapped(m, values, 'phone'),
		caseType: mapped(m, values, 'caseType'),
		incidentDate: mapped(m, values, 'incidentDate'),
	};
}

async function audit(form: IBoardForm, verb: 'form.intake.routed' | 'form.intake.failed', detail: Record<string, unknown>, cardId?: string): Promise<void> {
	try {
		await BoardsActivities.log({
			boardId: form.boardId,
			...(cardId ? { cardId } : {}),
			actor: form.createdBy,
			verb,
			to: { formId: form._id, ...detail },
			ts: new Date(),
		});
	} catch {
		// the audit write is best-effort too — never let it break a public submit.
	}
}

// ---------------------------------------------------------------------------
// 'lead' mode
// ---------------------------------------------------------------------------

export type LeadRoutingResult = { leadId: string; duplicate: boolean } | undefined;

/**
 * Create (or dedupe-match) a board lead from the mapped answers, AS the form's
 * creator — exactly the identity the submission card is created under. Returns
 * the leadId for the card link, or undefined on failure (audited, submit continues).
 *
 * The leads service does the heavy lifting: phone/email dedupe (a repeat submitter
 * links to their existing open lead instead of minting a duplicate), refNo, the
 * lead card on the Leads board, the speed-to-lead SLA task, and the
 * `CasePro_Enabled`-gated `pushCreate` write-through.
 */
export async function routeSubmissionToLead(form: IBoardForm, values: Map<string, string>): Promise<LeadRoutingResult> {
	const f = mappedIntakeFields(form, values);

	const contact: ILeadContact = {
		...(f.fullName ? { fullName: f.fullName } : {}),
		...(f.firstName ? { firstName: f.firstName } : {}),
		...(f.lastName ? { lastName: f.lastName } : {}),
		...(f.email ? { email: f.email } : {}),
		...(f.phone ? { phone: f.phone } : {}),
	};

	const incidentDate = f.incidentDate ? new Date(f.incidentDate) : undefined;

	try {
		const { lead, duplicateOf } = await createLead(form.createdBy, {
			contact,
			// the mapped case type is a NAME (form answer), not a CasePro case_types.id —
			// practiceArea is the free-text classification lane for exactly that.
			...(f.caseType ? { practiceArea: f.caseType } : {}),
			...(incidentDate && !Number.isNaN(incidentDate.getTime()) ? { incident: { incidentDate } } : {}),
			capturedChannel: 'web-form',
			attribution: { source: `Board form: ${form.title}` },
		});
		const duplicate = Boolean(duplicateOf);
		await audit(form, 'form.intake.routed', { mode: 'lead', leadId: lead._id, refNo: lead.refNo, duplicate });
		return { leadId: lead._id, duplicate };
	} catch (e: unknown) {
		await audit(form, 'form.intake.failed', { mode: 'lead', reason: e instanceof Error ? e.message : 'lead-create-failed' });
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// 'casepro-direct' mode
// ---------------------------------------------------------------------------

/**
 * Build the capture URL from the configured base + fixed path + encoded params.
 * Returns null (with a reason) when the base is missing/invalid/not-https —
 * the config error is audited, never thrown at the public submitter.
 */
export function buildCaptureUrl(form: IBoardForm): { url: URL } | { error: string } {
	const base = captureBase().trim();
	if (!base) {
		return { error: 'no-capture-base' };
	}

	let url: URL;
	try {
		const root = new URL(base);
		if (root.protocol !== 'https:') {
			return { error: 'capture-base-not-https' };
		}
		url = new URL(`${root.pathname.replace(/\/+$/, '')}${CAPTURE_PATH}`, root.origin);
	} catch {
		return { error: 'capture-base-invalid' };
	}

	if (!form.caseproOrgId || !form.caseproSourceToken) {
		return { error: 'capture-form-unconfigured' };
	}
	// per-form input goes ONLY into URL-encoded query params — the host stays the configured base's.
	url.searchParams.set('org', form.caseproOrgId);
	url.searchParams.set('source', form.caseproSourceToken);
	return { url };
}

/**
 * Fire-and-forget POST of the mapped answers to the CasePro capture endpoint.
 * Zero-auth by design (the endpoint is deliberately public; org is validated
 * server-side by CasePro, source is the marketing-attribution token). Every
 * outcome is audited; nothing is ever surfaced to the public submitter.
 */
export async function deliverToCaseProCapture(form: IBoardForm, values: Map<string, string>, cardId?: string): Promise<void> {
	const built = buildCaptureUrl(form);
	if ('error' in built) {
		await audit(form, 'form.intake.failed', { mode: 'casepro-direct', reason: built.error }, cardId);
		return;
	}
	const { url } = built;

	const f = mappedIntakeFields(form, values);
	// full labeled answer set rides along as formData (the capture endpoint's free-form block)
	const formData: Record<string, string> = {};
	for (const field of form.fields) {
		const v = values.get(field.id);
		if (v !== undefined) {
			formData[field.label] = v;
		}
	}

	const body = {
		...(f.fullName ? { fullName: f.fullName, name: f.fullName } : {}),
		...(f.firstName ? { firstName: f.firstName } : {}),
		...(f.lastName ? { lastName: f.lastName } : {}),
		...(f.email ? { email: f.email } : {}),
		...(f.phone ? { phone: f.phone } : {}),
		...(f.caseType ? { caseType: f.caseType } : {}),
		...(f.incidentDate ? { incidentDate: f.incidentDate } : {}),
		formData,
	};

	const allowHost = url.port ? `${url.hostname}:${url.port}` : url.hostname;

	/**
	 * Scrub an error message before it reaches the audit trail: node-fetch et al
	 * embed the FULL request URL (query string included) in failure messages, which
	 * would leak the source token. Censor the per-form secrets explicitly and strip
	 * every URL query string as belt-and-braces.
	 */
	const scrubReason = (message: string): string => {
		let out = message;
		for (const secret of [form.caseproSourceToken, form.caseproOrgId]) {
			if (secret) {
				out = out.split(secret).join('***');
			}
		}
		return out.replace(/\?\S*/g, '?…').slice(0, 300);
	};

	try {
		const res = await fetch(url.toString(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			timeout: CAPTURE_TIMEOUT_MS,
			followRedirects: false, // a redirect is a failure, not a hop — the token must never re-send elsewhere
			ignoreSsrfValidation: false,
			allowList: [allowHost], // host-pinned to the admin-configured base (DNS-pinned by server-fetch)
		});
		if (res.ok) {
			await audit(form, 'form.intake.routed', { mode: 'casepro-direct', status: res.status }, cardId);
		} else {
			await audit(form, 'form.intake.failed', { mode: 'casepro-direct', status: res.status }, cardId);
		}
	} catch (e: unknown) {
		const reason = e instanceof Error ? scrubReason(e.message) : 'capture-post-failed';
		await audit(form, 'form.intake.failed', { mode: 'casepro-direct', reason }, cardId);
	}
}
