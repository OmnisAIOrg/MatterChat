import { API } from '../api';
import { omnisCtx } from './omnisApiContext';
import { canPostToChannel, dispatchBot, listMeetingsFeed, startRecording, stopRecording } from '../../lib/casenotes/client';
import { resolveCaseNotesConfig } from '../../lib/casenotes/config';
import type { MeetingKind } from '../../lib/casenotes/transport';
import { resolveRoomMatter } from '../../lib/omnis/matter';

/**
 * CaseNotes meetings.
 *
 * | Route                          | Permission              |
 * | ------------------------------ | ----------------------- |
 * | `GET  /v1/casenotes.feed`      | `casenotes-view-queue`  |
 * | `GET  /v1/casenotes.consent`   | `casenotes-record`      |
 * | `POST /v1/casenotes.dispatchBot` | `casenotes-record`    |
 * | `POST /v1/casenotes.startRecording` | `casenotes-record` |
 * | `POST /v1/casenotes.stopRecording`  | `casenotes-record` |
 *
 * `stopRecording` is intentionally on the BROAD permission and does not check
 * who dispatched the bot: the spec requires a stop control available to anyone
 * in the meeting, not just the dispatcher.
 */

const KINDS: MeetingKind[] = ['client-check-in', 'provider-call', 'defense-counsel-call', 'internal-strategy', 'dictated-memo', 'site-visit'];

function parseKind(value: unknown): MeetingKind | null {
	return KINDS.includes(value as MeetingKind) ? (value as MeetingKind) : null;
}

API.v1.addRoute(
	'casenotes.feed',
	{ authRequired: true, permissionsRequired: ['casenotes-view-queue'] },
	{
		async get() {
			const { roomId } = omnisCtx(this).queryParams as { roomId?: string };
			const matter = roomId ? await resolveRoomMatter(roomId) : null;
			return API.v1.success(await listMeetingsFeed(matter?.matterId));
		},
	},
);

/**
 * The disclosure the bot will announce, so the dispatch panel can SHOW it
 * before anyone presses record. A consent notice the dispatcher never sees is
 * not meaningfully a consent notice.
 */
API.v1.addRoute(
	'casenotes.consent',
	{ authRequired: true, permissionsRequired: ['casenotes-record'] },
	{
		async get() {
			const cfg = resolveCaseNotesConfig();
			const { roomId, kind } = omnisCtx(this).queryParams as { roomId?: string; kind?: string };

			const parsedKind = parseKind(kind);
			const postingBlocked = parsedKind && roomId ? !(await canPostToChannel(parsedKind, roomId)) : false;

			return API.v1.success({
				botDisplayName: cfg.botDisplayName,
				disclosure: cfg.recordingDisclosure,
				// Warns the dispatcher up front that a work-product summary will NOT
				// be posted here, rather than leaving them to wonder where it went.
				postingBlocked,
			});
		},
	},
);

API.v1.addRoute(
	'casenotes.dispatchBot',
	{
		authRequired: true,
		permissionsRequired: ['casenotes-record'],
		rateLimiterOptions: { numRequestsAllowed: 20, intervalTimeInMS: 60000 },
	},
	{
		async post() {
			const { meetingUrl, kind, matterId, roomId } = omnisCtx(this).bodyParams as {
				meetingUrl?: string;
				kind?: string;
				matterId?: string;
				roomId?: string;
			};

			if (!meetingUrl) {
				return API.v1.failure('meetingUrl is required');
			}
			const parsedKind = parseKind(kind);
			if (!parsedKind) {
				return API.v1.failure('A meeting type is required');
			}

			const fromRoom = roomId ? await resolveRoomMatter(roomId) : null;
			const resolvedMatterId = matterId ?? fromRoom?.matterId;

			try {
				const meeting = await dispatchBot({
					meetingUrl,
					kind: parsedKind,
					...(resolvedMatterId ? { matterId: resolvedMatterId } : {}),
					...(roomId ? { roomId } : {}),
					requestedBy: omnisCtx(this).userId,
				});
				return API.v1.success({ meeting });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Could not dispatch the notetaker');
			}
		},
	},
);

API.v1.addRoute(
	'casenotes.startRecording',
	{ authRequired: true, permissionsRequired: ['casenotes-record'] },
	{
		async post() {
			const { kind, matterId, roomId } = omnisCtx(this).bodyParams as { kind?: string; matterId?: string; roomId?: string };
			const parsedKind = parseKind(kind);
			if (!parsedKind) {
				return API.v1.failure('A recording type is required');
			}

			const fromRoom = roomId ? await resolveRoomMatter(roomId) : null;
			const resolvedMatterId = matterId ?? fromRoom?.matterId;

			try {
				const meeting = await startRecording({
					kind: parsedKind,
					...(resolvedMatterId ? { matterId: resolvedMatterId } : {}),
					...(roomId ? { roomId } : {}),
					requestedBy: omnisCtx(this).userId,
				});
				return API.v1.success({ meeting });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Could not start recording');
			}
		},
	},
);

API.v1.addRoute(
	'casenotes.stopRecording',
	{ authRequired: true, permissionsRequired: ['casenotes-record'] },
	{
		async post() {
			const { meetingId } = omnisCtx(this).bodyParams as { meetingId?: string };
			if (!meetingId) {
				return API.v1.failure('meetingId is required');
			}
			try {
				// No dispatcher check by design — see the note at the top of this file.
				await stopRecording(meetingId, omnisCtx(this).userId);
				return API.v1.success();
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Could not stop the recording');
			}
		},
	},
);
