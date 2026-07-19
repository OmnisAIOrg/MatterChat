/**
 * AI Knowledge Agents REST API Routes.
 *
 * Endpoints:
 *  POST   /api/v1/agents.create          — create a new agent (admin only)
 *  GET    /api/v1/agents.list            — list agents visible to user
 *  GET    /api/v1/agents.info            — get agent details
 *  PUT    /api/v1/agents.update          — update agent (creator/admin)
 *  DELETE /api/v1/agents.delete          — archive agent (creator/admin)
 *  POST   /api/v1/agents.invoke          — invoke agent (internal)
 *  GET    /api/v1/agents.audit-log       — get audit log (admin only)
 *  POST   /api/v1/agents.sync-sources    — sync knowledge sources (async)
 *  GET    /api/v1/agents.sync-status     — check sync job status
 *  POST   /api/internal/webhooks/agents/sync-notify — AI-Agents platform webhook
 */

import type { IApiEndpointMetadata } from '@rocket.chat/apps-engine/definition/api';
import type { IUser } from '@rocket.chat/core-typings';
import type { Request, Response } from 'express';

import * as agentService from './service';
import { hasPermissionAsync } from '../../../app/authorization/server/functions/hasPermission';

const notConfigured = (res: Response): void => {
	res.status(400).json({
		success: false,
		error: 'Agents service not configured',
	});
};

const notAuthorized = (res: Response, msg = 'Not authorized'): void => {
	res.status(403).json({
		success: false,
		error: msg,
	});
};

/**
 * POST /api/v1/agents.create
 * Create a new knowledge agent (admin only).
 */
export const createAgentRoute = {
	path: 'agents.create',
	validate: (payload: Record<string, any>) => {
		if (!payload.name || typeof payload.name !== 'string') {
			throw new Error('name is required');
		}
		if (!payload.visibility || !['firm', 'team', 'private'].includes(payload.visibility)) {
			throw new Error('visibility must be firm, team, or private');
		}
		return true;
	},
	action: async (req: Request, res: Response, user: IUser): Promise<void> => {
		try {
			const isAdmin = await hasPermissionAsync(user._id, 'admin');
			if (!isAdmin) {
				return notAuthorized(res, 'Only admins can create agents');
			}

			const { name, description, purpose, avatar, knowledgeSources, llmProvider, visibility, allowedRoles } = req.body;

			const agent = await agentService.createAgent(user.workspace?._id || 'default', user._id, {
				name,
				description,
				purpose,
				avatar,
				knowledgeSources: knowledgeSources || [],
				llmProvider,
				visibility,
				allowedRoles,
			});

			res.json({
				success: true,
				agent,
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};

/**
 * GET /api/v1/agents.list
 * List agents visible to the user.
 */
export const listAgentsRoute = {
	path: 'agents.list',
	action: async (req: Request, res: Response, user: IUser): Promise<void> => {
		try {
			const { visibility, offset, count } = req.query;
			const workspaceId = user.workspace?._id || 'default';
			const userRoles = user.roles || [];

			const { agents, total } = await agentService.listAgents(
				workspaceId,
				user._id,
				userRoles,
				{
					visibility: visibility as string,
					offset: offset ? parseInt(offset as string) : 0,
					count: count ? parseInt(count as string) : 50,
				},
			);

			res.json({
				success: true,
				agents,
				total,
				count: agents.length,
				offset: offset ? parseInt(offset as string) : 0,
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};

/**
 * GET /api/v1/agents.info
 * Get agent details.
 */
export const getAgentRoute = {
	path: 'agents.info',
	action: async (req: Request, res: Response, user: IUser): Promise<void> => {
		try {
			const { agentId, slug } = req.query;
			const idOrSlug = (agentId || slug) as string;

			if (!idOrSlug) {
				return res.status(400).json({
					success: false,
					error: 'agentId or slug required',
				});
			}

			const workspaceId = user.workspace?._id || 'default';
			const agent = await agentService.getAgent(workspaceId, idOrSlug);

			if (!agent) {
				return res.status(404).json({
					success: false,
					error: 'Agent not found',
				});
			}

			// Authorization: enforce agent visibility (firm/team/private). Without this,
			// any authenticated user could read another user's private agent (incl. its
			// knowledge-source config) by id or slug. Creator/admin always allowed;
			// otherwise defer to canUseAgent (firm + allowedRoles / team / private rules).
			const isAdmin = await hasPermissionAsync(user._id, 'admin');
			const allowed =
				agent.createdBy === user._id || isAdmin || (await agentService.canUseAgent(user._id, agent, user.roles || []));
			if (!allowed) {
				// 404 (not 403) so a private agent's existence isn't disclosed to non-viewers.
				return res.status(404).json({
					success: false,
					error: 'Agent not found',
				});
			}

			res.json({
				success: true,
				agent,
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};

/**
 * PUT /api/v1/agents.update
 * Update an agent (creator or admin only).
 */
export const updateAgentRoute = {
	path: 'agents.update',
	action: async (req: Request, res: Response, user: IUser): Promise<void> => {
		try {
			const { agentId } = req.body;

			if (!agentId) {
				return res.status(400).json({
					success: false,
					error: 'agentId required',
				});
			}

			const workspaceId = user.workspace?._id || 'default';
			const agent = await agentService.getAgent(workspaceId, agentId);

			if (!agent) {
				return res.status(404).json({
					success: false,
					error: 'Agent not found',
				});
			}

			// Check permission: creator or admin
			const isAdmin = await hasPermissionAsync(user._id, 'admin');
			if (agent.createdBy !== user._id && !isAdmin) {
				return notAuthorized(res, 'Only the creator or an admin can update this agent');
			}

			const { name, description, purpose, avatar, knowledgeSources, llmProvider, visibility, allowedRoles } = req.body;

			const updated = await agentService.updateAgent(workspaceId, agentId, {
				name,
				description,
				purpose,
				avatar,
				knowledgeSources,
				llmProvider,
				visibility,
				allowedRoles,
			});

			res.json({
				success: true,
				agent: updated,
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};

/**
 * DELETE /api/v1/agents.delete
 * Archive an agent (soft-delete, creator or admin only).
 */
export const deleteAgentRoute = {
	path: 'agents.delete',
	action: async (req: Request, res: Response, user: IUser): Promise<void> => {
		try {
			const { agentId } = req.body;

			if (!agentId) {
				return res.status(400).json({
					success: false,
					error: 'agentId required',
				});
			}

			const workspaceId = user.workspace?._id || 'default';
			const agent = await agentService.getAgent(workspaceId, agentId);

			if (!agent) {
				return res.status(404).json({
					success: false,
					error: 'Agent not found',
				});
			}

			// Check permission: creator or admin
			const isAdmin = await hasPermissionAsync(user._id, 'admin');
			if (agent.createdBy !== user._id && !isAdmin) {
				return notAuthorized(res, 'Only the creator or an admin can delete this agent');
			}

			const success = await agentService.archiveAgent(workspaceId, agentId);

			res.json({
				success,
				message: success ? 'Agent archived' : 'Failed to archive agent',
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};

/**
 * GET /api/v1/agents.audit-log
 * Get audit log for an agent (admin only).
 */
export const getAuditLogRoute = {
	path: 'agents.audit-log',
	action: async (req: Request, res: Response, user: IUser): Promise<void> => {
		try {
			const isAdmin = await hasPermissionAsync(user._id, 'admin');
			if (!isAdmin) {
				return notAuthorized(res, 'Only admins can view audit logs');
			}

			const { agentId, offset, count, startDate, endDate } = req.query;

			if (!agentId) {
				return res.status(400).json({
					success: false,
					error: 'agentId required',
				});
			}

			const { logs, total } = await agentService.getAgentAuditLog(agentId as string, {
				offset: offset ? parseInt(offset as string) : 0,
				count: count ? parseInt(count as string) : 100,
				startDate: startDate ? new Date(startDate as string) : undefined,
				endDate: endDate ? new Date(endDate as string) : undefined,
			});

			res.json({
				success: true,
				logs,
				total,
				count: logs.length,
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};

/**
 * POST /api/internal/webhooks/agents/sync-notify
 * Webhook from AI-Agents platform to notify of knowledge source sync completion.
 */
export const syncNotifyWebhook = {
	path: '/internal/webhooks/agents/sync-notify',
	action: async (req: Request, res: Response): Promise<void> => {
		try {
			const { agentId, sourceId, status, message } = req.body;

			if (!agentId || !sourceId) {
				return res.status(400).json({
					success: false,
					error: 'agentId and sourceId required',
				});
			}

			// TODO: Update the knowledge source status in the agent
			// await agentService.updateKnowledgeSourceStatus(agentId, sourceId, status);

			res.json({
				success: true,
				message: 'Sync notification received',
			});
		} catch (err: any) {
			res.status(400).json({
				success: false,
				error: err.message,
			});
		}
	},
};
