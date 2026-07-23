/**
 * Chi local-tools bridge — CLIENT half (server half: server/lib/chi/admin/localtools.ts).
 *
 * Runs only inside MatterChat Desktop (the Electron preload exposes localMcp on
 * window.matterchatDesktop). Every 60s it asks the Desktop main process which Omnis
 * apps are running on this Mac (EvidenceHunt / Omnis CC — each embeds a loopback-only
 * MCP server, discovered via ~/Library/Application Support/Omnis/local-mcp/) and
 * registers their tool manifests with the server, which merges them into Chi's tool
 * loop as `local_<app>_<tool>`. When Chi picks one mid-turn, the server pushes
 * `${uid}/chi-local-tool` over the notify-user stream; we relay the call to the local
 * app via the Desktop bridge and POST the result back.
 *
 * Close the desktop (or one app) and its tools silently age out server-side (2-min
 * TTL) — no errors, just a smaller toolbox. Web sessions without the Desktop bridge
 * do nothing here.
 */
import { sdk } from '../../app/utils/client/lib/SDKClient';

type LocalMcpTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; needsConfirm?: string };
type LocalMcpServer = { app: string; version?: string; tools: LocalMcpTool[] };
type LocalMcpBridge = {
	localMcpList?: () => Promise<LocalMcpServer[]>;
	localMcpCall?: (app: string, tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;
};

const bridge = (): LocalMcpBridge | undefined => (window as unknown as { matterchatDesktop?: LocalMcpBridge }).matterchatDesktop;

const HEARTBEAT_MS = 60_000;

// Untyped REST routes (not in rest-typings — same approach as askChi's chi.ask call).
const post = (path: string, body: unknown): Promise<unknown> =>
	(sdk.rest.post as unknown as (p: string, b: unknown) => Promise<unknown>)(path, body);

let installed = false;

/** Idempotent — called once from ChiOrbMount. No-op outside the desktop app. */
export function installLocalToolsBridge(uid: string): void {
	if (installed || !uid) {
		return;
	}
	const b = bridge();
	if (!b?.localMcpList || !b?.localMcpCall) {
		return;
	}
	installed = true;

	const register = async (): Promise<void> => {
		try {
			const servers = (await b.localMcpList?.()) || [];
			await post('/v1/chi.local-tools.register', { servers });
		} catch {
			// Desktop briefly unreachable or REST hiccup — the next heartbeat retries; server TTL
			// handles the rest.
		}
	};

	void register();
	const timer = setInterval(() => void register(), HEARTBEAT_MS);

	const { stop } = sdk.stream('notify-user', [`${uid}/chi-local-tool`], (call) => {
		void (async (): Promise<void> => {
			const { callId, app, tool, args } = call;
			let ok = false;
			let content = '';
			try {
				const r = await b.localMcpCall?.(app, tool, args || {});
				ok = r?.ok === true;
				content = typeof r?.content === 'string' ? r.content : JSON.stringify(r ?? null);
			} catch (err) {
				content = `Local call failed: ${err instanceof Error ? err.message : String(err)}`;
			}
			try {
				await post('/v1/chi.local-tools.result', { callId, ok, content });
			} catch {
				// Result lost — the server's 60s call timeout answers the turn.
			}
		})();
	});

	window.addEventListener('beforeunload', () => {
		clearInterval(timer);
		stop();
	});
}
