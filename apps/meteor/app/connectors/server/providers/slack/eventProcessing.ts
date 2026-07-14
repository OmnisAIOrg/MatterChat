/**
 * Slack Events API inbound processing — the routing layer between a verified `/_slack/events`
 * delivery and bridgeCore. The Slack sibling of the Teams webhook's processNotification, with the
 * SAME per-connection fan-out model: Slack app-level event subscriptions deliver ONE event per
 * workspace message, and every MatterChat connection bridging that (team, channel) gets it
 * ingested into its own room.
 *
 * LOOP SAFETY (same three layered guards as Teams — see bridge/echoSuppression.ts):
 *  1. event dedup — Slack RETRIES deliveries (immediately, then ~1 min, then ~5 min; the retry
 *     carries `X-Slack-Retry-Num`): a short-TTL in-memory set keyed by (teamId, eventId) drops
 *     re-deliveries at the door (same mechanism the echo set uses);
 *  2. echo suppression — an outbound post from a bridged room comes BACK as a normal user-authored
 *     `message` event (we post with the owner's USER token, so there is no bot_id to key on): the
 *     echo set remembers the `ts` chat.postMessage returned, checked here per connection AND again
 *     inside ingestExternalMessage (plus the persistent customFields stamp + the deterministic
 *     `ext-…` _id, which survive restarts);
 *  3. deterministic _id — event ingest and REST backfill mint the SAME RC message _id for one
 *     Slack message, so double-processing upserts onto itself instead of duplicating.
 *
 * EDITS/DELETES are applied ONLY to messages the bridge itself inserted (located by their
 * deterministic `ext-…` _id) — a Slack-side edit/delete of a message that ORIGINATED in MatterChat
 * (our own outbound post) is left alone (documented v1 gap, symmetric with outbound edits/deletes
 * not being mirrored out).
 *
 * ATTRIBUTION: Slack message events carry only the author's user id; the display name is resolved
 * via users.info on the connection owner's token (TTL-cached, capped, best-effort — falls back to
 * the raw id) and rides the ALIAS mechanism exactly like Teams inbound (no ghost accounts).
 */
import type { IBridgedChannel, IExternalWorkspaceConnection, IUser } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections, Messages, Users } from '@rocket.chat/models';

import type { SlackMessageAction } from './eventMessageMapping';
import { slackTsToEpochMs, toProviderMessage } from './eventMessageMapping';
import type { SlackTokens } from './slackApi';
import { slackFetch } from './slackApi';
import { SystemLogger } from '../../../../../server/lib/logger/system';
import { deleteMessage } from '../../../../lib/server/functions/deleteMessage';
import { updateMessage } from '../../../../lib/server/functions/updateMessage';
import { ingestExternalMessage } from '../../bridge/bridgeCore';
import { extMessageId } from '../../bridge/bridgeIds';
import { EchoSuppressionSet, echoSuppression } from '../../bridge/echoSuppression';
import { toProviderConnection } from '../../runtimeConnection';

/**
 * Event-id dedup window. Slack's retry schedule tops out at ~5 minutes after the first attempt, so
 * the echo set's default 10-minute TTL covers every retry of one event_id.
 */
export const slackEventDedup = new EchoSuppressionSet();

/**
 * Check-and-remember one delivery. TRUE = first sight (process it); FALSE = a retry/duplicate of
 * an event already accepted inside the TTL window (drop it — the 200 ack already told Slack we
 * have it). Keyed (teamId, eventId): event ids are unique per workspace.
 */
export function acceptSlackEvent(teamId: string, eventId: string): boolean {
	if (slackEventDedup.has(teamId, eventId)) {
		return false;
	}
	slackEventDedup.add(teamId, eventId);
	return true;
}

// ── author display-name cache (users.info is Tier-4 but still not free per message) ─────────────

const PROFILE_TTL_MS = 6 * 60 * 60 * 1000; // display names move slowly; 6h keeps lookups rare.
const PROFILE_CACHE_MAX = 2000;

const profileCache = new Map<string, { name: string | undefined; expiresAt: number }>();

/** Test hook: empty the display-name cache. */
export function clearProfileCache(): void {
	profileCache.clear();
}

/**
 * Resolve a Slack user id to a display name on the given token — TTL-cached per (team, user),
 * capped, best-effort (any failure caches undefined so one broken lookup doesn't retry per
 * message; the alias then falls back to the raw id).
 */
async function resolveAuthorName(tokens: SlackTokens, teamId: string, userId: string): Promise<string | undefined> {
	const key = `${teamId}:${userId}`;
	const cached = profileCache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.name;
	}
	if (profileCache.size >= PROFILE_CACHE_MAX) {
		// Oldest-first eviction (Map preserves insertion order) — bounded memory on huge workspaces.
		const oldest = profileCache.keys().next().value;
		if (oldest !== undefined) {
			profileCache.delete(oldest);
		}
	}
	let name: string | undefined;
	try {
		const info = await slackFetch<{
			user?: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } };
		}>('users.info', tokens, { method: 'GET', params: { user: userId } });
		const u = info.user || {};
		name = u.profile?.display_name || u.real_name || u.profile?.real_name || u.name || undefined;
	} catch {
		name = undefined;
	}
	profileCache.set(key, { name, expiresAt: Date.now() + PROFILE_TTL_MS });
	return name;
}

// ── per-connection helpers ───────────────────────────────────────────────────────────────────────

type BridgingConnection = {
	doc: IExternalWorkspaceConnection;
	bridge: IBridgedChannel;
	/** Decrypted runtime connection, when credentials are readable (degrade, don't drop, when not). */
	connection: ReturnType<typeof toProviderConnection>;
};

/** Every connection bridging this (team, channel), with its bridge entry + runtime credentials. */
async function bridgingConnections(teamId: string, channel: string): Promise<BridgingConnection[]> {
	const docs = await ExternalWorkspaceConnections.findByBridgedChannel('slack', teamId, channel).toArray();
	const out: BridgingConnection[] = [];
	for (const doc of docs) {
		const bridge = doc.bridgedChannels?.find((b) => b.channelExternalId === channel);
		if (!bridge) {
			continue;
		}
		out.push({ doc, bridge, connection: toProviderConnection(doc) });
	}
	return out;
}

/** The connection owner's own Slack user id (captured at OAuth) — self-alias/echo attribution. */
function ownerSlackIdOf(connection: ReturnType<typeof toProviderConnection>): string | undefined {
	const v = connection?.credentials.externalSlackUserId;
	return typeof v === 'string' && v ? v : undefined;
}

/** The bridge owner as an RC user (bridge-inserted messages ride under the owner's account). */
async function ownerUserOf(doc: IExternalWorkspaceConnection): Promise<IUser | null> {
	return Users.findOneById(doc.userId);
}

// ── the three actions ────────────────────────────────────────────────────────────────────────────

async function processNewMessage(teamId: string, action: Extract<SlackMessageAction, { kind: 'new' }>): Promise<void> {
	const targets = await bridgingConnections(teamId, action.channel);
	if (!targets.length) {
		return;
	}

	// Resolve the author's display name ONCE per event, on the first readable connection's token.
	const lookup = targets.find((t) => t.connection?.credentials.accessToken);
	const authorName = lookup?.connection
		? await resolveAuthorName({ accessToken: String(lookup.connection.credentials.accessToken) }, teamId, action.user)
		: undefined;

	const mapped = toProviderMessage(action, authorName);
	const tsMs = slackTsToEpochMs(action.ts);

	for (const { doc, bridge, connection } of targets) {
		// Fast-path echo drop: the ts chat.postMessage returned for THIS connection's own outbound
		// post (ingestExternalMessage re-checks this plus the persistent guards; checking here too
		// keeps the noisy common case cheap and unit-testable).
		if (echoSuppression.has(doc._id, action.ts)) {
			continue;
		}
		try {
			const inserted = await ingestExternalMessage(doc, bridge, mapped, ownerSlackIdOf(connection));
			if (inserted && tsMs !== undefined) {
				await ExternalWorkspaceConnections.setBridgedChannelLastInboundAt(doc._id, bridge.channelExternalId, new Date(tsMs));
			}
		} catch (err) {
			SystemLogger.warn({ msg: 'Slack events: inbound ingest failed', connectionId: doc._id, err: String(err) });
		}
	}
}

async function processEditedMessage(teamId: string, action: Extract<SlackMessageAction, { kind: 'edit' }>): Promise<void> {
	const targets = await bridgingConnections(teamId, action.channel);
	if (!targets.length) {
		return;
	}

	const lookup = targets.find((t) => t.connection?.credentials.accessToken);
	const authorName = lookup?.connection
		? await resolveAuthorName({ accessToken: String(lookup.connection.credentials.accessToken) }, teamId, action.user)
		: undefined;
	const mapped = toProviderMessage(action, authorName);

	for (const { doc, bridge, connection } of targets) {
		try {
			// ONLY messages the bridge itself inserted are edited (deterministic `ext-…` _id). An edit of
			// our own outbound post (native RC _id) is left alone — documented v1 gap.
			const rcId = extMessageId(doc._id, bridge.channelExternalId, action.ts);
			const existing = await Messages.findOneById(rcId);
			if (!existing) {
				// Not ingested yet (e.g. created while inbound was off) — ingest the edited form as new.
				await ingestExternalMessage(doc, bridge, mapped, ownerSlackIdOf(connection));
				continue;
			}
			if (existing.msg === mapped.text) {
				continue; // No visible change (e.g. a link-unfurl re-delivery) — skip the write.
			}
			const owner = await ownerUserOf(doc);
			if (!owner) {
				continue;
			}
			await updateMessage({ _id: existing._id, rid: existing.rid, msg: mapped.text, customFields: existing.customFields ?? {} }, owner, existing);
		} catch (err) {
			SystemLogger.warn({ msg: 'Slack events: edit apply failed', connectionId: doc._id, err: String(err) });
		}
	}
}

async function processDeletedMessage(teamId: string, action: Extract<SlackMessageAction, { kind: 'delete' }>): Promise<void> {
	const targets = await bridgingConnections(teamId, action.channel);
	for (const { doc, bridge } of targets) {
		try {
			// ONLY bridge-inserted messages are deleted (deterministic `ext-…` _id) — same bounded blast
			// radius as edits; our own outbound posts are never touched from the Slack side.
			const rcId = extMessageId(doc._id, bridge.channelExternalId, action.ts);
			const existing = await Messages.findOneById(rcId);
			if (!existing) {
				continue;
			}
			const owner = await ownerUserOf(doc);
			if (!owner) {
				continue;
			}
			await deleteMessage(existing, owner);
		} catch (err) {
			SystemLogger.warn({ msg: 'Slack events: delete apply failed', connectionId: doc._id, err: String(err) });
		}
	}
}

/**
 * Process ONE verified, deduped message action (the events route calls this AFTER acking 200 —
 * Slack drops/retries on slow responses, so nothing here sits between Slack and the ack).
 * Never throws — a processing failure is logged and affects only that delivery.
 */
export async function processSlackMessageEvent(teamId: string, action: SlackMessageAction): Promise<void> {
	try {
		if (action.kind === 'new') {
			return await processNewMessage(teamId, action);
		}
		if (action.kind === 'edit') {
			return await processEditedMessage(teamId, action);
		}
		return await processDeletedMessage(teamId, action);
	} catch (err) {
		SystemLogger.error({ msg: 'Slack events: processing failed', teamId, kind: action.kind, err: String(err) });
	}
}
