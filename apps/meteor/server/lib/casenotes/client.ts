import { Random } from '@rocket.chat/random';
import type { Collection, IndexDescription } from 'mongodb';

import { resolveCaseNotesConfig } from './config';
import { caseNotesTransport, isSupportedMeetingUrl } from './transport';
import type { MeetingKind, MeetingRecord } from './transport';
import { db } from '../../database/utils';
import { caseProClient } from '../boards/casepro/client';
import { SystemLogger } from '../logger/system';
import { isClientChannel, matterDisplayName } from '../omnis/matter';
import { postOmnisReceipt } from '../omnis/receipt';

/**
 * CaseNotes domain verbs.
 *
 * ## Consent and disclosure — non-negotiable
 *
 * Recording law varies by state and this is a law firm, so:
 *
 *   - the bot appears as a **named, visible participant**, never a silent or
 *     hidden recorder — `botDisplayName` is sent on every dispatch;
 *   - recording is **announced on join**, using firm-configurable text, and the
 *     fact that it was shown is logged;
 *   - **anyone in the meeting** can stop the recording, not only the person who
 *     dispatched the bot;
 *   - a per-recording audit record is retained: who dispatched it, when, to
 *     which meeting, which matter.
 *
 * The spec is explicit that if visible presence cannot be guaranteed, the
 * feature should not ship. `dispatchBot` therefore refuses to dispatch without
 * a display name and disclosure text — there is no code path that records
 * silently.
 *
 * ## Work product must never reach a client-facing channel
 *
 * `IRoom.clientChannel` marks a client-facing room. Internal strategy notes and
 * defense-counsel calls are work product, and channel visibility is treated as
 * a HARD gate on where a transcript or summary is posted — see
 * {@link canPostToChannel}.
 */

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const AUDIT_COLLECTION = 'casenotes_recording_audit';

export type RecordingAudit = {
	_id: string;
	meetingId: string;
	dispatchedBy: string;
	dispatchedAt: Date;
	meetingUrl?: string;
	matterId?: string;
	kind: MeetingKind;
	/** The exact text announced, retained as evidence that consent was sought. */
	disclosureShown: string;
	botDisplayName: string;
	stoppedBy?: string;
	stoppedAt?: Date;
};

const auditIndexes: IndexDescription[] = [{ key: { meetingId: 1 } }, { key: { dispatchedAt: -1 } }];
const audit: Collection<RecordingAudit> = db.collection<RecordingAudit>(AUDIT_COLLECTION);

let auditIndexesEnsured = false;
const ensureAuditIndexes = (): void => {
	if (auditIndexesEnsured) {
		return;
	}
	auditIndexesEnsured = true;
	audit.createIndexes(auditIndexes).catch((err) => {
		SystemLogger.warn({ msg: 'CaseNotes: failed to ensure audit indexes', err });
	});
};
ensureAuditIndexes();

export async function recordingAuditFor(meetingId: string): Promise<RecordingAudit | null> {
	return audit.findOne({ meetingId });
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export type MeetingsFeed = {
	enabled: boolean;
	transport: 'stub' | 'native';
	reachable: boolean;
	webUrl: string;
	items: MeetingRecord[];
	summary: { meetings: number; transcribing: number; needsReview: number };
};

export async function listMeetingsFeed(matterId?: string): Promise<MeetingsFeed> {
	const cfg = resolveCaseNotesConfig();
	const base = { enabled: cfg.enabled, transport: cfg.transport, webUrl: cfg.webUrl };

	if (!cfg.enabled) {
		return { ...base, reachable: true, items: [], summary: { meetings: 0, transcribing: 0, needsReview: 0 } };
	}

	try {
		const all = await caseNotesTransport(cfg).listMeetings();
		const items = matterId ? all.filter((m) => m.matterId === matterId) : all;
		return {
			...base,
			reachable: true,
			items,
			summary: {
				meetings: items.length,
				transcribing: items.filter((m) => m.status === 'processing' || m.status === 'recording' || m.status === 'joining').length,
				// LOW AUDIO earns its place: a transcript from a bad phone speaker
				// needs a human before anyone relies on it, and silently shipping a
				// poor transcript into a matter is worse than flagging it.
				needsReview: items.filter((m) => m.status === 'low_audio' || m.status === 'failed').length,
			},
		};
	} catch (err) {
		SystemLogger.warn({ msg: 'CaseNotes feed unavailable — serving a degraded feed', err });
		return { ...base, reachable: false, items: [], summary: { meetings: 0, transcribing: 0, needsReview: 0 } };
	}
}

// ---------------------------------------------------------------------------
// Dispatch / record
// ---------------------------------------------------------------------------

export type DispatchInput = {
	meetingUrl: string;
	kind: MeetingKind;
	matterId?: string;
	roomId?: string;
	requestedBy: string;
};

/**
 * Send the notetaker into any Zoom / Meet / Teams call.
 *
 * **The meeting does not have to be a MatterChat huddle** — that is the whole
 * point, and it is what makes MatterChat the control surface for meeting
 * capture rather than one more app that records only its own calls.
 */
export async function dispatchBot(input: DispatchInput): Promise<MeetingRecord> {
	const cfg = resolveCaseNotesConfig();
	if (!cfg.enabled) {
		throw new Error('CaseNotes is not enabled on this workspace');
	}
	if (!isSupportedMeetingUrl(input.meetingUrl)) {
		throw new Error('That does not look like a Zoom, Google Meet, or Microsoft Teams link');
	}
	// No silent recorder, ever. Empty config would mean an unnamed bot and no
	// announcement, so refuse rather than degrade.
	if (!cfg.botDisplayName.trim() || !cfg.recordingDisclosure.trim()) {
		throw new Error('A bot display name and a recording disclosure are required before a notetaker can be dispatched');
	}

	const meeting = await caseNotesTransport(cfg).dispatchBot({
		meetingUrl: input.meetingUrl,
		kind: input.kind,
		...(input.matterId ? { matterId: input.matterId } : {}),
		disclosure: cfg.recordingDisclosure,
		botDisplayName: cfg.botDisplayName,
		requestedBy: input.requestedBy,
	});

	await writeAudit(meeting.id, input, cfg.recordingDisclosure, cfg.botDisplayName);
	return meeting;
}

/** In-person meetings, calls on speaker, dictated memos. Same consent rules. */
export async function startRecording(input: Omit<DispatchInput, 'meetingUrl'>): Promise<MeetingRecord> {
	const cfg = resolveCaseNotesConfig();
	if (!cfg.enabled) {
		throw new Error('CaseNotes is not enabled on this workspace');
	}
	if (!cfg.recordingDisclosure.trim()) {
		throw new Error('A recording disclosure is required before a recording can start');
	}

	const meeting = await caseNotesTransport(cfg).startRecording({
		kind: input.kind,
		...(input.matterId ? { matterId: input.matterId } : {}),
		disclosure: cfg.recordingDisclosure,
		requestedBy: input.requestedBy,
	});

	await writeAudit(meeting.id, { ...input, meetingUrl: '' }, cfg.recordingDisclosure, cfg.botDisplayName);
	return meeting;
}

/**
 * Stop a recording.
 *
 * Deliberately NOT restricted to the dispatcher: the spec requires a
 * stop-recording control available to anyone in the meeting. The route gates on
 * `casenotes-record`, which is granted broadly, and nothing here re-checks who
 * started it.
 */
export async function stopRecording(meetingId: string, stoppedBy: string): Promise<void> {
	const cfg = resolveCaseNotesConfig();
	if (!cfg.enabled) {
		throw new Error('CaseNotes is not enabled on this workspace');
	}
	await caseNotesTransport(cfg).stopRecording(meetingId);
	await audit.updateOne({ meetingId }, { $set: { stoppedBy, stoppedAt: new Date() } });
}

async function writeAudit(meetingId: string, input: DispatchInput, disclosure: string, botDisplayName: string): Promise<void> {
	ensureAuditIndexes();
	try {
		await audit.insertOne({
			_id: Random.id(),
			meetingId,
			dispatchedBy: input.requestedBy,
			dispatchedAt: new Date(),
			...(input.meetingUrl ? { meetingUrl: input.meetingUrl } : {}),
			...(input.matterId ? { matterId: input.matterId } : {}),
			kind: input.kind,
			disclosureShown: disclosure,
			botDisplayName,
		});
	} catch (err) {
		// Audit is evidence, so a failure is logged loudly — but the recording is
		// already running and killing it here would be worse.
		SystemLogger.error({ msg: 'CaseNotes: failed to write the recording audit record', meetingId, err });
	}
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Whether a meeting's output may be posted into a given channel.
 *
 * A client-facing channel exists in this product, and internal strategy notes
 * must never land in one. Defense-counsel calls are litigation communications
 * and get the same treatment — the full transcript is not posted to a
 * client-facing channel either.
 *
 * Treated as a hard gate rather than a warning: the cost of the wrong answer is
 * privileged work product in front of a client.
 */
export async function canPostToChannel(kind: MeetingKind, roomId: string): Promise<boolean> {
	const workProduct = kind === 'internal-strategy' || kind === 'defense-counsel-call';
	if (!workProduct) {
		return true;
	}
	return !(await isClientChannel(roomId));
}

/**
 * Meeting type drives what happens afterward — the same trigger-key model as
 * OmnisProof's document type, kept modest to start.
 */
export async function applyMeetingOutcome(meeting: MeetingRecord, roomId?: string): Promise<void> {
	const cfg = resolveCaseNotesConfig();
	if (!meeting.matterId) {
		return; // "Just me": filed to the user's own workspace, no matter touched.
	}

	const matterName = await matterDisplayName(meeting.matterId);
	const steps: { label: string; ok: boolean; detail?: string }[] = [];

	steps.push({ label: `Transcript and summary filed to ${matterName} → Notes`, ok: true });

	// Action items become tasks on the matter.
	for (const item of meeting.actionItems ?? []) {
		try {
			await caseProClient.updateMatter(meeting.matterId, { queued_task: item });
			steps.push({ label: `Task created: ${item}`, ok: true });
		} catch (err) {
			steps.push({ label: `Task created: ${item}`, ok: false, detail: err instanceof Error ? err.message : 'Unknown error' });
		}
	}

	switch (meeting.kind) {
		case 'client-check-in':
			await stampField(meeting.matterId, 'last_client_contact', new Date().toISOString(), steps, 'Stamped last client contact');
			break;
		case 'provider-call':
			await stampField(meeting.matterId, 'provider_note', meeting.summary ?? '', steps, 'Attached the note to the provider');
			break;
		case 'defense-counsel-call':
			await stampField(meeting.matterId, 'litigation_communication', meeting.id, steps, 'Flagged as a litigation communication');
			break;
		case 'internal-strategy':
			await stampField(meeting.matterId, 'work_product_note', meeting.id, steps, 'Filed as work product');
			break;
		default:
			break;
	}

	if (!roomId) {
		return;
	}

	// The hard gate. Work product never reaches a client-facing channel — not
	// even the summary.
	if (!(await canPostToChannel(meeting.kind, roomId))) {
		SystemLogger.info({
			msg: 'CaseNotes: suppressed a work-product summary in a client-facing channel',
			meetingId: meeting.id,
			roomId,
		});
		return;
	}

	const auditRecord = await recordingAuditFor(meeting.id);
	await postOmnisReceipt({
		rid: roomId,
		uid: auditRecord?.dispatchedBy ?? meeting.id,
		title: `🎙️ ${meeting.title} · ${meeting.status === 'low_audio' ? 'needs review (low audio)' : 'ready'}`,
		matterName,
		steps,
		...(cfg.webUrl ? { link: { text: 'Open in CaseNotes', url: `${cfg.webUrl.replace(/\/+$/, '')}/meetings/${meeting.id}` } } : {}),
	});
}

async function stampField(
	matterId: string,
	field: string,
	value: unknown,
	steps: { label: string; ok: boolean; detail?: string }[],
	label: string,
): Promise<void> {
	try {
		await caseProClient.updateMatter(matterId, { [field]: value });
		steps.push({ label, ok: true });
	} catch (err) {
		steps.push({ label, ok: false, detail: err instanceof Error ? err.message : 'Unknown error' });
	}
}
