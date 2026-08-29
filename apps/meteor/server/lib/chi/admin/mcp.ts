/**
 * Chi Admin Assistant — MCP connectors.
 *
 * Lets Chi call tools on external MCP servers (the Omnis product tool servers:
 * casepro-mcp-v2, CaseNotes-MCP, carepro-mcp-v2, matterchat-mcp-v2, …) from the SAME tool
 * loop as the built-in registry. Servers are registered by an admin in
 * Admin → Settings → Chi Assistant → "MCP Servers (JSON)":
 *
 *   [{ "name": "casepro", "url": "https://casepro-mcp-v2.stg-omnisai.io/mcp",
 *      "apiKey": "…", "enabled": true }]
 *
 * Wire contract (matches the OmnisAI *-mcp-v2 template — see matterchat-mcp-v2):
 *   POST <url> JSON-RPC 2.0 — methods `tools/list` and `tools/call`.
 *   Auth: `X-MCP-API-Key` shared secret. Identity: `X-Mc-User-Id` (the acting member's id) so
 *   the server can scope/audit; the RC-token pass-through stays OFF here (prod bridge =
 *   CentralizedAuth subject → minted token, per the CHI integration doc).
 *
 * Tool names are namespaced `mcp_<server>_<tool>` before entering the loop, so they can never
 * shadow a built-in. Writes are confirm-gated exactly like built-ins: an MCP tool with
 * `annotations.readOnlyHint === true` runs freely; anything else that LOOKS like a write
 * (create/update/delete/post/send/…) parks for the member's explicit confirm.
 * Tool lists are cached for 5 minutes per server; a dead server degrades to "no tools", never
 * to a broken turn.
 */
import crypto from 'crypto';

import type { IUser } from '@rocket.chat/core-typings';

import type { ToolDef } from './llm';
import { settings } from '../../../../app/settings/server';
import { SystemLogger } from '../../logger/system';

export type McpServer = { name: string; url: string; apiKey?: string; enabled?: boolean };
export type McpToolInfo = { server: McpServer; tool: string; def: ToolDef; readOnly: boolean };

const NAMESPACE = 'mcp_';
const LIST_TTL_MS = 5 * 60 * 1000;
const CALL_TIMEOUT_MS = 30_000;

/** Sanitize a server name into a stable slug usable inside a tool name. */
export function mcpSlug(name: string): string {
	return String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '')
		.slice(0, 24);
}

/** Parse the admin's "MCP Servers (JSON)" setting. Bad JSON / bad rows → skipped, not fatal. */
export function parseMcpServers(raw: string): McpServer[] {
	if (!raw?.trim()) {
		return [];
	}
	try {
		const arr = JSON.parse(raw) as unknown;
		if (!Array.isArray(arr)) {
			return [];
		}
		return arr
			.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
			.map((s) => ({
				name: mcpSlug(String(s.name || '')),
				url: typeof s.url === 'string' ? s.url.trim() : '',
				apiKey: typeof s.apiKey === 'string' ? s.apiKey : undefined,
				enabled: s.enabled !== false,
			}))
			.filter((s) => s.name && /^https?:\/\//i.test(s.url));
	} catch {
		return [];
	}
}

export function isMcpTool(name: string): boolean {
	return name.startsWith(NAMESPACE);
}

/** Split `mcp_<server>_<tool>` back into its parts (tool names may contain underscores). */
export function splitMcpName(name: string): { server: string; tool: string } | undefined {
	if (!isMcpTool(name)) {
		return undefined;
	}
	const rest = name.slice(NAMESPACE.length);
	const sep = rest.indexOf('_');
	if (sep <= 0 || sep === rest.length - 1) {
		return undefined;
	}
	return { server: rest.slice(0, sep), tool: rest.slice(sep + 1) };
}

/**
 * Verbs that only ever read. A tool whose FIRST token is one of these, and which carries no write
 * verb anywhere, runs without a confirm chip.
 */
const READ_VERBS = new Set([
	'list',
	'get',
	'search',
	'read',
	'query',
	'fetch',
	'show',
	'describe',
	'count',
	'aggregate',
	'validate',
	'preview',
	'lookup',
	'status',
	'summarize',
	'summary',
	'who',
	'catch',
	'upcoming',
]);

/**
 * Verbs that mutate. Matched against ANY token, so `find_or_create` and `get_or_create` are caught
 * despite their read-looking first word.
 */
const WRITE_VERBS = new Set([
	'create',
	'update',
	'delete',
	'remove',
	'insert',
	'upsert',
	'write',
	'post',
	'send',
	'move',
	'complete',
	'set',
	'add',
	'copy',
	'decide',
	'request',
	'assign',
	'archive',
	'invite',
	'upload',
	'execute',
	'run',
	'apply',
	'import',
	'sync',
	'merge',
	'batch',
	'mutate',
	'reset',
	'revoke',
	'approve',
]);

/**
 * Split a tool name into verb tokens: `find_or_create` → [find, or, create], `getEntity` →
 * [get, entity]. Tokenizing rather than prefix-matching the raw string is what stops `get_settings`
 * from reading as a write because "settings" contains "set".
 */
function toolTokens(toolName: string): string[] {
	return String(toolName || '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/**
 * Confirm-gate heuristic for MCP tools. An explicit `readOnlyHint` from the server still wins.
 * Otherwise the default is FAIL-SAFE: a tool confirms unless it looks unmistakably like a read.
 *
 * This used to be the inverse — park only names starting with a known write verb — which silently
 * fell open on every meta-tool API. Against casepro-mcp-v2's 15 tools that let `execute_operation`,
 * `execute_workflow`, `batch_create/update/delete`, `upsert_entity` and `find_or_create` run with no
 * chip at all: the two arbitrary-operation tools included, writing into a legal CRM. A name-prefix
 * allowlist cannot enumerate what a meta-tool does, so the unknown case has to park, not proceed.
 *
 * The cost is false positives — a read-only tool with an unusual name (`discuss_document`) now asks
 * once. That is the right way round, and a connector fixes it properly by setting `readOnlyHint`.
 */
export function mcpNeedsConfirm(toolName: string, readOnly: boolean, input: Record<string, unknown>): string | undefined {
	if (readOnly) {
		return undefined;
	}
	const tokens = toolTokens(toolName);
	const mutates = tokens.some((t) => WRITE_VERBS.has(t));
	if (!mutates && tokens.length > 0 && READ_VERBS.has(tokens[0])) {
		return undefined;
	}
	const args = JSON.stringify(input || {});
	return `Run ${toolName.replace(/_/g, ' ')} on the connected product with ${args.length > 160 ? `${args.slice(0, 160)}…` : args}`;
}

function enabledServers(): McpServer[] {
	if (settings.get<boolean>('Chi_MCP_Enabled') !== true) {
		return [];
	}
	return parseMcpServers(String(settings.get('Chi_MCP_Servers') || '')).filter((s) => s.enabled);
}

let rpcId = 0;
async function rpc(server: McpServer, method: string, params?: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(server.url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(server.apiKey ? { 'X-MCP-API-Key': server.apiKey } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params || {} }),
		signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
	});
	const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string } };
	if (!res.ok || body.error) {
		throw new Error(body.error?.message || `MCP ${server.name} HTTP ${res.status}`);
	}
	return body.result;
}

type ListedTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } };
const listCache = new Map<string, { ts: number; tools: McpToolInfo[] }>();

async function serverTools(server: McpServer): Promise<McpToolInfo[]> {
	const cached = listCache.get(server.url);
	if (cached && Date.now() - cached.ts < LIST_TTL_MS) {
		return cached.tools;
	}
	try {
		const result = (await rpc(server, 'tools/list')) as { tools?: ListedTool[] };
		const tools: McpToolInfo[] = (result?.tools || [])
			.filter((t) => t?.name)
			.map((t) => ({
				server,
				tool: t.name,
				readOnly: t.annotations?.readOnlyHint === true,
				def: {
					name: `${NAMESPACE}${server.name}_${t.name}`,
					description: `[${server.name}] ${t.description || t.name}`,
					inputSchema: (t.inputSchema as ToolDef['inputSchema']) || { type: 'object', properties: {} },
				},
			}));
		listCache.set(server.url, { ts: Date.now(), tools });
		return tools;
	} catch (err) {
		SystemLogger.warn({ msg: 'Chi MCP tools/list failed', server: server.name, err: String(err) });
		listCache.set(server.url, { ts: Date.now(), tools: [] }); // don't hammer a dead server
		return [];
	}
}

/** HMAC-signed, short-lived member assertion (X-Chi-User-Assertion) — connector servers verify
 * with the shared Chi_MCP_Signing_Secret instead of trusting a bare user id. Format:
 * base64url(JSON{sub,u,iss,iat,exp}).base64url(HMAC-SHA256). This is the interim identity layer
 * until the CentralizedAuth token-mint bridge lands; the payload deliberately mirrors an OAuth
 * subject claim so servers can swap verification without changing shape. */
export function signUserAssertion(actor: IUser, siteUrl: string, secret: string): string | undefined {
	if (!secret) {
		return undefined;
	}
	const now = Math.floor(Date.now() / 1000);
	const payload = Buffer.from(JSON.stringify({ sub: actor._id, u: actor.username || '', iss: siteUrl, iat: now, exp: now + 300 })).toString('base64url');
	const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
	return `${payload}.${sig}`;
}

/** All connector tools available to this MEMBER (their per-user connector toggles applied). */
export async function mcpToolDefs(disabledConnectors?: Record<string, boolean>): Promise<ToolDef[]> {
	const servers = enabledServers().filter((s) => disabledConnectors?.[s.name] !== false);
	if (!servers.length) {
		return [];
	}
	const lists = await Promise.all(servers.map((s) => serverTools(s)));
	return lists.flat().map((t) => t.def);
}

/** Look up the parsed info for a namespaced tool (from cache — the loop listed it this turn). */
async function findMcpTool(name: string): Promise<McpToolInfo | undefined> {
	const parts = splitMcpName(name);
	if (!parts) {
		return undefined;
	}
	const server = enabledServers().find((s) => s.name === parts.server);
	if (!server) {
		return undefined;
	}
	const tools = await serverTools(server);
	return tools.find((t) => t.tool === parts.tool);
}

/** Confirm summary for a namespaced MCP call (undefined = run without confirmation). */
export async function mcpConfirmSummary(name: string, input: Record<string, unknown>): Promise<string | undefined> {
	const info = await findMcpTool(name);
	if (!info) {
		return undefined;
	}
	return mcpNeedsConfirm(info.tool, info.readOnly, input);
}

/** Execute a namespaced MCP call as `actor`. Mirrors runTool's { ok, content } contract. */
export async function runMcpTool(name: string, input: Record<string, unknown>, actor: IUser): Promise<{ ok: boolean; content: string }> {
	const info = await findMcpTool(name);
	if (!info) {
		return { ok: false, content: `Unknown connector tool: ${name}` };
	}
	try {
		const assertion = signUserAssertion(
			actor,
			String(settings.get('Site_Url') || ''),
			String(settings.get('Chi_MCP_Signing_Secret') || '').trim(),
		);
		const result = (await rpc(
			{ ...info.server },
			'tools/call',
			// _meta carries the acting member; `assertion` is the verifiable form (see signUserAssertion).
			{ name: info.tool, arguments: input || {}, _meta: { userId: actor._id, username: actor.username, assertion } },
		)) as { content?: { type?: string; text?: string }[]; isError?: boolean };
		const text = (result?.content || [])
			.map((c) => (typeof c?.text === 'string' ? c.text : ''))
			.filter(Boolean)
			.join('\n')
			.trim();
		return { ok: result?.isError !== true, content: text || (result?.isError ? 'The connector reported an error.' : 'Done.') };
	} catch (err) {
		return { ok: false, content: `Connector ${info.server.name} failed: ${err instanceof Error ? err.message : String(err)}` };
	}
}
