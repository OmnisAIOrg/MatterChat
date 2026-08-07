/**
 * Generalized /ask <agent> <question> slash command handler.
 * Generalizes the /chi pattern to work with any knowledge agent.
 */

import { api } from '@rocket.chat/core-services';
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';

import * as agentService from './service';
import { getAgent, canUseAgent, logAgentInvocation } from './service';
import { askChi } from '../chi/client';
import { parseChiQuestion } from '../chi/context';

const notifyEphemeral = (userId: string, rid: string, msg: string): void => {
	void api.broadcast('notify.ephemeralMessage', userId, rid, { msg });
};

const USAGE = 'Usage: /ask <agent-name-or-slug> <question> — ask an agent a question.';
const THINKING = '⏳ _Asking…_';

/**
 * Format agent answer with attribution and sources.
 */
export function formatAgentAnswer(
	text: string,
	opts: {
		agentName?: string;
		askedBy?: string;
		matterId?: string;
		sources?: Array<{ type: string; name: string; url?: string }>;
	},
): string {
	const parts: string[] = [opts.agentName || 'Agent'];
	if (opts.askedBy) {
		parts.push(`asked by @${opts.askedBy}`);
	}
	if (opts.matterId) {
		parts.push(`matter \`${opts.matterId}\``);
	}

	let result = `${text}\n\n— ${parts.join(' · ')}`;

	// Add sources if provided
	if (opts.sources && opts.sources.length > 0) {
		result += '\n\n**Sources:**\n';
		opts.sources.forEach((source, i) => {
			if (source.url) {
				result += `${i + 1}. [${source.name}](${source.url})\n`;
			} else {
				result += `${i + 1}. ${source.name}\n`;
			}
		});
	}

	return result;
}

/**
 * Format failure message.
 */
export function formatAgentFailure(note: string): string {
	return `⚠️ The agent couldn't answer right now — ${note}. Please try again in a moment.`;
}

/**
 * Handle one /ask invocation. Async to support long agent round-trips.
 */
export async function handleAskQuestion(
	userId: string,
	rid: string,
	params: string,
	workspaceId: string,
): Promise<void> {
	// Parse: /ask <agent> <question>
	const parts = parseAskParams(params);
	if (!parts) {
		return notifyEphemeral(userId, rid, USAGE);
	}

	const { agentNameOrSlug, question } = parts;

	// Get user and room
	const user = await Users.findOneById(userId);
	if (!user) {
		return notifyEphemeral(userId, rid, 'User not found');
	}

	const room: IRoom | null = await Rooms.findOneById(rid);
	if (!room) {
		return notifyEphemeral(userId, rid, 'Room not found');
	}

	// Get agent
	const agent = await getAgent(workspaceId, agentNameOrSlug);
	if (!agent) {
		return notifyEphemeral(userId, rid, `Agent "${agentNameOrSlug}" not found.`);
	}

	// Check permission
	const userRoles = user.roles || [];
	const hasAccess = await canUseAgent(userId, agent, userRoles);
	if (!hasAccess) {
		return notifyEphemeral(userId, rid, `You don't have permission to use the "${agent.name}" agent.`);
	}

	// Get or create bot user
	let botUser: IUser;
	try {
		if (agent.botUserId) {
			const botLookup = await Users.findOneById(agent.botUserId);
			if (!botLookup) {
				throw new Error('Bot user not found');
			}
			botUser = botLookup;
		} else {
			// Fallback to Chi bot or create a new one
			// For now, we'll just use the agent name
			throw new Error('Agent bot user not properly configured');
		}
	} catch (err) {
		return notifyEphemeral(userId, rid, 'Agent bot user not available');
	}

	// Post placeholder
	let placeholder: IMessage | false | undefined;
	try {
		const { sendMessage } = await import('../messages/sendMessage');
		placeholder = await sendMessage(botUser, { rid, msg: THINKING }, room);
	} catch (err) {
		return notifyEphemeral(userId, rid, formatAgentFailure('could not post to this channel'));
	}

	if (!placeholder) {
		return notifyEphemeral(userId, rid, formatAgentFailure('could not post to this channel'));
	}

	// Invoke agent asynchronously
	const startTime = Date.now();
	invokeAgentAsync(
		agent._id,
		agent.name,
		userId,
		rid,
		question,
		room.fname || room.name,
		room.matterId,
		user.username,
		placeholder._id,
		workspaceId,
		startTime,
	).catch(() => undefined); // Fire and forget
}

/**
 * Async agent invocation (fire-and-forget from handler).
 */
async function invokeAgentAsync(
	agentId: string,
	agentName: string,
	userId: string,
	rid: string,
	question: string,
	roomName: string,
	matterId: string | undefined,
	askedBy: string | undefined,
	placeholderId: string,
	workspaceId: string,
	startTime: number,
): Promise<void> {
	try {
		// TODO: Call the AI-Agents platform to get the answer
		// For now, we'll use the Chi client as a fallback
		const answer = await askChi({
			question,
			roomName,
			matterId,
			askedBy,
		});

		const responseTime = Date.now() - startTime;

		// Log the invocation
		await logAgentInvocation(agentId, userId, rid, 'slash_command', answer.ok, undefined, responseTime);

		// Edit the placeholder with the answer
		const finalText = answer.ok
			? formatAgentAnswer(answer.text, { agentName, askedBy, matterId })
			: formatAgentFailure(answer.note);

		const { updateMessage } = await import('../messages/updateMessage');
		const room = await Rooms.findOneById(rid);
		const botUser = await Users.findOneById(`agent.${agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);

		if (room && botUser) {
			await updateMessage(
				{ _id: placeholderId, rid, msg: finalText },
				botUser,
				{ _id: placeholderId } as any,
			);
		}
	} catch (err) {
		// Silently fail (already showed thinking message)
		console.error('Agent invocation error:', err);
	}
}

/**
 * Parse /ask params: extract agent name/slug and question.
 * Format: /ask <agent-name-or-slug> <question>
 */
function parseAskParams(params: string): { agentNameOrSlug: string; question: string } | null {
	if (!params || !params.trim()) {
		return null;
	}

	const trimmed = params.trim();
	const spaceIdx = trimmed.indexOf(' ');

	if (spaceIdx === -1) {
		// No space: just agent name, no question
		return null;
	}

	const agentNameOrSlug = trimmed.substring(0, spaceIdx).trim();
	const question = trimmed.substring(spaceIdx + 1).trim();

	if (!agentNameOrSlug || !question) {
		return null;
	}

	return { agentNameOrSlug, question };
}
