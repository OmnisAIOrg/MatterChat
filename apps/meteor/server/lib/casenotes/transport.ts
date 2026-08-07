import type { CaseNotesConfig } from './config';
import { omnisFetchJson } from '../omnis/http';

/**
 * The only thing in the CaseNotes integration that touches the wire.
 *
 * CaseNotes' backend already exists (there is a CaseNotes MCP server), so this
 * is a wiring job rather than a from-scratch product — but MatterChat's end was
 * a stub that only `console.debug`d, so everything below is new.
 */

export type MeetingPlatform = 'zoom' | 'meet' | 'teams' | 'in-person';

export type MeetingKind = 'client-check-in' | 'provider-call' | 'defense-counsel-call' | 'internal-strategy' | 'dictated-memo' | 'site-visit';

export type MeetingStatus = 'joining' | 'recording' | 'processing' | 'ready' | 'low_audio' | 'failed';

export type MeetingRecord = {
	id: string;
	title: string;
	status: MeetingStatus;
	/** Monotonic change marker — the diff key for the poller. */
	status_changed_at: string;
	startedAt: string;
	durationSeconds?: number;
	participantCount?: number;
	platform: MeetingPlatform;
	kind: MeetingKind;
	matterId?: string;
	summary?: string;
	transcriptRef?: string;
	actionItems?: string[];
};

export type DispatchBotInput = {
	meetingUrl: string;
	kind: MeetingKind;
	matterId?: string;
	/** Announced in-meeting on join. Never optional at the call site. */
	disclosure: string;
	botDisplayName: string;
	requestedBy: string;
};

export interface ICaseNotesTransport {
	readonly kind: 'stub' | 'native';
	listMeetings(): Promise<MeetingRecord[]>;
	getMeeting(id: string): Promise<MeetingRecord | null>;
	dispatchBot(input: DispatchBotInput): Promise<MeetingRecord>;
	startRecording(input: { kind: MeetingKind; matterId?: string; disclosure: string; requestedBy: string }): Promise<MeetingRecord>;
	/** Available to ANYONE in the meeting, not only the dispatcher. */
	stopRecording(id: string): Promise<void>;
}

function iso(minutesAgo: number): string {
	return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

export class CaseNotesStubTransport implements ICaseNotesTransport {
	readonly kind = 'stub' as const;

	private meetings: MeetingRecord[] = seedMeetings();

	private counter = 0;

	async listMeetings(): Promise<MeetingRecord[]> {
		return [...this.meetings].sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
	}

	async getMeeting(id: string): Promise<MeetingRecord | null> {
		return this.meetings.find((m) => m.id === id) ?? null;
	}

	async dispatchBot(input: DispatchBotInput): Promise<MeetingRecord> {
		this.counter += 1;
		const record: MeetingRecord = {
			id: `stub-meeting-${this.counter}`,
			title: `Meeting via ${platformOf(input.meetingUrl)}`,
			status: 'joining',
			status_changed_at: new Date().toISOString(),
			startedAt: new Date().toISOString(),
			platform: platformOf(input.meetingUrl),
			kind: input.kind,
			...(input.matterId ? { matterId: input.matterId } : {}),
		};
		this.meetings = [record, ...this.meetings];
		return record;
	}

	async startRecording(input: { kind: MeetingKind; matterId?: string }): Promise<MeetingRecord> {
		this.counter += 1;
		const record: MeetingRecord = {
			id: `stub-rec-${this.counter}`,
			title: 'In-person recording',
			status: 'recording',
			status_changed_at: new Date().toISOString(),
			startedAt: new Date().toISOString(),
			platform: 'in-person',
			kind: input.kind,
			...(input.matterId ? { matterId: input.matterId } : {}),
		};
		this.meetings = [record, ...this.meetings];
		return record;
	}

	async stopRecording(id: string): Promise<void> {
		const record = this.meetings.find((m) => m.id === id);
		if (record) {
			record.status = 'processing';
			record.status_changed_at = new Date().toISOString();
		}
	}

	reset(): void {
		this.meetings = seedMeetings();
		this.counter = 0;
	}
}

export function platformOf(url: string): MeetingPlatform {
	const lower = url.toLowerCase();
	if (lower.includes('zoom.')) {
		return 'zoom';
	}
	if (lower.includes('meet.google')) {
		return 'meet';
	}
	if (lower.includes('teams.microsoft') || lower.includes('teams.live')) {
		return 'teams';
	}
	return 'in-person';
}

/** True for a URL we can actually dispatch a bot into. */
export function isSupportedMeetingUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') {
			return false;
		}
		return platformOf(url) !== 'in-person';
	} catch {
		return false;
	}
}

function seedMeetings(): MeetingRecord[] {
	return [
		{
			id: 'stub-m1',
			title: 'Alvarez — treatment check-in',
			status: 'ready',
			status_changed_at: iso(25),
			startedAt: iso(85),
			durationSeconds: 1_920,
			participantCount: 3,
			platform: 'zoom',
			kind: 'client-check-in',
			matterId: 'stub-matter-1',
			summary: 'Client reports ongoing neck pain; continuing PT twice weekly at Patel Clinic.',
			actionItems: ['Request updated PT records from Patel Clinic', 'Diary a follow-up call in two weeks'],
		},
		{
			id: 'stub-m2',
			title: 'Defense counsel — Duong scheduling',
			status: 'processing',
			status_changed_at: iso(8),
			startedAt: iso(40),
			durationSeconds: 1_140,
			participantCount: 2,
			platform: 'teams',
			kind: 'defense-counsel-call',
			matterId: 'stub-matter-2',
		},
		{
			id: 'stub-m3',
			title: 'Provider call — Riverside Imaging',
			status: 'low_audio',
			status_changed_at: iso(200),
			startedAt: iso(260),
			durationSeconds: 640,
			participantCount: 2,
			platform: 'meet',
			kind: 'provider-call',
			matterId: 'stub-matter-1',
		},
	];
}

export class CaseNotesNativeTransport implements ICaseNotesTransport {
	readonly kind = 'native' as const;

	constructor(private readonly cfg: CaseNotesConfig) {}

	async listMeetings(): Promise<MeetingRecord[]> {
		const raw = await omnisFetchJson<{ meetings?: unknown[]; data?: unknown[] }>(this.cfg, '/api/v1/meetings');
		return (raw.meetings ?? raw.data ?? []).map(normalizeMeeting).filter((m): m is MeetingRecord => Boolean(m));
	}

	async getMeeting(id: string): Promise<MeetingRecord | null> {
		return normalizeMeeting(await omnisFetchJson<unknown>(this.cfg, `/api/v1/meetings/${encodeURIComponent(id)}`));
	}

	async dispatchBot(input: DispatchBotInput): Promise<MeetingRecord> {
		const raw = await omnisFetchJson<unknown>(this.cfg, '/api/v1/bots/dispatch', {
			method: 'POST',
			json: {
				meeting_url: input.meetingUrl,
				meeting_type: input.kind,
				...(input.matterId ? { matter_id: input.matterId } : {}),
				// Sent on EVERY dispatch: the bot announces this on join and the
				// backend records that it was shown.
				disclosure_text: input.disclosure,
				bot_display_name: input.botDisplayName,
				requested_by: input.requestedBy,
			},
		});
		const record = normalizeMeeting(raw);
		if (!record) {
			throw new Error('CaseNotes returned an unreadable meeting on dispatch');
		}
		return record;
	}

	async startRecording(input: { kind: MeetingKind; matterId?: string; disclosure: string; requestedBy: string }): Promise<MeetingRecord> {
		const raw = await omnisFetchJson<unknown>(this.cfg, '/api/v1/recordings', {
			method: 'POST',
			json: {
				meeting_type: input.kind,
				...(input.matterId ? { matter_id: input.matterId } : {}),
				disclosure_text: input.disclosure,
				requested_by: input.requestedBy,
			},
		});
		const record = normalizeMeeting(raw);
		if (!record) {
			throw new Error('CaseNotes returned an unreadable recording');
		}
		return record;
	}

	async stopRecording(id: string): Promise<void> {
		await omnisFetchJson<unknown>(this.cfg, `/api/v1/recordings/${encodeURIComponent(id)}/stop`, { method: 'POST' });
	}
}

function normalizeStatus(value: unknown): MeetingStatus {
	switch (String(value)) {
		case 'joining':
		case 'recording':
		case 'processing':
		case 'ready':
		case 'low_audio':
		case 'failed':
			return String(value) as MeetingStatus;
		case 'transcribing':
			return 'processing';
		default:
			return 'processing';
	}
}

function normalizeKind(value: unknown): MeetingKind {
	const known: MeetingKind[] = ['client-check-in', 'provider-call', 'defense-counsel-call', 'internal-strategy', 'dictated-memo', 'site-visit'];
	const candidate = String(value) as MeetingKind;
	return known.includes(candidate) ? candidate : 'client-check-in';
}

export function normalizeMeeting(raw: unknown): MeetingRecord | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const r = raw as Record<string, unknown>;
	const id = typeof r.id === 'string' ? r.id : typeof r.meeting_id === 'string' ? r.meeting_id : undefined;
	if (!id) {
		return null;
	}
	return {
		id,
		title: typeof r.title === 'string' ? r.title : 'Meeting',
		status: normalizeStatus(r.status),
		status_changed_at: typeof r.status_changed_at === 'string' ? r.status_changed_at : new Date(0).toISOString(),
		startedAt: typeof r.started_at === 'string' ? r.started_at : new Date().toISOString(),
		...(typeof r.duration_seconds === 'number' ? { durationSeconds: r.duration_seconds } : {}),
		...(typeof r.participant_count === 'number' ? { participantCount: r.participant_count } : {}),
		platform: typeof r.meeting_url === 'string' ? platformOf(r.meeting_url) : 'in-person',
		kind: normalizeKind(r.meeting_type),
		...(typeof r.matter_id === 'string' ? { matterId: r.matter_id } : {}),
		...(typeof r.summary === 'string' ? { summary: r.summary } : {}),
		...(typeof r.transcript_ref === 'string' ? { transcriptRef: r.transcript_ref } : {}),
		...(Array.isArray(r.action_items) ? { actionItems: r.action_items.filter((i): i is string => typeof i === 'string') } : {}),
	};
}

const stubSingleton = new CaseNotesStubTransport();

export function caseNotesTransport(cfg: CaseNotesConfig): ICaseNotesTransport {
	return cfg.transport === 'native' ? new CaseNotesNativeTransport(cfg) : stubSingleton;
}

export function stubCaseNotesTransportForTests(): CaseNotesStubTransport {
	return stubSingleton;
}
