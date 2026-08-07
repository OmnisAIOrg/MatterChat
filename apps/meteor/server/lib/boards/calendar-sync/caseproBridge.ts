/**
 * CasePro calendar bridge — the PREFERRED-when-present source for a user's calendar sync.
 *
 * LAYERED, ADDITIVE design (see DECISIONS): MatterChat KEEPS its own standalone Google/Outlook OAuth
 * providers + `boards_calendar_connections` token store (the CasePro-free path a cross-firm or
 * non-CasePro firm needs). This bridge adds CasePro as a PREFERRED source: when CasePro is enabled +
 * the live transport is configured + this MatterChat user maps to a CasePro user who has ALREADY
 * connected their Google/Outlook calendar inside CasePro, we route the card↔event sync THROUGH
 * CasePro's own calendar controller — so the user never authorizes a second OAuth app, and there is
 * one calendar OAuth (CasePro's, held in CentralizedAuth) instead of two.
 *
 * Identity link: a MatterChat (Rocket.Chat) user carries `services.omnisai.id` == the CentralizedAuth
 * subject == CasePro `users.id` (set by the omnisai-oauth login handler). CasePro keys its calendar
 * tokens by that same subject (CentralizedAuth `/calendar-integrations/token/:userId`). So "this
 * MatterChat user's calendar" resolves directly to "this CasePro user's connected calendar".
 *
 * Transport: reuses the EXISTING CasePro transport (`resolveTransportFromConfig`) — the same
 * X-MCP-API-Key + X-Organization-ID + advisory X-Acting-User auth and strict egress the reconciliation
 * lane built. No new OAuth app, client id/secret, or token store is introduced MatterChat-side for the
 * CasePro path. CasePro's REST calendar controller (guarded by KeyGateOrSessionAuthGuard, MCP-key path)
 * is called directly:
 *   - POST   /calendar/create              (body: user_id, title, start, end, description, location …)
 *   - PATCH  /calendar/update/:calendarId  (body: patch fields)
 *   - DELETE /calendar/:calendarId         (soft-deletes local + deletes the external mirror)
 *   - GET    /calendar/all-events?userId=&timeMin=&timeMax=   (merged CasePro + external events)
 * CasePro itself creates/updates/deletes the Google/Outlook event using the user's CentralizedAuth
 * token — MatterChat never touches a provider token on this path.
 *
 * GATED: `isCaseProCalendarActive()` is the master gate (CasePro enabled + live transport). Per-user,
 * `preferCaseProForUser()` additionally requires the user to have a CasePro calendar connection —
 * otherwise the caller falls back to MatterChat's own standalone connection. A `null` bridge (any gate
 * off) means "not preferred" and the standalone path runs unchanged.
 */
import type { IBoardCard } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { settings } from '../../../settings';
import { caseProTransportDiagnostics, resolveTransportFromConfig, type ICaseProTransport } from '../casepro/transport';
import { SystemLogger } from '../../logger/system';
import type { ICalendarEvent } from './CalendarProvider';
import { cardToEvent } from './mapping';

/** CasePro calendar controller paths (CRM backend REST, reached via the transport's generic request). */
const CREATE_PATH = 'calendar/create';
const UPDATE_PATH = (calendarId: string): string => `calendar/update/${encodeURIComponent(calendarId)}`;
const DELETE_PATH = (calendarId: string): string => `calendar/${encodeURIComponent(calendarId)}`;
const ALL_EVENTS_PATH = 'calendar/all-events';
const SYNC_STATUS_PATH = 'calendar/sync-status';

/** Master gate: CasePro on AND its live transport configured (else the standalone path owns sync). */
function isCaseProEnabled(): boolean {
	try {
		return settings.get<boolean>('CasePro_Enabled') === true;
	} catch {
		return false;
	}
}

/**
 * Is CasePro a usable calendar source at all right now? Requires the CasePro master switch AND a LIVE
 * transport (the stub is not a real calendar). Cheap, no network — used to decide whether to even look
 * up a user's CasePro subject.
 */
export function isCaseProCalendarActive(): boolean {
	if (!isCaseProEnabled()) {
		return false;
	}
	try {
		// A LIVE transport is anything other than the stub (staging renamed the pre-existing
		// 'rest' kind into the split 'native' | 'mcp'); the stub is not a real calendar.
		return caseProTransportDiagnostics().effective !== 'stub';
	} catch {
		return false;
	}
}

/** Resolve a MatterChat user id to their CasePro/CentralizedAuth subject, or null if not linked. */
export async function resolveCaseProSubject(userId: string): Promise<string | null> {
	const user = (await Users.findOne({ _id: userId }, { projection: { 'services.omnisai.id': 1 } })) as
		| { services?: { omnisai?: { id?: string } } }
		| null;
	const sub = user?.services?.omnisai?.id;
	return typeof sub === 'string' && sub ? sub : null;
}

/**
 * A CasePro calendar bridge bound to ONE MatterChat user (and their resolved CasePro subject). Talks to
 * CasePro's calendar controller through the shared transport. Construct via {@link getCaseProBridgeForUser}
 * — it returns null when CasePro isn't the preferred source for the user (caller then uses standalone).
 */
export class CaseProCalendarBridge {
	constructor(
		private readonly transport: ICaseProTransport,
		private readonly userId: string,
		private readonly caseProSubject: string,
	) {}

	/** The CasePro/CentralizedAuth subject this bridge acts as (== CasePro users.id). Public for correlation keys. */
	get subject(): string {
		return this.caseProSubject;
	}

	/** advisory writer-identity header value (CasePro subject that triggered the write). */
	private get ctx() {
		return { actingUserId: this.caseProSubject };
	}

	/**
	 * Does this CasePro user have a Google/Outlook calendar CONNECTED in CasePro? Reads CasePro's
	 * `GET /calendar/sync-status?userId=` (`{ connected, provider, ... }`) — the authoritative signal.
	 * Only when `connected` is true do we prefer CasePro; otherwise the caller uses MatterChat's OWN
	 * standalone connection (so a CasePro user who never linked a calendar there is NOT hijacked).
	 * Best-effort: any error → false (fall back to standalone rather than block on a CasePro hiccup).
	 */
	async hasConnectedCalendar(): Promise<boolean> {
		try {
			const res = (await this.transport.request('GET', SYNC_STATUS_PATH, {
				query: { userId: this.subject },
				ctx: this.ctx,
			})) as { connected?: boolean; provider?: string | null } | undefined;
			return Boolean(res?.connected);
		} catch (err) {
			SystemLogger.debug({ msg: 'boards.calendar.casepro.hasConnected.failed', userId: this.userId, err: String(err) });
			return false;
		}
	}

	/** Create a CasePro calendar event for a card's due date. Returns the CasePro calendar row id. */
	async createEvent(event: ICalendarEvent): Promise<string | undefined> {
		const res = (await this.transport.request('POST', CREATE_PATH, {
			body: this.eventToCaseProBody(event),
			ctx: this.ctx,
		})) as { id?: string } | undefined;
		return res?.id;
	}

	/** Patch an existing CasePro calendar event (by CasePro row id). */
	async updateEvent(calendarId: string, event: ICalendarEvent): Promise<void> {
		await this.transport.request('PATCH', UPDATE_PATH(calendarId), {
			body: this.eventToCaseProBody(event),
			ctx: this.ctx,
		});
	}

	/** Delete a CasePro calendar event (soft-deletes the local row + deletes the external mirror). */
	async deleteEvent(calendarId: string): Promise<void> {
		await this.transport.request('DELETE', DELETE_PATH(calendarId), { ctx: this.ctx });
	}

	/**
	 * Read the user's calendar events from CasePro (merged CasePro + external) for a window. Returns the
	 * raw CasePro event rows; the poll layer maps them. Best-effort: returns [] on error.
	 */
	async listEvents(timeMin: Date, timeMax: Date): Promise<Record<string, unknown>[]> {
		try {
			const res = (await this.transport.request('GET', ALL_EVENTS_PATH, {
				query: { userId: this.subject, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() },
				ctx: this.ctx,
			})) as { data?: Record<string, unknown>[] } | undefined;
			return Array.isArray(res?.data) ? (res!.data as Record<string, unknown>[]) : [];
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.calendar.casepro.listEvents.failed', userId: this.userId, err: String(err) });
			return [];
		}
	}

	/** Map our provider-agnostic event onto CasePro's CreateUpdateCalendarDto body (keyed to the subject). */
	private eventToCaseProBody(event: ICalendarEvent): Record<string, unknown> {
		return {
			user_id: this.subject,
			title: event.title,
			...(event.description ? { description: event.description } : {}),
			start: event.start.toISOString(),
			end: event.end.toISOString(),
			all_day: false,
			// `source` marks CasePro rows that MatterChat created (audit / future two-way disambiguation).
			source: 'matterchat',
		};
	}
}

/**
 * Get the CasePro bridge for a user IF CasePro is the preferred calendar source for them, else null.
 *
 * Preference rule (per the layered design): CasePro is preferred when it's active (enabled + live
 * transport), the user is linked to a CasePro subject, AND (when `requireConnected`) that CasePro user
 * has a connected calendar. When null, the caller uses MatterChat's OWN standalone connection —
 * nothing about the standalone path changes.
 *
 * `requireConnected` defaults true for real sync (don't hijack a user who never connected a calendar in
 * CasePro); pass false only for diagnostics.
 */
export async function getCaseProBridgeForUser(
	userId: string,
	options: { requireConnected?: boolean } = {},
): Promise<CaseProCalendarBridge | null> {
	if (!isCaseProCalendarActive()) {
		return null;
	}
	const subject = await resolveCaseProSubject(userId);
	if (!subject) {
		return null;
	}
	const transport = resolveTransportFromConfig();
	const bridge = new CaseProCalendarBridge(transport, userId, subject);

	const requireConnected = options.requireConnected !== false;
	if (requireConnected && !(await bridge.hasConnectedCalendar())) {
		return null;
	}
	return bridge;
}

/** Convenience: build the CasePro event body for a card (null when the card has no usable due date). */
export function cardToCaseProEvent(card: IBoardCard, siteUrl?: string): ICalendarEvent | null {
	return cardToEvent(card, siteUrl);
}

/**
 * Outbound email THROUGH CasePro — reuses CasePro's existing service email path
 * (`POST /communications/send-email`, KeyGate/MCP-key callable, `AgentSendEmailDto`) so MatterChat
 * sends as the user's connected CasePro mailbox WITHOUT wiring up its own SMTP/Graph mail. This is the
 * counterpart to the standalone inbound email-to-task receiver (which we KEEP — it's a different
 * direction and stays CasePro-free). Only usable when CasePro is active and the user is linked; returns
 * false (did-not-send) otherwise so a caller can decide whether to fall back.
 *
 * `organizationId` is required by CasePro's DTO; resolve it from the user's `services.omnisai.orgId`
 * (passed in by the caller who already has the user doc, to avoid a second lookup).
 */
export async function sendEmailThroughCasePro(
	userId: string,
	organizationId: string,
	message: { to: { email: string; name?: string }[]; subject: string; body: string; caseId?: string; taskId?: string },
): Promise<boolean> {
	if (!isCaseProCalendarActive()) {
		return false;
	}
	const subject = await resolveCaseProSubject(userId);
	if (!subject || !organizationId) {
		return false;
	}
	try {
		const transport = resolveTransportFromConfig();
		await transport.request('POST', 'communications/send-email', {
			body: {
				organization_id: organizationId,
				from_user_id: subject,
				to: message.to,
				subject: message.subject,
				body: message.body,
				...(message.caseId ? { case_id: message.caseId } : {}),
				...(message.taskId ? { task_id: message.taskId } : {}),
			},
			ctx: { actingUserId: subject },
		});
		return true;
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.email.casepro.send.failed', userId, err: String(err) });
		return false;
	}
}
