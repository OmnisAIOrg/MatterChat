import type { IRocketChatRecord } from '@rocket.chat/core-typings';

/**
 * AI Knowledge Agent — workspace-scoped agent registry.
 * Stores metadata about agents that can be invoked via @mention, DM, or /ask.
 */
export interface IKnowledgeAgent extends IRocketChatRecord {
	workspaceId: string; // Rocket.Chat workspace (team) _id

	// Identity
	name: string; // e.g. "Discovery Expert"
	slug: string; // URL-safe: "discovery-expert"
	description?: string;
	avatar?: string; // URL or data:image URI
	purpose?: string; // long-form purpose for visibility

	// AI-Agents platform binding
	chiAgentId: string; // Agent ID on AI-Agents platform
	chiAgentStatus: 'provisioning' | 'active' | 'failed' | 'archived';
	chiProvisionedAt?: Date;

	// Knowledge sources
	knowledgeSources: Array<{
		type: 'litbox_folder' | 'docs_page' | 'casepro_mcp' | 'boards_mcp';
		sourceId: string;
		sourceName: string;
		addedAt: Date;
		status: 'synced' | 'syncing' | 'error';
	}>;

	// LLM provider config
	llmProvider?: {
		type: 'workspace_default' | 'openai' | 'claude' | 'ollama' | 'other';
		endpoint?: string; // for self-hosted
		configuredAt: Date;
	};

	// Permissions & access
	visibility: 'firm' | 'team' | 'private'; // firm = all, team = team only, private = admins only
	allowedRoles?: string[]; // legal roles if role-gated (attorney, paralegal, etc.)

	// Bot user
	botUserId?: string; // Rocket.Chat user created for this agent

	// Audit
	createdBy: string; // userId
	createdAt: Date;
	updatedAt: Date;

	schemaVersion: number;
}

/**
 * Knowledge Agent Audit Log — metadata-only invocation log.
 * Never logs question/answer content for privacy.
 */
export interface IKnowledgeAgentAuditLog extends IRocketChatRecord {
	agentId: string; // IKnowledgeAgent._id
	userId: string; // who asked
	roomId: string; // channel or DM
	invocationMethod: 'mention' | 'dm' | 'slash_command';
	invokedAt: Date;
	responseTime?: number; // milliseconds
	success: boolean;
	error?: string; // brief error class, not full trace
}
