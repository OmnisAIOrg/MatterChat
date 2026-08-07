import type { Collection, IndexDescription } from 'mongodb';

import { db } from '../../database/utils';
import { SystemLogger } from '../logger/system';

/**
 * Document type → data entry.
 *
 * **This is the core of the feature.** "Send this for signature" is the easy
 * half; the valuable half is that a *signed* Letter of Protection is not just a
 * PDF — it means the LOP date is set, the provider joins the lien schedule, and
 * the matter's posture changes. A signed fee agreement starts the statute of
 * limitations clock.
 *
 * So the document type is a **trigger key**, exactly like the tag taxonomy in
 * the CasePro status dashboard: *tags are the trigger, rows are the truth*.
 * Choosing the type at send time is what lets the matter update itself at sign
 * time.
 *
 * ## Why this is data, not a switch statement
 *
 * The table below is "a starting set drawn from PI practice, not a closed
 * list". Firms differ, and a firm that needs its own type should not need a
 * deploy. Each row is therefore a **mapping record** (document type → ordered
 * list of actions) stored in a fork-owned collection and seeded from the
 * defaults on first boot. Actions are modelled on the CasePro task-automation
 * engine's verbs rather than inventing a second automation system.
 */

const COLLECTION_NAME = 'omnisproof_document_types';

/**
 * The action vocabulary. Deliberately small and declarative — each verb names a
 * thing that happens to a matter, and `automations.ts` is the only place that
 * knows how to perform one.
 */
export type EsignActionKind =
	| 'file-document' // put the signed PDF somewhere on the matter
	| 'set-field' // set a matter field (LOP on file, fee %, release date…)
	| 'set-status' // move the matter's status
	| 'add-to-lien-schedule'
	| 'unlock-records-requests'
	| 'authorize-provider'
	| 'queue-task'
	| 'start-sol-clock' // statute of limitations
	| 'open-checklist';

export type EsignAction = {
	kind: EsignActionKind;
	/** Human-readable line for the consequence preview AND the receipt. */
	label: string;
	/** Verb-specific payload, e.g. `{ field: 'lop_on_file', value: 'yes' }`. */
	params?: Record<string, unknown>;
};

export type EsignDocumentType = {
	_id: string;
	/** Stable key used on the wire and in the envelope mapping. */
	key: string;
	label: string;
	/** Ordered — the receipt enumerates them in this order. */
	actions: EsignAction[];
	/** False for firm-authored rows that have been retired. */
	active: boolean;
	/** True for the shipped defaults, so a reseed can leave firm rows alone. */
	builtIn: boolean;
};

const INDEXES: IndexDescription[] = [{ key: { key: 1 }, unique: true }];

const collection: Collection<EsignDocumentType> = db.collection<EsignDocumentType>(COLLECTION_NAME);

/**
 * The shipped defaults, straight from the spec's table.
 *
 * Note the last two rows. `other` files the document and fires nothing, and the
 * NON-matter path is not in this table at all — a General document is saved to
 * the user's LitBox and posted to the channel, and **no matter is updated and
 * no data entry fires**. Modelling "no matter" as an empty action list here
 * would make it look like a type, which is exactly the confusion the fork in
 * the send panel exists to prevent.
 */
export const DEFAULT_DOCUMENT_TYPES: Omit<EsignDocumentType, '_id'>[] = [
	{
		key: 'lop',
		label: 'Letter of Protection (LOP)',
		active: true,
		builtIn: true,
		actions: [
			{ kind: 'file-document', label: 'File signed PDF to {matter} → Documents', params: { folder: 'Documents' } },
			{ kind: 'set-field', label: 'LOP on file = Yes, dated today', params: { field: 'lop_on_file', value: true, stampDate: 'lop_date' } },
			{ kind: 'add-to-lien-schedule', label: 'Add the provider to the lien schedule' },
		],
	},
	{
		key: 'hipaa',
		label: 'HIPAA Authorization',
		active: true,
		builtIn: true,
		actions: [
			{ kind: 'file-document', label: 'File to {matter} → Documents', params: { folder: 'Documents' } },
			{
				kind: 'set-field',
				label: 'HIPAA on file = Yes (12-month expiry)',
				params: { field: 'hipaa_on_file', value: true, stampDate: 'hipaa_date', expiryMonths: 12 },
			},
			{ kind: 'unlock-records-requests', label: 'Unlock records requests for every provider on the matter' },
			{ kind: 'queue-task', label: 'Queue the records request letters as a task', params: { task: 'Send records request letters' } },
		],
	},
	{
		key: 'fee-agreement',
		label: 'Fee Agreement / Contingency',
		active: true,
		builtIn: true,
		actions: [
			{ kind: 'file-document', label: 'File to {matter} → Documents', params: { folder: 'Documents' } },
			{ kind: 'set-field', label: 'Set fee % and representation date', params: { field: 'fee_percentage', stampDate: 'representation_date' } },
			{ kind: 'set-status', label: 'Move status Intake → Represented', params: { from: 'Intake', to: 'Represented' } },
			{ kind: 'start-sol-clock', label: 'Start the statute of limitations clock' },
		],
	},
	{
		key: 'medical-auth',
		label: 'Medical Authorization (per provider)',
		active: true,
		builtIn: true,
		actions: [
			{ kind: 'file-document', label: 'File under the provider on the matter', params: { folder: 'Providers' } },
			{ kind: 'authorize-provider', label: 'Mark that provider authorized' },
			{ kind: 'queue-task', label: 'Release its pending records request', params: { task: 'Release pending records request' } },
		],
	},
	{
		key: 'settlement-release',
		label: 'Settlement Release',
		active: true,
		builtIn: true,
		actions: [
			{ kind: 'file-document', label: 'File to {matter} → Settlement', params: { folder: 'Settlement' } },
			{ kind: 'set-field', label: 'Set release signed date', params: { stampDate: 'release_signed_date' } },
			{ kind: 'set-status', label: 'Status → Settled — awaiting funds', params: { to: 'Settled — awaiting funds' } },
			{ kind: 'open-checklist', label: 'Open the lien negotiation checklist', params: { checklist: 'lien-negotiation' } },
		],
	},
	{
		key: 'other',
		label: 'Other',
		active: true,
		builtIn: true,
		actions: [{ kind: 'file-document', label: 'File to {matter} → Documents', params: { folder: 'Documents' } }],
	},
];

let seeded = false;

/** Idempotent: seeds the built-ins once, never overwriting a firm's edits. */
export async function ensureDocumentTypes(): Promise<void> {
	if (seeded) {
		return;
	}
	seeded = true;
	try {
		await collection.createIndexes(INDEXES);
		await Promise.all(
			DEFAULT_DOCUMENT_TYPES.map((type) =>
				collection.updateOne(
					{ key: type.key },
					// $setOnInsert only: a firm that has retuned a built-in keeps its
					// version across restarts and upgrades.
					{ $setOnInsert: { ...type, _id: `omnisproof-doctype-${type.key}` } },
					{ upsert: true },
				),
			),
		);
	} catch (err) {
		SystemLogger.warn({ msg: 'OmnisProof: failed to seed document types', err });
	}
}

export async function listDocumentTypes(): Promise<EsignDocumentType[]> {
	await ensureDocumentTypes();
	return collection.find({ active: true }, { sort: { builtIn: -1, label: 1 } }).toArray();
}

export async function getDocumentType(key: string): Promise<EsignDocumentType | null> {
	await ensureDocumentTypes();
	return collection.findOne({ key, active: true });
}

/** Admin/firm customisation entry point. */
export async function upsertDocumentType(type: Omit<EsignDocumentType, '_id' | 'builtIn'>): Promise<void> {
	await ensureDocumentTypes();
	await collection.updateOne(
		{ key: type.key },
		{ $set: { label: type.label, actions: type.actions, active: type.active }, $setOnInsert: { _id: `omnisproof-doctype-${type.key}`, builtIn: false } },
		{ upsert: true },
	);
}

/**
 * Render an action's label against a resolved matter.
 *
 * `{matter}` must be substituted with the RESOLVED matter, never a placeholder
 * or the channel that happens to be open. On a screen whose only job is telling
 * you what is about to happen, naming the wrong case is the worst thing to get
 * wrong.
 */
export function renderActionLabel(action: EsignAction, matterName: string): string {
	return action.label.replace(/\{matter\}/g, matterName);
}

/** Test seam. */
export function resetDocumentTypeSeedForTests(): void {
	seeded = false;
}
