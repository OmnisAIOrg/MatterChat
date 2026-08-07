import type { ICommTemplate, ICommunication, ILead, CommTemplateChannel } from '@rocket.chat/core-typings';
import { BoardsCommTemplates, BoardsCommunications, BoardsLeads } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../settings';
import { hasPermissionAsync } from '../../authorization/hasPermission';
import { assertBoardRole } from '../permissions';
import { logCommunication } from './service';

/**
 * Lead communication tooling (M6 — intake-lead-management.md §7): comm-template
 * CRUD, `{lead.*}`/`{firm.*}` interpolation, `sendTemplate` (render + log a
 * communication + return the rendered text), and the lead timeline reader.
 *
 * The raw `logCommunication` append lives in `./service` (re-used by both the
 * Meteor methods and REST); this module adds the TEMPLATE layer on top. Actual
 * email/SMS delivery is a P3 concern (Twilio/SMTP) — `sendTemplate` records the
 * communication with `deliveryStatus:'queued'` and leaves a provider seam.
 */

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/** Firm-level interpolation values, read from settings (degrades to defaults). */
function firmVars(): Record<string, string> {
	const get = (id: string, fallback = ''): string => {
		try {
			return String(settings.get(id) ?? fallback);
		} catch {
			return fallback;
		}
	};
	return {
		'firm.name': get('Site_Name', 'Our Firm'),
		'firm.url': get('Site_Url', ''),
		'firm.email': get('From_Email', ''),
	};
}

/** Lead-level interpolation values derived from the lead doc. */
function leadVars(lead: ILead): Record<string, string> {
	const c = lead.contact ?? {};
	const fullName = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
	return {
		'lead.firstName': c.firstName ?? fullName.split(' ')[0] ?? '',
		'lead.lastName': c.lastName ?? '',
		'lead.fullName': fullName,
		'lead.email': c.email ?? '',
		'lead.phone': c.phone ?? c.mobile ?? '',
		'lead.refNo': String(lead.refNo ?? ''),
		'lead.practiceArea': lead.practiceArea ?? '',
		'lead.incidentType': lead.incident?.incidentType ?? '',
	};
}

/**
 * Interpolate `{token}` placeholders against a variable bag. Extra caller vars
 * win over the derived ones. Unknown tokens are left intact (so a typo is
 * visible, not silently blanked).
 */
export function interpolate(text: string, vars: Record<string, string>): string {
	return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (whole, token: string) => {
		const v = vars[token];
		return v === undefined ? whole : v;
	});
}

/** Build the merged variable bag for a lead (firm + lead + caller extras). */
export function buildVars(lead: ILead, extra?: Record<string, string>): Record<string, string> {
	return { ...firmVars(), ...leadVars(lead), ...(extra ?? {}) };
}

// ---------------------------------------------------------------------------
// Template CRUD
// ---------------------------------------------------------------------------

export type CommTemplateFields = {
	name: string;
	channel: CommTemplateChannel;
	subject?: string;
	body: string;
	variables?: string[];
	practiceArea?: string;
	isSystem?: boolean;
};

export type UpsertCommTemplateResult = { template: ICommTemplate; created: boolean };

/** List templates, optionally narrowed to a channel. Requires comms permission. */
export async function listCommTemplates(uid: string, channel?: CommTemplateChannel): Promise<ICommTemplate[]> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-comms'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.template.list' });
	}
	const cursor = channel ? BoardsCommTemplates.findByChannel(channel) : BoardsCommTemplates.findAllTemplates();
	return cursor.toArray();
}

/**
 * Create or update a comm template. Managing templates requires
 * `boards-leads-templates-manage`; system templates cannot be re-flagged as
 * non-system on update.
 */
export async function upsertCommTemplate(
	uid: string,
	fields: CommTemplateFields,
	templateId?: string,
): Promise<UpsertCommTemplateResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-templates-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.template.upsert' });
	}

	if (templateId) {
		const existing = await BoardsCommTemplates.findOneById(templateId);
		if (!existing) {
			throw new Meteor.Error('error-comm-template-not-found', 'Template not found', { method: 'boards.leads.template.upsert' });
		}
		await BoardsCommTemplates.updateTemplate(
			templateId,
			{
				name: fields.name,
				channel: fields.channel,
				...(fields.subject !== undefined ? { subject: fields.subject } : {}),
				body: fields.body,
				...(fields.variables !== undefined ? { variables: fields.variables } : {}),
				...(fields.practiceArea !== undefined ? { practiceArea: fields.practiceArea } : {}),
			},
			uid,
		);
		const template = await BoardsCommTemplates.findOneById(templateId);
		if (!template) {
			throw new Meteor.Error('error-comm-template-not-found', 'Template not found', { method: 'boards.leads.template.upsert' });
		}
		return { template, created: false };
	}

	const now = new Date();
	const doc: Omit<ICommTemplate, '_id' | '_updatedAt'> = {
		name: fields.name,
		channel: fields.channel,
		...(fields.subject !== undefined ? { subject: fields.subject } : {}),
		body: fields.body,
		...(fields.variables !== undefined ? { variables: fields.variables } : {}),
		...(fields.practiceArea !== undefined ? { practiceArea: fields.practiceArea } : {}),
		...(fields.isSystem ? { isSystem: true } : {}),
		rev: 0,
		createdBy: uid,
		createdAt: now,
		updatedBy: uid,
		updatedAt: now,
	};
	const { insertedId } = await BoardsCommTemplates.insertOne(doc);
	const template = await BoardsCommTemplates.findOneById(insertedId);
	if (!template) {
		throw new Meteor.Error('error-comm-template-not-found', 'Template not found after create', {
			method: 'boards.leads.template.upsert',
		});
	}
	return { template, created: true };
}

// ---------------------------------------------------------------------------
// sendTemplate
// ---------------------------------------------------------------------------

export type SendTemplateResult = {
	commId: string;
	communication: ICommunication;
	/** the rendered, interpolated output the provider seam would deliver. */
	rendered: { subject?: string; body: string };
};

/**
 * Render a template against a lead's variables and log it as an outbound
 * communication. Delivery itself is a provider seam (P3 Twilio/SMTP); for now we
 * record the comm with `deliveryStatus:'queued'` and return the rendered text so
 * a caller (or the drip engine) can hand it to a provider. Requires comms perm +
 * board membership (via `logCommunication`).
 */
export async function sendTemplate(
	uid: string,
	leadId: string,
	templateId: string,
	vars?: Record<string, string>,
): Promise<SendTemplateResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-comms'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.template.send' });
	}
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.template.send' });
	}
	const template = await BoardsCommTemplates.findOneById(templateId);
	if (!template) {
		throw new Meteor.Error('error-comm-template-not-found', 'Template not found', { method: 'boards.leads.template.send' });
	}

	const bag = buildVars(lead, vars);
	const rendered = {
		...(template.subject ? { subject: interpolate(template.subject, bag) } : {}),
		body: interpolate(template.body, bag),
	};

	// log as an outbound comm of the template's channel (email|sms -> comm kind).
	const { commId, communication } = await logCommunication(uid, leadId, {
		kind: template.channel,
		direction: 'out',
		...(rendered.subject ? { subject: rendered.subject } : {}),
		body: rendered.body,
		templateId,
		deliveryStatus: 'queued',
	});

	return { commId, communication, rendered };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** The lead's communication timeline (ts desc). Requires board visibility. */
export async function getTimeline(uid: string, leadId: string): Promise<ICommunication[]> {
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.timeline' });
	}
	if (lead.boardId) {
		await assertBoardRole(lead.boardId, uid, 'observer', 'boards.leads.timeline');
	}
	return BoardsCommunications.findByLead(leadId).toArray();
}

/** Seed the firm-portable default templates (idempotent on name+channel). */
export async function seedDefaultTemplates(uid: string): Promise<{ created: number }> {
	const defaults: CommTemplateFields[] = [
		{
			name: 'Intake — first touch (SMS)',
			channel: 'sms',
			body: 'Hi {lead.firstName}, this is {firm.name}. We received your inquiry and want to help. Is now a good time to talk?',
			variables: ['lead.firstName', 'firm.name'],
			isSystem: true,
		},
		{
			name: 'Intake — follow-up (Email)',
			channel: 'email',
			subject: 'Following up on your case, {lead.firstName}',
			body: 'Hi {lead.firstName},\n\nWe wanted to follow up regarding your {lead.incidentType} matter. Please reply or call us at {firm.name}.\n\nThank you,\n{firm.name}',
			variables: ['lead.firstName', 'lead.incidentType', 'firm.name'],
			isSystem: true,
		},
	];

	let created = 0;
	const existing = await BoardsCommTemplates.findAllTemplates().toArray();
	const have = new Set(existing.map((t) => `${t.channel}:${t.name}`));
	for (const tpl of defaults) {
		if (have.has(`${tpl.channel}:${tpl.name}`)) {
			continue;
		}
		await upsertCommTemplate(uid, tpl);
		created += 1;
	}

	// templates are firm-wide config (not board-scoped), so no boards_activities row.
	return { created };
}
