/**
 * Chi Admin Assistant — DM orchestration.
 *
 * Flow per DM (mirrors the /chi placeholder-then-edit UX in ../service.ts):
 *  1. Gates: feature enabled → sender is human → an LLM key is configured. EVERY user may talk
 *     to Chi; the tool surface is caller-scoped (admins get the full registry, everyone else
 *     only the self-service 'user' tools — and runTool re-enforces this server-side per call).
 *  2. `confirm`/`cancel` replies resolve a parked dangerous action deterministically (the parked
 *     call re-runs verbatim through runTool — the model is NOT consulted again).
 *  3. Otherwise: post "⏳ Chi is working…", replay the recent DM as context, and run the
 *     tool loop (≤ MAX_ITERATIONS model steps). Dangerous tool calls are parked for confirm;
 *     executed calls are audited to the audit channel as they happen.
 *  4. Edit the placeholder in place with the final answer (or a friendly failure note).
 *
 * PRIVACY: prompts/replies are never logged server-side; audit lines carry tool names +
 * masked args only. AUTHORITY: every tool execution re-checks the SENDER's authority per
 * call (tools.ts runTool — admin role for admin tools, existing RBAC permissions for
 * cross-user targets) — the bot has no standing of its own.
 */
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Messages, Subscriptions, Users } from '@rocket.chat/models';

import type { ChiClientAction } from './actions';
import { withClientActions } from './actions';
import type { ChiTurnContext } from './turnctx';
import { withChiContext } from './turnctx';
import { postAuditEntry } from './audit';
import { clearPendingAction, hasPendingAction, parkPendingAction, takePendingAction } from './confirm';
import { isCancelText, isConfirmText } from './helpers';
import type { ChiTurn, LlmConfig, ToolCall } from './llm';
import { llmStep } from './llm';
import { isLocalProvider, resolveProvider } from './providers';
import { isMcpTool, mcpConfirmSummary, mcpToolDefs, runMcpTool } from './mcp';
import { describeToolCall, findTool, runTool, toolDefs } from './tools';
import { hasRoleAsync } from '../../../../app/authorization/server/functions/hasRole';
import { sendMessage } from '../../../../app/lib/server/functions/sendMessage';
import { updateMessage } from '../../../../app/lib/server/functions/updateMessage';
import { settings } from '../../../../app/settings/server';
import { SystemLogger } from '../../logger/system';
import { CHI_BOT_ID, getChiBotUser } from '../bot';

const MAX_ITERATIONS = 6;
const HISTORY_LIMIT = 16;
const MAX_REPLY_CHARS = 4500;
const THINKING = '⏳ _Chi is working on it…_';

const NOT_CONFIGURED_REPLY =
	'I am not wired to a model yet. An admin needs to set the API key under **Admin → Settings → Chi Assistant** (provider, key, model), then I am fully operational.';

export function isChiAdminEnabled(): boolean {
	return settings.get<boolean>('Chi_Assistant_Enabled') === true;
}

function llmConfig(): LlmConfig | undefined {
	const providerId = String(settings.get('Chi_Assistant_Provider') || '');
	const apiKey = String(settings.get('Chi_Assistant_API_Key') || '').trim();
	// Local providers (Ollama / LM Studio / llama.cpp on the workspace host) need no key —
	// a placeholder bearer keeps the OpenAI-compatible adapter's header well-formed.
	if (!apiKey && !isLocalProvider(providerId)) {
		return undefined;
	}
	// Provider preset (Anthropic / OpenAI / … / local / custom) resolves to the wire family +
	// endpoint + default model; Base URL / Model settings override when set.
	const { family, baseUrl, model } = resolveProvider(
		providerId,
		String(settings.get('Chi_Assistant_Base_URL') || ''),
		String(settings.get('Chi_Assistant_Model') || ''),
	);
	return { provider: family, apiKey: apiKey || 'local', model, baseUrl };
}

/** Route a call to the built-in registry or an MCP connector (namespaced mcp_<server>_<tool>). */
async function runAnyTool(name: string, input: Record<string, unknown>, actor: IUser): Promise<{ ok: boolean; content: string }> {
	return isMcpTool(name) ? runMcpTool(name, input, actor) : runTool(name, input, actor);
}

/** Confirm summary for any call — built-ins consult their needsConfirm, MCP tools the connector gate. */
async function anyConfirmSummary(name: string, input: Record<string, unknown>): Promise<string | undefined> {
	return isMcpTool(name) ? mcpConfirmSummary(name, input) : findTool(name)?.needsConfirm?.(input);
}

/** Shared description of the WORKSPACE capabilities every caller (member or admin) has. */
const WORKSPACE_CAPABILITIES = [
	'You are a self-driving workspace, not a chatbot: you NAVIGATE the app, RETRIEVE across the user\'s conversations, EXECUTE actions, and REASON — all as the user, over only what they can already see. Your workspace tools:',
	'- NAVIGATE: open_conversation (go to a channel/DM/person they\'re in), open_profile (DM a person), go_to (home / boards / directory / admin), open_search (open the search bar for a term).',
	'- FIND: search_messages ("where did we discuss X"), find_channels, find_people, who_is (one person + shared channels), find_files (documents shared in their chats).',
	'- READ & REASON: read_recent_messages returns a channel\'s recent transcript so YOU summarize it, answer questions, list open questions, or find a decision — call it for "summarize this channel", "what did we decide", "catch me up on #X". catch_me_up gathers unread + mentions + due tasks + upcoming deadlines for you to summarize ("what did I miss", "what needs my attention", "who is waiting on me").',
	'- NOTIFICATIONS: mark_channel_read, mark_all_read, mute_channel.',
	'- MESSAGES: post_message (send chat as the user — confirmed first), react_to_message.',
	'- TASKS & DEADLINES (boards): list_my_tasks, complete_task, create_task, upcoming_deadlines.',
	'When the user says "this"/"here" with no channel named, the tools default to the conversation they are currently viewing (given below when known). Prefer DOING (call the tool) over explaining where something is.',
].join('\n');

function systemPrompt(actor: IUser, isAdmin: boolean, contextLine?: string): string {
	const head = `You are Chi, the MatterChat workspace assistant, working 1:1 with @${actor.username} on ${settings.get('Site_Url')}.`;
	const common = [
		'Rules:',
		'- To DO anything, you MUST call the matching tool. NEVER claim you performed an action, and NEVER say something is "parked"/"pending confirmation", unless you actually called the tool this turn. Describing an action is not doing it.',
		'- Confirmation for sensitive/outward actions (e.g. posting a message, bulk/destructive admin ops) is handled FOR you: just call the tool; the platform intercepts it and asks the user to type `confirm`. Do not ask for confirmation yourself or pre-announce it.',
		'- Relay tool results faithfully and concisely. If a tool refuses for permissions, explain it plainly. Never invent users, channels, messages, files or settings.',
		'- Markdown is supported. Keep replies tight — this is a chat, not a report.',
		contextLine || '',
		`- Today is ${new Date().toISOString().slice(0, 10)}.`,
	].filter(Boolean);

	if (!isAdmin) {
		return [head, 'They are a regular member (not a workspace admin), so admin-only tools (managing other users, channels, or workspace settings) will refuse — for those, point them to an admin.', WORKSPACE_CAPABILITIES, ...common].join('\n');
	}
	return [
		head,
		'You are also a workspace ADMIN operator. Admin tools: users (create, bulk create, roles, activate/deactivate, password resets), per-user notification preferences (get_user_preferences, set_user_notification_sound, bulk_set_user_notification_sound), channels (create, add members), connector provisioning + status for Slack/Teams/Google, workspace info, and FULL settings access — search_settings finds any setting by keyword, get_setting reads it (secrets masked), set_setting changes it (gated + confirmed + audited). When asked about an admin capability you lack a specific tool for, SEARCH SETTINGS FIRST.',
		WORKSPACE_CAPABILITIES,
		'- For "help me connect our Slack" or a connector complaint: call slack_setup_guide and walk them through it, checking connector_status between steps.',
		'- Temporary passwords must be passed on exactly once with a "share privately" note.',
		...common,
	].join('\n');
}

/** Rebuild recent DM context (oldest→newest, current message excluded — it goes in as the live turn). */
async function historyTurns(rid: string, currentMessageId: string): Promise<ChiTurn[]> {
	const recent = await Messages.find(
		{ rid, t: { $exists: false }, _id: { $ne: currentMessageId } },
		{ sort: { ts: -1 }, limit: HISTORY_LIMIT, projection: { msg: 1, u: 1, ts: 1 } },
	).toArray();
	const turns: ChiTurn[] = [];
	for (const m of recent.reverse()) {
		const text = (m.msg || '').trim();
		if (!text || text === THINKING) {
			continue;
		}
		turns.push(m.u?._id === CHI_BOT_ID ? { kind: 'assistant', text } : { kind: 'user', text });
	}
	return turns;
}

const clip = (text: string): string => (text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS)}\n…(truncated)` : text);

/** Park a dangerous call and phrase the confirm ask. */
function parkAndAsk(rid: string, actor: IUser, call: ToolCall, summary: string, skipped: number): string {
	parkPendingAction({ rid, userId: actor._id, toolName: call.name, input: call.input, summary });
	const skippedNote = skipped > 0 ? `\n(${skipped} further queued action(s) were dropped — re-ask after confirming.)` : '';
	return `⚠️ This needs your explicit go-ahead:\n> ${summary}\n\nReply **confirm** to run it or **cancel** to drop it (expires in 5 minutes).${skippedNote}`;
}

/** Full handling of one inbound DM message. Called fire-and-forget from intake.ts. */
export async function handleChiAdminDm(message: IMessage, room: IRoom): Promise<void> {
	const bot = await getChiBotUser();
	const text = (message.msg || '').trim();
	const sender = await Users.findOneById<IUser>(message.u._id, {});
	if (sender?.type !== 'user' || !text) {
		return;
	}

	const reply = async (msg: string): Promise<void> => {
		await sendMessage(bot, { rid: room._id, msg: clip(msg) }, room);
	};

	const isAdmin = await hasRoleAsync(sender._id, 'admin');

	// Deterministic confirm/cancel lane — resolves parked actions without a model pass.
	if (isConfirmText(text)) {
		const parked = takePendingAction(room._id, sender._id);
		if (!parked) {
			await reply('Nothing is waiting for confirmation (it may have expired — 5 minute window). Tell me again what you want to do.');
			return;
		}
		const result = await runAnyTool(parked.toolName, parked.input, sender);
		await postAuditEntry(
			sender,
			`🛡️ @${sender.username} confirmed **${describeToolCall(parked.toolName, parked.input)}** → ${result.ok ? 'ok' : `error: ${result.content.slice(0, 200)}`}`,
		);
		await reply(result.ok ? `✅ Done.\n${result.content}` : `❌ That failed: ${result.content}`);
		return;
	}
	if (isCancelText(text)) {
		clearPendingAction(room._id, sender._id);
		await reply('Cancelled — nothing was executed.');
		return;
	}
	const droppedPending = hasPendingAction(room._id, sender._id);
	clearPendingAction(room._id, sender._id); // any other message supersedes a parked plan

	if (!isChiAdminEnabled()) {
		return; // feature off — stay silent (the DM may predate enablement)
	}
	const config = llmConfig();
	if (!config) {
		await reply(NOT_CONFIGURED_REPLY);
		return;
	}

	const placeholder = await sendMessage(bot, { rid: room._id, msg: THINKING }, room);
	const finish = async (msg: string): Promise<void> => {
		const prefix = droppedPending ? '_(previous pending action was dropped)_\n' : '';
		await updateMessage({ _id: placeholder._id, rid: room._id, msg: clip(`${prefix}${msg}`) }, bot, placeholder);
	};

	try {
		const turns: ChiTurn[] = [...(await historyTurns(room._id, message._id)), { kind: 'user', text }];
		const tools = [...toolDefs({ isAdmin }), ...(await mcpToolDefs())];
		const system = systemPrompt(sender, isAdmin);

		for (let i = 0; i < MAX_ITERATIONS; i++) {
			const step = await llmStep(config, system, turns, tools);
			if (!step.ok) {
				await finish(`❌ ${step.note}`);
				return;
			}
			if (!step.toolCalls.length) {
				await finish(step.text || 'Done.');
				return;
			}

			turns.push({ kind: 'assistant', text: step.text || undefined, toolCalls: step.toolCalls });
			const results: { id: string; name: string; content: string; isError?: boolean }[] = [];
			for (let c = 0; c < step.toolCalls.length; c++) {
				const call = step.toolCalls[c];
				const summary = await anyConfirmSummary(call.name, call.input);
				if (summary) {
					await finish(parkAndAsk(room._id, sender, call, summary, step.toolCalls.length - c - 1));
					return;
				}
				const result = await runAnyTool(call.name, call.input, sender);
				await postAuditEntry(
					sender,
					`🛡️ @${sender.username} → **${describeToolCall(call.name, call.input)}** → ${result.ok ? 'ok' : `error: ${result.content.slice(0, 200)}`}`,
				);
				results.push({ id: call.id, name: call.name, content: result.content, isError: !result.ok });
			}
			turns.push({ kind: 'toolResults', results });
		}
		await finish('I hit my per-message action limit before finishing — tell me to continue and I will pick up where I stopped.');
	} catch (err) {
		SystemLogger.error({ msg: 'Chi admin assistant failed', err: String(err) });
		await finish('❌ Something broke on my side while working on that. Check the server logs, then try again.');
	}
}

export type ChiOrbHistory = { who: 'me' | 'chi'; text: string };
export type ChiOrbTurnResult = { reply: string; actions: ChiClientAction[]; needsConfirm: boolean };
/** What the user is currently looking at, sent by the orb so "this channel"/"here" resolve. */
export type ChiOrbContext = { roomName?: string; focusedMessageId?: string };

/** Resolve the raw client context (a room NAME) to the caller's actual subscription, so context is
 *  always scoped to a room they belong to (never a leak). Returns undefined when nothing is open. */
async function resolveOrbContext(uid: string, raw?: ChiOrbContext): Promise<ChiTurnContext | undefined> {
	const name = (raw?.roomName || '').replace(/^[#@]/, '').trim().toLowerCase();
	if (!name) {
		return undefined;
	}
	const sub = await Subscriptions.findOne<{ rid: string; name?: string; fname?: string; t: string }>(
		{ 'u._id': uid, '$or': [{ name: raw?.roomName?.replace(/^[#@]/, '') }, { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] },
		{ projection: { rid: 1, name: 1, fname: 1, t: 1 } },
	);
	if (!sub) {
		return undefined;
	}
	return { rid: sub.rid, roomName: sub.name || sub.fname, roomType: sub.t, focusedMessageId: raw?.focusedMessageId };
}

/**
 * Run ONE Chi turn for the floating orb (client copilot) and RETURN the reply + any client UI
 * actions — the same LLM loop, tools, caller-scoping, confirm/park and audit as the DM handler, but
 * request/response instead of DM messages, and with the client-action collector open so tools like
 * open_conversation can drive the user's screen. Authority is the caller's: admins get the full
 * registry, everyone else the self-service + navigation tools; runTool re-enforces per call.
 *
 * Confirm parking uses a synthetic per-user room key ("orb:<uid>") so a dangerous call parks and the
 * user's next "confirm" (a fresh turn) resolves it deterministically — identical to the DM flow.
 */
export async function runChiOrbTurn(
	sender: IUser,
	text: string,
	history: ChiOrbHistory[] = [],
	rawContext?: ChiOrbContext,
): Promise<ChiOrbTurnResult> {
	const trimmed = (text || '').trim();
	if (!trimmed) {
		return { reply: '', actions: [], needsConfirm: false };
	}
	if (!isChiAdminEnabled()) {
		return { reply: 'Chi is not enabled on this workspace yet — ask an admin to turn it on.', actions: [], needsConfirm: false };
	}
	const config = llmConfig();
	if (!config) {
		return { reply: NOT_CONFIGURED_REPLY, actions: [], needsConfirm: false };
	}
	const isAdmin = await hasRoleAsync(sender._id, 'admin');
	const orbRid = `orb:${sender._id}`;

	if (isConfirmText(trimmed)) {
		const parked = takePendingAction(orbRid, sender._id);
		if (!parked) {
			return { reply: 'Nothing is waiting for confirmation (the 5-minute window may have passed). Tell me again what to do.', actions: [], needsConfirm: false };
		}
		const { result, actions } = await withClientActions(() => runAnyTool(parked.toolName, parked.input, sender));
		await postAuditEntry(
			sender,
			`🛡️ @${sender.username} confirmed **${describeToolCall(parked.toolName, parked.input)}** → ${result.ok ? 'ok' : `error: ${result.content.slice(0, 200)}`}`,
		);
		return { reply: result.ok ? `✅ Done.\n${result.content}` : `❌ That failed: ${result.content}`, actions, needsConfirm: false };
	}
	if (isCancelText(trimmed)) {
		clearPendingAction(orbRid, sender._id);
		return { reply: 'Cancelled — nothing was executed.', actions: [], needsConfirm: false };
	}
	clearPendingAction(orbRid, sender._id);

	const turns: ChiTurn[] = [];
	for (const h of history.slice(-HISTORY_LIMIT)) {
		const t = (h.text || '').trim();
		if (!t || t === THINKING) {
			continue;
		}
		turns.push(h.who === 'chi' ? { kind: 'assistant', text: t } : { kind: 'user', text: t });
	}
	turns.push({ kind: 'user', text: trimmed });

	const chiCtx = await resolveOrbContext(sender._id, rawContext);
	const contextLine = chiCtx?.roomName
		? `- The user is CURRENTLY VIEWING ${chiCtx.roomType === 'd' ? '@' : '#'}${chiCtx.roomName}. When they say "this", "here" or omit a channel, act on that conversation.`
		: undefined;
	const tools = [...toolDefs({ isAdmin }), ...(await mcpToolDefs())];
	const system = systemPrompt(sender, isAdmin, contextLine);

	const { result, actions } = await withClientActions<Omit<ChiOrbTurnResult, 'actions'>>(() => withChiContext(chiCtx ?? {}, async () => {
		try {
			for (let i = 0; i < MAX_ITERATIONS; i++) {
				const step = await llmStep(config, system, turns, tools);
				if (!step.ok) {
					return { reply: `❌ ${step.note}`, needsConfirm: false };
				}
				if (!step.toolCalls.length) {
					return { reply: clip(step.text || 'Done.'), needsConfirm: false };
				}
				turns.push({ kind: 'assistant', text: step.text || undefined, toolCalls: step.toolCalls });
				const results: { id: string; name: string; content: string; isError?: boolean }[] = [];
				for (let c = 0; c < step.toolCalls.length; c++) {
					const call = step.toolCalls[c];
					const summary = await anyConfirmSummary(call.name, call.input);
					if (summary) {
						return { reply: parkAndAsk(orbRid, sender, call, summary, step.toolCalls.length - c - 1), needsConfirm: true };
					}
					const toolResult = await runAnyTool(call.name, call.input, sender);
					await postAuditEntry(
						sender,
						`🛡️ @${sender.username} → **${describeToolCall(call.name, call.input)}** → ${toolResult.ok ? 'ok' : `error: ${toolResult.content.slice(0, 200)}`}`,
					);
					results.push({ id: call.id, name: call.name, content: toolResult.content, isError: !toolResult.ok });
				}
				turns.push({ kind: 'toolResults', results });
			}
			return { reply: 'I hit my per-message action limit — ask me to continue.', needsConfirm: false };
		} catch (err) {
			SystemLogger.error({ msg: 'Chi orb turn failed', err: String(err) });
			return { reply: '❌ Something broke on my side while working on that.', needsConfirm: false };
		}
	}));

	return { ...result, actions };
}
