/**
 * MatterChat fork — canned replies / message templates store.
 *
 * Starter templates ship with the app (firm-useful legal boilerplate) and are
 * always present / not removable. User-added templates are persisted locally
 * (per-user, per-device) via localStorage so a legal team can grow their own
 * library without any backend change. A server-backed collection is the natural
 * next step if cross-device sync is wanted.
 */

export type CannedTemplate = {
	id: string;
	title: string;
	body: string;
	/** starter templates are read-only; user templates can be removed */
	readonly?: boolean;
};

const STORAGE_PREFIX = 'matterchat.composer.cannedTemplates.';

const storageKey = (userId?: string): string => `${STORAGE_PREFIX}${userId || 'anon'}`;

/**
 * Firm-useful starter templates. Placeholders in [brackets] are meant to be
 * filled in by the sender before/after insertion.
 */
export const STARTER_TEMPLATES: CannedTemplate[] = [
	{
		id: 'starter-records-request',
		title: 'Records request',
		readonly: true,
		body:
			'Hi [Provider/Custodian],\n\n' +
			'We represent [Client] in connection with injuries sustained on [Date of loss]. ' +
			'Please send us a complete set of medical records and itemized billing for treatment ' +
			'rendered from [Start date] to present. A signed HIPAA authorization is attached.\n\n' +
			'Please let us know if anything further is needed to process this request. Thank you.',
	},
	{
		id: 'starter-status-update',
		title: 'Status update to client',
		readonly: true,
		body:
			'Hi [Client],\n\n' +
			'Quick update on your case: [current status / what just happened]. ' +
			'Our next step is [next step], which we expect to complete by [date]. ' +
			'There is nothing you need to do right now — we will reach out if we need anything from you.\n\n' +
			'Please don’t hesitate to reply with any questions.',
	},
	{
		id: 'starter-scheduling',
		title: 'Scheduling',
		readonly: true,
		body:
			'Hi [Name],\n\n' +
			'We’d like to get [meeting / call / deposition] on the calendar. ' +
			'Do any of the following work for you?\n' +
			'  • [Option 1]\n' +
			'  • [Option 2]\n' +
			'  • [Option 3]\n\n' +
			'Let me know which is best and I’ll send a confirmation. Thank you.',
	},
	{
		id: 'starter-records-followup',
		title: 'Records follow-up',
		readonly: true,
		body:
			'Hi [Provider/Custodian],\n\n' +
			'Following up on our request dated [Date] for [Client]’s records and billing. ' +
			'We have not yet received them. Could you please advise on status and expected turnaround? ' +
			'If there is an outstanding fee or additional authorization needed, let us know and we will take care of it right away.\n\n' +
			'Thank you for your help.',
	},
	{
		id: 'starter-intake-welcome',
		title: 'New client welcome',
		readonly: true,
		body:
			'Hi [Client],\n\n' +
			'Welcome, and thank you for trusting our firm with your case. ' +
			'I’ll be one of your main points of contact. Here’s what happens next: ' +
			'we’ll gather your records, open communication with the insurer, and keep you updated at every stage. ' +
			'If you have new bills, photos, or documents, just send them our way.\n\n' +
			'You can reach us here anytime.',
	},
];

const readUserTemplates = (userId?: string): CannedTemplate[] => {
	try {
		const raw = window.localStorage.getItem(storageKey(userId));
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.filter((t): t is { id: string; title: string; body: string } =>
				Boolean(t?.id && typeof t.title === 'string' && typeof t.body === 'string'),
			)
			.map((t) => ({ id: t.id, title: t.title, body: t.body, readonly: false }));
	} catch (_e) {
		return [];
	}
};

const writeUserTemplates = (userId: string | undefined, templates: CannedTemplate[]): void => {
	try {
		window.localStorage.setItem(storageKey(userId), JSON.stringify(templates.map(({ id, title, body }) => ({ id, title, body }))));
	} catch (_e) {
		// storage may be unavailable (private mode / quota) — fail soft
	}
};

/** Starter templates followed by the user's own saved templates. */
export const getTemplates = (userId?: string): CannedTemplate[] => [...STARTER_TEMPLATES, ...readUserTemplates(userId)];

export const addTemplate = (userId: string | undefined, title: string, body: string): CannedTemplate => {
	const template: CannedTemplate = {
		id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		title: title.trim() || 'Untitled template',
		body,
		readonly: false,
	};
	const next = [...readUserTemplates(userId), template];
	writeUserTemplates(userId, next);
	return template;
};

export const removeTemplate = (userId: string | undefined, id: string): void => {
	writeUserTemplates(
		userId,
		readUserTemplates(userId).filter((t) => t.id !== id),
	);
};
