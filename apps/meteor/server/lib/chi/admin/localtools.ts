/**
 * Chi Admin Assistant — LOCAL tool connectors (the desktop bridge).
 *
 * The sibling of ./mcp.ts for MCP servers that live ON THE MEMBER'S OWN MAC —
 * the Omnis desktop apps (EvidenceHunt, Omnis Command Center) each embed a
 * loopback-only MCP server the cloud can never reach directly. The bridge:
 *
 *   1. REGISTER — MatterChat Desktop probes the local servers (discovery files in
 *      ~/Library/Application Support/Omnis/local-mcp/) and the web client posts
 *      their tool manifests to `POST /v1/chi.local-tools.register` every 60s.
 *      Manifests live in this in-memory registry, per user, with a 2-min TTL —
 *      close the desktop and the tools simply vanish from Chi's toolbox.
 *   2. CALL — when the tool loop picks a `local_<app>_<tool>`, we push
 *      {callId, app, tool, args} to the member's own session over the
 *      `notify-user` streamer and await the result (60s timeout).
 *   3. RESULT — the client executes the call against the localhost MCP (via the
 *      Desktop bridge) and posts `POST /v1/chi.local-tools.result`.
 *
 * AUTHORITY: registration and results are only ever accepted from the member's
 * own authenticated session, and a call is only ever pushed to the member who
 * asked — the bridge cannot reach another user's machine. Confirm gating: local
 * manifests carry an explicit per-tool `needsConfirm` string from the app's own
 * catalog (falling back to the same write-looking heuristic as MCP connectors).
 */
import crypto from 'crypto';

import type { ToolDef } from './llm';
import { mcpNeedsConfirm } from './mcp';
import notifications from '../../notifications/core/lib/Notifications';
import { SystemLogger } from '../../logger/system';

const NAMESPACE = 'local_';
const REGISTRY_TTL_MS = 2 * 60 * 1000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_SERVERS = 8;
const MAX_TOOLS_PER_SERVER = 80;
const MAX_RESULT_CHARS = 400_000;

export type LocalToolManifest = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	needsConfirm?: string;
};
export type LocalServerManifest = { app: string; version?: string; tools: LocalToolManifest[] };

const slug = (s: string): string =>
	String(s || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '')
		.slice(0, 24);

type Registration = { ts: number; servers: LocalServerManifest[] };
const registry = new Map<string, Registration>();

/** Store a member's local-server manifests (called from the REST endpoint). */
export function registerLocalServers(uid: string, servers: unknown): { servers: number; tools: number } {
	const clean: LocalServerManifest[] = (Array.isArray(servers) ? servers : [])
		.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
		.slice(0, MAX_SERVERS)
		.map((s) => ({
			app: slug(String(s.app || '')),
			version: typeof s.version === 'string' ? s.version.slice(0, 40) : undefined,
			tools: (Array.isArray(s.tools) ? s.tools : [])
				.filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object' && typeof t.name === 'string')
				.slice(0, MAX_TOOLS_PER_SERVER)
				.map((t) => ({
					name: String(t.name).slice(0, 80),
					description: typeof t.description === 'string' ? t.description.slice(0, 1200) : String(t.name),
					inputSchema:
						t.inputSchema && typeof t.inputSchema === 'object'
							? (t.inputSchema as Record<string, unknown>)
							: { type: 'object', properties: {} },
					needsConfirm: typeof t.needsConfirm === 'string' ? t.needsConfirm.slice(0, 300) : undefined,
				})),
		}))
		.filter((s) => s.app && s.tools.length);
	if (!clean.length) {
		registry.delete(uid);
		return { servers: 0, tools: 0 };
	}
	registry.set(uid, { ts: Date.now(), servers: clean });
	return { servers: clean.length, tools: clean.reduce((n, s) => n + s.tools.length, 0) };
}

function liveServers(uid: string): LocalServerManifest[] {
	const reg = registry.get(uid);
	if (!reg) {
		return [];
	}
	if (Date.now() - reg.ts > REGISTRY_TTL_MS) {
		registry.delete(uid);
		return [];
	}
	return reg.servers;
}

export function isLocalTool(name: string): boolean {
	return name.startsWith(NAMESPACE);
}

/** Split `local_<app>_<tool>` (tool names contain underscores; app slugs don't). */
function splitLocalName(name: string): { app: string; tool: string } | undefined {
	if (!isLocalTool(name)) {
		return undefined;
	}
	const rest = name.slice(NAMESPACE.length);
	const sep = rest.indexOf('_');
	if (sep <= 0 || sep === rest.length - 1) {
		return undefined;
	}
	return { app: rest.slice(0, sep), tool: rest.slice(sep + 1) };
}

/** The member's live local tools as loop ToolDefs (empty when the desktop is closed). */
export function localToolDefs(uid: string): ToolDef[] {
	return liveServers(uid).flatMap((s) =>
		s.tools.map((t) => ({
			name: `${NAMESPACE}${s.app}_${t.name}`,
			description: `[on your Mac: ${s.app}] ${t.description}`,
			inputSchema: t.inputSchema,
		})),
	);
}

function findLocal(uid: string, name: string): { app: string; tool: LocalToolManifest } | undefined {
	const parts = splitLocalName(name);
	if (!parts) {
		return undefined;
	}
	const server = liveServers(uid).find((s) => s.app === parts.app);
	const tool = server?.tools.find((t) => t.name === parts.tool);
	return tool ? { app: parts.app, tool } : undefined;
}

/** Confirm summary: the app's own needsConfirm wins; else the MCP write-heuristic. */
export function localConfirmSummary(uid: string, name: string, input: Record<string, unknown>): string | undefined {
	const found = findLocal(uid, name);
	if (!found) {
		return undefined;
	}
	if (found.tool.needsConfirm) {
		const args = JSON.stringify(input || {});
		return `${found.tool.needsConfirm} (${found.app}: ${args.length > 140 ? `${args.slice(0, 140)}…` : args})`;
	}
	return mcpNeedsConfirm(found.tool.name, false, input);
}

type Pending = { resolve: (r: { ok: boolean; content: string }) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, { uid: string; entry: Pending }>();

/** Resolve a relayed call (called from the REST result endpoint — member's own session only). */
export function resolveLocalCall(uid: string, callId: string, ok: boolean, content: string): boolean {
	const p = pending.get(callId);
	if (!p || p.uid !== uid) {
		return false;
	}
	pending.delete(callId);
	clearTimeout(p.entry.timer);
	p.entry.resolve({ ok, content: String(content || '').slice(0, MAX_RESULT_CHARS) });
	return true;
}

/** Execute a `local_*` tool by relaying it down to the member's own desktop session. */
export async function runLocalTool(uid: string, name: string, input: Record<string, unknown>): Promise<{ ok: boolean; content: string }> {
	const found = findLocal(uid, name);
	if (!found) {
		return {
			ok: false,
			content: 'That app is not reachable — its desktop app (or MatterChat Desktop) is not open on the user\'s Mac right now.',
		};
	}
	const callId = crypto.randomUUID();
	const result = new Promise<{ ok: boolean; content: string }>((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(callId);
			resolve({ ok: false, content: `The ${found.app} app did not answer within ${CALL_TIMEOUT_MS / 1000}s.` });
		}, CALL_TIMEOUT_MS);
		pending.set(callId, { uid, entry: { resolve, timer } });
	});
	try {
		notifications.notifyUser(uid, 'chi-local-tool', {
			callId,
			app: found.app,
			tool: found.tool.name,
			args: input || {},
		});
	} catch (err) {
		SystemLogger.warn({ msg: 'chi-local-tool push failed', uid, err: String(err) });
		resolveLocalCall(uid, callId, false, 'Could not reach your desktop session.');
	}
	return result;
}
