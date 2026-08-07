import { api } from '@rocket.chat/core-services';
import type { IUser, IRoom } from '@rocket.chat/core-typings';
import { Db } from 'mongodb';
import type { IKnowledgeAgent, IKnowledgeAgentAuditLog } from './types';
import { getChiConfig } from '../chi/config';
import { getChiBotUser } from '../chi/bot';
import { hasPermissionAsync } from '../authorization/hasPermission';

let agentsCollection: any;
let auditLogCollection: any;

/**
 * Initialize the agents service with MongoDB collections.
 * Called during server startup.
 */
export async function initializeAgentsService(db: Db): Promise<void> {
	agentsCollection = db.collection<IKnowledgeAgent>('knowledge_agents');
	auditLogCollection = db.collection<IKnowledgeAgentAuditLog>('knowledge_agent_audit_log');

	// Create indexes
	await agentsCollection.createIndex({ workspaceId: 1, slug: 1 }, { unique: true });
	await agentsCollection.createIndex({ workspaceId: 1, visibility: 1 });
	await agentsCollection.createIndex({ chiAgentId: 1 });
	await auditLogCollection.createIndex({ agentId: 1, invokedAt: -1 });
	await auditLogCollection.createIndex({ userId: 1, invokedAt: -1 });
}

/**
 * Create a new knowledge agent.
 */
export async function createAgent(
	workspaceId: string,
	userId: string,
	data: {
		name: string;
		description?: string;
		purpose?: string;
		avatar?: string;
		knowledgeSources: IKnowledgeAgent['knowledgeSources'];
		llmProvider?: IKnowledgeAgent['llmProvider'];
		visibility: 'firm' | 'team' | 'private';
		allowedRoles?: string[];
	},
): Promise<IKnowledgeAgent> {
	if (!agentsCollection) {
		throw new Error('Agents service not initialized');
	}

	const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const now = new Date();

	// Check if slug already exists
	const existing = await agentsCollection.findOne({ workspaceId, slug });
	if (existing) {
		throw new Error(`Agent with slug "${slug}" already exists`);
	}

	// Provision the agent on the AI-Agents platform
	const chiConfig = getChiConfig();
	let chiAgentId = '';
	let chiStatus: IKnowledgeAgent['chiAgentStatus'] = 'active';

	if (chiConfig) {
		try {
			chiAgentId = await provisionAgentOnAIPlatform(chiConfig, {
				name: data.name,
				description: data.description,
				knowledgeSources: data.knowledgeSources,
				llmProvider: data.llmProvider,
			});
		} catch (err) {
			// Log error but allow creation with failed status
			console.error('Failed to provision agent on AI-Agents platform:', err);
			chiStatus = 'failed';
		}
	}

	// Create bot user for this agent
	let botUserId: string | undefined;
	try {
		const botUser = await createAgentBotUser(slug, data.name);
		botUserId = botUser._id;
	} catch (err) {
		console.error('Failed to create bot user for agent:', err);
	}

	const agent: IKnowledgeAgent = {
		_id: await generateAgentId(),
		_updatedAt: now,
		workspaceId,
		name: data.name,
		slug,
		description: data.description,
		avatar: data.avatar,
		purpose: data.purpose,
		chiAgentId,
		chiAgentStatus: chiStatus,
		chiProvisionedAt: now,
		knowledgeSources: data.knowledgeSources,
		llmProvider: data.llmProvider,
		visibility: data.visibility,
		allowedRoles: data.allowedRoles,
		botUserId,
		createdBy: userId,
		createdAt: now,
		updatedAt: now,
		schemaVersion: 1,
	};

	const result = await agentsCollection.insertOne(agent);
	return { ...agent, _id: result.insertedId };
}

/**
 * Get agent by ID or slug.
 */
export async function getAgent(
	workspaceId: string,
	idOrSlug: string,
): Promise<IKnowledgeAgent | null> {
	if (!agentsCollection) {
		throw new Error('Agents service not initialized');
	}

	return agentsCollection.findOne({
		workspaceId,
		$or: [
			{ _id: idOrSlug },
			{ slug: idOrSlug },
		],
	});
}

/**
 * List agents visible to a user.
 */
export async function listAgents(
	workspaceId: string,
	userId: string,
	userRoles?: string[],
	opts: { visibility?: string; offset?: number; count?: number } = {},
): Promise<{ agents: IKnowledgeAgent[]; total: number }> {
	if (!agentsCollection) {
		throw new Error('Agents service not initialized');
	}

	const filter: any = { workspaceId };

	// Permission filtering
	if (!userRoles?.includes('admin')) {
		// Non-admins can see firm and their team (if any)
		filter.$or = [
			{ visibility: 'firm' },
			{ visibility: 'team' }, // TODO: implement team check
		];
	}

	if (opts.visibility) {
		filter.visibility = opts.visibility;
	}

	const total = await agentsCollection.countDocuments(filter);
	const agents = await agentsCollection
		.find(filter)
		.skip(opts.offset || 0)
		.limit(opts.count || 50)
		.toArray();

	return { agents, total };
}

/**
 * Update an agent.
 */
export async function updateAgent(
	workspaceId: string,
	agentId: string,
	data: Partial<Omit<IKnowledgeAgent, '_id' | 'workspaceId' | 'createdBy' | 'createdAt' | 'schemaVersion'>>,
): Promise<IKnowledgeAgent | null> {
	if (!agentsCollection) {
		throw new Error('Agents service not initialized');
	}

	const now = new Date();
	const result = await agentsCollection.findOneAndUpdate(
		{ _id: agentId, workspaceId },
		{
			$set: {
				...data,
				updatedAt: now,
				_updatedAt: now,
			},
		},
		{ returnDocument: 'after' },
	);

	return result.value;
}

/**
 * Archive an agent (soft-delete).
 */
export async function archiveAgent(
	workspaceId: string,
	agentId: string,
): Promise<boolean> {
	if (!agentsCollection) {
		throw new Error('Agents service not initialized');
	}

	const agent = await agentsCollection.findOne({ _id: agentId, workspaceId });
	if (!agent) {
		return false;
	}

	// Mark bot user as inactive if it exists
	if (agent.botUserId) {
		// TODO: call Users.updateOne to set active: false
	}

	const result = await agentsCollection.updateOne(
		{ _id: agentId, workspaceId },
		{
			$set: {
				chiAgentStatus: 'archived',
				updatedAt: new Date(),
				_updatedAt: new Date(),
			},
		},
	);

	return result.modifiedCount > 0;
}

/**
 * Log an agent invocation (audit trail, metadata only).
 */
export async function logAgentInvocation(
	agentId: string,
	userId: string,
	roomId: string,
	method: 'mention' | 'dm' | 'slash_command',
	success: boolean,
	error?: string,
	responseTime?: number,
): Promise<void> {
	if (!auditLogCollection) {
		throw new Error('Agents service not initialized');
	}

	const log: IKnowledgeAgentAuditLog = {
		_id: await generateAuditLogId(),
		_updatedAt: new Date(),
		agentId,
		userId,
		roomId,
		invocationMethod: method,
		invokedAt: new Date(),
		success,
		error,
		responseTime,
	};

	await auditLogCollection.insertOne(log);
}

/**
 * Get audit log for an agent.
 */
export async function getAgentAuditLog(
	agentId: string,
	opts: { offset?: number; count?: number; startDate?: Date; endDate?: Date } = {},
): Promise<{ logs: IKnowledgeAgentAuditLog[]; total: number }> {
	if (!auditLogCollection) {
		throw new Error('Agents service not initialized');
	}

	const filter: any = { agentId };

	if (opts.startDate || opts.endDate) {
		filter.invokedAt = {};
		if (opts.startDate) filter.invokedAt.$gte = opts.startDate;
		if (opts.endDate) filter.invokedAt.$lte = opts.endDate;
	}

	const total = await auditLogCollection.countDocuments(filter);
	const logs = await auditLogCollection
		.find(filter)
		.sort({ invokedAt: -1 })
		.skip(opts.offset || 0)
		.limit(opts.count || 100)
		.toArray();

	return { logs, total };
}

/**
 * Check if a user has permission to use an agent.
 */
export async function canUseAgent(
	userId: string,
	agent: IKnowledgeAgent,
	userRoles?: string[],
): Promise<boolean> {
	// Admins can always use agents
	if (userRoles?.includes('admin')) {
		return true;
	}

	// Check visibility
	if (agent.visibility === 'private') {
		return false; // Only admins can use private agents
	}

	if (agent.visibility === 'team') {
		// TODO: implement team membership check
		return false;
	}

	// firm visibility: check role restrictions if any
	if (agent.allowedRoles && agent.allowedRoles.length > 0) {
		return (userRoles || []).some((role) => agent.allowedRoles?.includes(role));
	}

	return true;
}

// ────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────

async function generateAgentId(): Promise<string> {
	// Simple ID generation — timestamp + random
	return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function generateAuditLogId(): Promise<string> {
	return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Provision agent on the AI-Agents (CHI) platform.
 * Returns the chiAgentId assigned by the platform.
 */
async function provisionAgentOnAIPlatform(
	chiConfig: ReturnType<typeof getChiConfig>,
	agentData: {
		name: string;
		description?: string;
		knowledgeSources: IKnowledgeAgent['knowledgeSources'];
		llmProvider?: IKnowledgeAgent['llmProvider'];
	},
): Promise<string> {
	if (!chiConfig) {
		throw new Error('CHI not configured');
	}

	// TODO: Call AI-Agents platform to provision the agent
	// For now, generate a placeholder ID
	return `chi_agent_${Date.now()}`;
}

/**
 * Create a Rocket.Chat bot user for the agent.
 */
async function createAgentBotUser(
	slug: string,
	displayName: string,
): Promise<IUser> {
	// Similar to getChiBotUser but per-agent
	// For now, return a placeholder
	// TODO: Call Users.create with proper role
	return {
		_id: `agent.${slug}`,
		username: `agent.${slug}`,
		name: displayName,
		type: 'bot',
	} as any;
}
