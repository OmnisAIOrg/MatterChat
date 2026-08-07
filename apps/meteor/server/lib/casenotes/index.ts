import { applyMeetingOutcome } from './client';
import { resolveCaseNotesConfig } from './config';
import { caseNotesTransport } from './transport';
import type { MeetingRecord } from './transport';
import { OmnisFeedPoller } from '../omnis/feedPoller';
import type { OmnisFeedItem } from '../omnis/feedPoller';
import { SystemLogger } from '../logger/system';

export { listMeetingsFeed, dispatchBot, startRecording, stopRecording, canPostToChannel, recordingAuditFor } from './client';
export { resolveCaseNotesConfig } from './config';

export const CASENOTES_FEED_EVENT = 'casenotes-feed';

type MeetingDelta = OmnisFeedItem & { meeting: MeetingRecord };

/**
 * Meeting lifecycle: joined → recording → processing → ready.
 *
 * A poller rather than a webhook, for the same reason AutoDoc uses one: it
 * keeps the dependency one-directional and runs once per workspace instead of
 * once per open tab.
 *
 * The poller is also where **completion side effects** fire. A meeting reaching
 * `ready` is what files the transcript, stamps the matter and posts the
 * summary, and `applyMeetingOutcome` is called exactly once per transition
 * because the delta only reports a meeting whose `status_changed_at` moved.
 */
const completed = new Set<string>();

export const caseNotesFeedPoller = new OmnisFeedPoller<MeetingDelta>({
	product: 'CaseNotes',
	event: CASENOTES_FEED_EVENT,
	viewPermission: 'casenotes-view-queue',
	intervalSeconds: () => 20,
	isEnabled: () => resolveCaseNotesConfig().enabled,
	async fetchFeed() {
		const cfg = resolveCaseNotesConfig();
		const meetings = await caseNotesTransport(cfg).listMeetings();

		// Fire completion side effects for meetings that have just become usable.
		// Guarded by an in-process set as well as the delta, so a restart mid-poll
		// cannot double-post a summary within the same process lifetime.
		for (const meeting of meetings) {
			if ((meeting.status === 'ready' || meeting.status === 'low_audio') && !completed.has(meeting.id)) {
				completed.add(meeting.id);
				void applyMeetingOutcome(meeting).catch((err) =>
					SystemLogger.warn({ msg: 'CaseNotes: meeting outcome failed', meetingId: meeting.id, err }),
				);
			}
		}

		return meetings.map((meeting) => ({ id: meeting.id, changedAt: meeting.status_changed_at, meeting }));
	},
});

export function startCaseNotes(): void {
	caseNotesFeedPoller.start();
	const cfg = resolveCaseNotesConfig();
	SystemLogger.info({ msg: 'CaseNotes meetings started', enabled: cfg.enabled, transport: cfg.transport });
}
