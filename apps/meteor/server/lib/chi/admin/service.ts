/**
 * Chi Admin Assistant — DM orchestration.
 *
 * Flow per admin DM (mirrors the /chi placeholder-then-edit UX in ../service.ts):
 *  1. Gates: feature enabled → sender is human → sender is a workspace ADMIN (non-admins get a
 *     polite one-liner, no model call, no tools) → an LLM key is configured.
 *  2. `confirm`/`cancel` replies resolve a parked dangerous action deterministically (the parked
 *     call re-runs verbatim through runTool — the model is NOT consulted again).
 *  3. Otherwise: post "⏳ Chi is working…", replay the recent DM as context, and run the
 *     tool loop (≤ MAX_ITERATIONS model steps). Dangerous tool calls are parked for confirm;
 *     executed calls are audited to the audit channel as they happen.
 *  4. Edit the placeholder in place with the final answer (or a friendly failure note).
 *
 * PRIVACY: prompts/replies are never logged server-side; audit lines carry tool names +
 * masked args only. AUTHORITY: every tool execution re-checks the SENDER's admin role
 * (tools.ts) — the bot has no standing of its own.
 */
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Messages, Users } from '@rocket.chat/models';

import { postAuditEntry } from './audit';
import { clearPendingAction, hasPendingAction, parkPendingAction, takePendingAction } from './confirm';
import { isCancelText, isConfirmText } from './helpers';
import type { ChiTurn, LlmConfig, ToolCall } from './llm';
import { llmStep } from './llm';
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

const NOT_ADMIN_REPLY =
	'I can only take action for **workspace admins** — your account does not have the admin role, so I have to sit this one out. Ask an admin to run it (or to grant you admin).';

const NOT_CONFIGURED_REPLY =
	'I am not wired to a model yet. An admin needs to set the API key under **Admin → Settings → Chi Assistant** (provider, key, model), then I am fully operational.';

export function isChiAdminEnabled(): boolean {
	return settings.get<boolean>('Chi_Assistant_Enabled') === true;
}

function llmConfig(): LlmConfig | undefined {
	const apiKey = String(settings.get('Chi_Assistant_API_Key') || '').trim();
	if (!apiKey) {
		return undefined;
	}
	const provider = settings.get('Chi_Assistant_Provider') === 'openai' ? 'openai' : 'anthropic';
	const model = String(settings.get('Chi_Assistant_Model') || '').trim() || (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-5');
	return { provider, apiKey, model, baseUrl: String(settings.get('Chi_Assistant_Base_URL') || '').trim() || undefined };
}

function systemPrompt(actor: IUser): string {
	return [
		`You are Chi, the MatterChat workspace operations assistant, chatting 1:1 with the workspace admin @${actor.username} on ${settings.get('Site_Url')}.`,
		'You EXECUTE admin work through your tools: users (create, bulk create, roles, activate/deactivate, password resets), channels (create, add members), Slack connector provisioning, workspace info, and allowlisted settings.',
		'Rules:',
		'- Prefer doing the work with tools over explaining how to do it manually. Read state with the read-only tools before changing things you are unsure about.',
		'- Dangerous or bulk actions are auto-parked by the platform until the admin types `confirm` — when that happens, tell the admin what is parked and that `confirm` runs it.',
		'- Relay tool results faithfully and concisely; temporary passwords must be passed on exactly once with a "share privately" note.',
		'- Never invent users, channels or settings. If a tool errors, say what failed and suggest the next step.',
		'- Markdown is supported. Keep replies tight — this is a chat, not a report.',
		`- Today is ${new Date().toISOString().slice(0, 10)}. The workspace email/SMTP may be down; user creation here already works around it (verified emails + handed-over temp passwords).`,
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

	if (!(await hasRoleAsync(sender._id, 'admin'))) {
		await reply(NOT_ADMIN_REPLY);
		return;
	}

	// Deterministic confirm/cancel lane — resolves parked actions without a model pass.
	if (isConfirmText(text)) {
		const parked = takePendingAction(room._id, sender._id);
		if (!parked) {
			await reply('Nothing is waiting for confirmation (it may have expired — 5 minute window). Tell me again what you want to do.');
			return;
		}
		const result = await runTool(parked.toolName, parked.input, sender);
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
		const tools = toolDefs();
		const system = systemPrompt(sender);

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
				const summary = findTool(call.name)?.needsConfirm?.(call.input);
				if (summary) {
					await finish(parkAndAsk(room._id, sender, call, summary, step.toolCalls.length - c - 1));
					return;
				}
				const result = await runTool(call.name, call.input, sender);
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
