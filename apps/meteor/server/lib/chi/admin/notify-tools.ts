/**
 * Chi — SMART NOTIFICATIONS tools (F5).
 *
 * "Only interrupt me for the Hernandez matter." "Nothing after 7pm unless it's from a partner."
 * The user says it as a sentence; the MODEL parses the sentence and calls `add_notification_rule`
 * with structured arguments. There is no LLM call in here — tools gather, the model reasons
 * (same house rule as ws-tools.ts). The stored rules are structured and inspectable, so the user
 * can always be shown, in plain words, exactly what is allowed to interrupt them.
 *
 * Every tool is `access: 'user'` and acts ONLY on the caller (`actor._id`). There is deliberately
 * no username parameter anywhere in this file: one member may never change another member's
 * notification behaviour, not even an admin — that would be a way to silence someone.
 *
 * The engine (../notify/notificationRules) and the store (../notify/rulesStore) hold all the
 * behaviour; these tools are a thin, well-described surface over them.
 */
import type { IUser } from '@rocket.chat/core-typings';

import type { ChiTool } from './tools';
import { MAX_RULES_PER_USER, NOTIFICATION_ACTIONS, describeRule, describeRules } from '../notify/notificationRules';
import { addNotificationRule, clearNotificationRules, getNotificationRules, removeNotificationRule } from '../notify/rulesStore';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The two lines every rules answer ends with, so the user always knows the defaults in play. */
const DEFAULTS_NOTE = [
	'_Defaults: your notifications work exactly as they do now until a rule of yours matches — rules only ever quieten things,',
	'never add them. A direct mention or a DM is never quietened by a "digest" rule unless you ask for that explicitly._',
].join(' ');

const addNotificationRuleTool: ChiTool = {
	def: {
		name: 'add_notification_rule',
		description: [
			"Add ONE smart-notification rule for the CALLER, deciding what is allowed to interrupt them. The user says it as a sentence — you translate it into these structured fields (there is no free-text field; never pass the raw sentence).",
			'',
			'action: "interrupt" = notify immediately · "digest" = collect it for their periodic digest instead of interrupting · "silence" = never surface it at all.',
			'Conditions AND together, and at least one is required: channel, sender, sender_role, keyword, a from/to time window, or everything:true.',
			'',
			'Mapping examples:',
			'• "only interrupt me for the Hernandez matter" → TWO calls: {action:"digest", everything:true} then {action:"interrupt", channel:"hernandez"} — the first is what makes "only" true; without it nothing else changes.',
			'• "don\'t ping me about #random, just collect it" → {action:"digest", channel:"random"}',
			'• "nothing after 7pm unless it\'s from a partner" → TWO calls: {action:"digest", from:"19:00", to:"08:00"} then {action:"interrupt", from:"19:00", to:"08:00", sender_role:"partner"}',
			'• "tell me right away if anyone says settlement offer" → {action:"interrupt", keyword:"settlement offer"}',
			'• "never notify me about the Wilson case, even if I\'m tagged" → {action:"silence", keyword:"Wilson"}',
			'• "mute Dana in #ops" → {action:"digest", channel:"ops", sender:"dana"}',
			'',
			'IMPORTANT: rules only ever take notifications AWAY — a message matching NO rule is delivered exactly as it is today. So "quiet by default" has to be said out loud with an {everything:true} digest rule, which narrower rules then beat. A "digest" rule will NOT downgrade a message that mentions the user directly unless include_mentions is true — set that only when they explicitly say "even if I\'m mentioned". A "silence" rule always applies, mentions included, and is filtered out of the digest and morning brief too, so use it only when the user really means never.',
			'When several rules match, the more specific one wins. If the request does not fit these fields, say so instead of guessing.',
		].join('\n'),
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: NOTIFICATION_ACTIONS, description: 'interrupt | digest | silence' },
				channel: { type: 'string', description: 'Channel/room name, e.g. "hernandez-v-state". Matched case-insensitively, exact first then as a substring.' },
				sender: { type: 'string', description: 'A username, e.g. "dana".' },
				sender_role: { type: 'string', description: 'A role the sender holds, e.g. "partner", "admin", "owner".' },
				keyword: { type: 'string', description: 'A word or phrase in the message. Whole-word, case-insensitive ("SOL" will not match "solution").' },
				from: { type: 'string', description: 'Start of a time-of-day window on the user\'s clock, 24-hour "HH:MM" (also accepts "7pm").' },
				to: { type: 'string', description: 'End of the window, exclusive. May be earlier than "from" to cross midnight, e.g. from 19:00 to 08:00.' },
				everything: {
					type: 'boolean',
					description:
						'Apply to every message. Use ONLY for an explicit "quiet by default" instruction ("only interrupt me for X", "hold everything unless I am mentioned"), paired with narrower rules for the exceptions. Any rule with a real condition beats it.',
				},
				include_mentions: { type: 'boolean', description: 'Only for action="digest": let it apply even when the user is mentioned directly. Default false.' },
			},
			required: ['action'],
		},
	},
	access: 'user',
	async execute(input, actor: IUser) {
		const { rule, total } = await addNotificationRule(actor._id, {
			action: input.action,
			channel: input.channel,
			sender: input.sender,
			senderRole: input.sender_role,
			keyword: input.keyword,
			from: input.from,
			to: input.to,
			everything: input.everything,
			includeMentions: input.include_mentions,
		});
		return [
			`Rule added — **${describeRule(rule)}**`,
			`You now have ${total} of ${MAX_RULES_PER_USER} notification rules. Say "list my notification rules" to see them all.`,
			'',
			DEFAULTS_NOTE,
		].join('\n');
	},
};

const listNotificationRulesTool: ChiTool = {
	def: {
		name: 'list_notification_rules',
		description:
			'Show the caller their smart-notification rules — what currently interrupts them, what goes to the digest, what is silenced — as a numbered list. Use for "what are my notification rules", "what interrupts me", "why didn\'t I get notified about X", "show my quiet hours". The numbers it prints are what remove_notification_rule takes.',
		inputSchema: { type: 'object', properties: {} },
	},
	access: 'user',
	async execute(_input, actor: IUser) {
		const rules = await getNotificationRules(actor._id);
		if (!rules.length) {
			return [
				'You have no smart-notification rules yet.',
				'',
				DEFAULTS_NOTE,
				'',
				'Tell me things like "only interrupt me for the Hernandez matter" or "nothing after 7pm unless it\'s from a partner" and I\'ll set them up.',
			].join('\n');
		}
		return [
			`Your ${rules.length} notification rule${rules.length === 1 ? '' : 's'} (most specific rule wins when several match):`,
			...describeRules(rules).map((line) => `${line}`),
			'',
			DEFAULTS_NOTE,
		].join('\n');
	},
};

const removeNotificationRuleTool: ChiTool = {
	def: {
		name: 'remove_notification_rule',
		description:
			'Remove ONE of the caller\'s smart-notification rules, by the number shown in the rules list or by its id. Use for "delete rule 2", "stop silencing the Wilson case", "remove my quiet hours". If you are not sure which rule they mean, call list_notification_rules first and ask.',
		inputSchema: {
			type: 'object',
			properties: { rule: { type: 'string', description: 'The 1-based number from the rules list, or the rule id shown beside it.' } },
			required: ['rule'],
		},
	},
	access: 'user',
	async execute(input, actor: IUser) {
		const ref = str(input.rule);
		if (!ref) {
			return 'Which rule should I remove? Say "list my notification rules" and give me its number.';
		}
		const { removed, total } = await removeNotificationRule(actor._id, ref);
		return `Removed — ${describeRule(removed)}\nYou have ${total} rule${total === 1 ? '' : 's'} left.`;
	},
};

const clearNotificationRulesTool: ChiTool = {
	def: {
		name: 'clear_notification_rules',
		description:
			'Delete ALL of the caller\'s smart-notification rules and go back to the defaults (mentions and DMs interrupt, everything else collects into the digest). Use for "clear all my notification rules", "reset my notification triage", "start over with notifications". This is confirmed before it runs.',
		inputSchema: { type: 'object', properties: {} },
	},
	access: 'user',
	needsConfirm: () => 'Delete ALL of your smart-notification rules and go back to the defaults. This cannot be undone.',
	async execute(_input, actor: IUser) {
		const removed = await clearNotificationRules(actor._id);
		if (!removed) {
			return 'You had no notification rules — nothing to clear.';
		}
		return [`Cleared all ${removed} of your notification rules.`, '', DEFAULTS_NOTE].join('\n');
	},
};

export const CHI_NOTIFY_TOOLS: ChiTool[] = [
	addNotificationRuleTool,
	listNotificationRulesTool,
	removeNotificationRuleTool,
	clearNotificationRulesTool,
];
