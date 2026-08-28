/**
 * Chi Admin Assistant — the Claude sign-in provider (no API key).
 *
 * Ported from EvidenceHunt's `chatClaudeCode` (src/main/llm.ts), which is where the orb's
 * provider roster came from in the first place; the roster shipped without this entry and
 * without the Codex/ChatGPT one. The Claude login is NOT an HTTP endpoint — there is no base
 * URL and no key to paste — so it cannot go through llm.ts's fetch path. It is the Agent SDK
 * driving the `claude` CLI on the host, billed to that machine's Claude subscription.
 *
 * ONE DELIBERATE DIVERGENCE FROM EVIDENCEHUNT. Its version is `allowedTools: []`, `maxTurns: 1`,
 * `toolCalls: []` — pure text, because the Claude login there only ever runs draft/rewrite/cite.
 * Chi is nothing BUT a tool loop (navigate, post_message, create_task, mcp_casepro_*), so a
 * text-only port would produce an orb that talks and cannot act. Here the tool schemas are
 * registered as an in-process SDK MCP server and `canUseTool` intercepts the model's decision
 * and DENIES execution, handing the call back to service.ts. That keeps Chi's own loop, its
 * confirm/park gate, its caller-scoping and its audit trail exactly as they are — the SDK
 * chooses the tool, Chi is still the only thing that ever runs one.
 *
 * SECURITY — this spawns Claude Code ON THE WORKSPACE HOST, reachable from chat input:
 *  - `tools: []` disables every built-in (Bash/Read/Write/WebFetch). Without this, "Chi" would
 *    be an arbitrary-code-execution surface for anyone who can DM the bot.
 *  - `canUseTool` denies unconditionally — including anything not in Chi's registry.
 *  - `settingSources: []` so the host's ~/.claude CLAUDE.md, settings and hooks never leak into
 *    a workspace assistant's prompt.
 *  - ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are scrubbed, so a run can only ever bill the
 *    login and can never silently fall back to API billing (EvidenceHunt's guarantee, kept).
 */
import type { ChiTurn, LlmStep, ToolCall, ToolDef } from './llm';

/** Same host-only constraint as the Ollama/LM Studio presets: the CLI must exist on the
 *  machine running Meteor, signed in. On the staging pod it does not — hence local: true. */
const SDK = '@anthropic-ai/claude-agent-sdk';

const NOT_INSTALLED =
	'The Claude sign-in provider needs the `claude` CLI on the workspace host. Install it (`npm i -g @anthropic-ai/claude-code`), run `claude` once and sign in, then retry.';
const NOT_SIGNED_IN =
	'The Claude login on the workspace host has expired. Run `claude` in a terminal there, sign in with `/login`, then retry — or switch Chi to a provider with an API key.';

/**
 * ESM-only packages under Meteor's CJS interop: a plain dynamic `import()` gets transpiled to a
 * require() and fails. `new Function` hides it from the transpiler so it stays a real import.
 * Same dodge EvidenceHunt uses for this exact package, and the same class of interop bug the
 * `server-fetch` comment in llm.ts documents.
 */
const esmImport = <T>(spec: string): Promise<T> => new Function('s', 'return import(s)')(spec) as Promise<T>;

/* ── JSON Schema → Zod, only the vocabulary Chi's tools actually use ────────────────── */

type JsonSchema = {
	type?: string;
	description?: string;
	enum?: unknown[];
	items?: JsonSchema;
	properties?: Record<string, JsonSchema>;
	required?: string[];
};

/**
 * The SDK's tool() takes a Zod raw shape, Chi's ToolDef carries JSON Schema. Chi's schemas are
 * flat string/number/boolean/array/object with the odd enum, so a small converter beats pulling
 * in a json-schema-to-zod dependency. Anything unrecognized degrades to z.unknown() rather than
 * throwing — an imperfectly-typed argument is recoverable, a dead turn is not.
 */
function toZod(z: any, schema: JsonSchema | undefined): any {
	if (!schema || typeof schema !== 'object') {
		return z.unknown();
	}
	if (Array.isArray(schema.enum) && schema.enum.length) {
		const values = schema.enum.filter((v): v is string => typeof v === 'string');
		return values.length === schema.enum.length ? z.enum(values as [string, ...string[]]) : z.unknown();
	}
	switch (schema.type) {
		case 'string':
			return z.string();
		case 'number':
		case 'integer':
			return z.number();
		case 'boolean':
			return z.boolean();
		case 'array':
			return z.array(toZod(z, schema.items));
		case 'object':
			return z.object(shapeOf(z, schema));
		default:
			return z.unknown();
	}
}

/** Build the raw shape for one object schema, applying `required` as optionality.
 *  Exported for tests (mirrors llm.ts's parse* exports) — zod is injected so the spec can pass
 *  the real library without this module taking a static ESM import under Meteor's CJS interop. */
export function shapeOf(z: any, schema: JsonSchema): Record<string, any> {
	const required = new Set(schema.required || []);
	const shape: Record<string, any> = {};
	for (const [key, prop] of Object.entries(schema.properties || {})) {
		let field = toZod(z, prop);
		if (prop?.description) {
			field = field.describe(prop.description);
		}
		shape[key] = required.has(key) ? field : field.optional();
	}
	return shape;
}

/* ── Transcript rendering ──────────────────────────────────────────────────────────── */

/**
 * The Agent SDK takes one prompt string, not a role-tagged message array, so Chi's transcript is
 * rendered as text. Tool calls and their results are labelled explicitly so the model can see
 * what it already tried — the loop in service.ts re-sends the whole transcript every step, so
 * this stays stateless and no session is resumed between steps.
 */
function renderTranscript(system: string, turns: ChiTurn[]): string {
	const lines: string[] = [system.trim(), ''];
	for (const turn of turns) {
		if (turn.kind === 'user') {
			lines.push(`User: ${turn.text}`);
		} else if (turn.kind === 'assistant') {
			if (turn.text) {
				lines.push(`Assistant: ${turn.text}`);
			}
			for (const call of turn.toolCalls || []) {
				lines.push(`Assistant called tool ${call.name} with ${JSON.stringify(call.input)}`);
			}
		} else {
			for (const result of turn.results) {
				lines.push(`Result of ${result.name}${result.isError ? ' (error)' : ''}: ${result.content}`);
			}
		}
	}
	lines.push('', 'Reply to the user. Call a tool if one is needed to answer or to act.');
	return lines.join('\n');
}

/* ── The step ──────────────────────────────────────────────────────────────────────── */

const MCP_SERVER = 'chi';
/** SDK namespacing is `mcp__<server>__<tool>`; Chi's own MCP connectors use a single underscore
 *  (`mcp_casepro_query`), so stripping the SDK prefix cannot corrupt a connector tool name. */
const chiToolName = (name: string): string => (name.startsWith(`mcp__${MCP_SERVER}__`) ? name.slice(`mcp__${MCP_SERVER}__`.length) : name);

/**
 * One model step on the host's Claude login: system + transcript + tools in, normalized
 * { text, toolCalls } out — the same contract llmStep() has, so service.ts stays provider-blind.
 * NEVER throws; failures come back as { ok:false, note }.
 */
export async function claudeCodeStep(model: string, system: string, turns: ChiTurn[], tools: ToolDef[]): Promise<LlmStep> {
	let sdk: any;
	let zod: any;
	try {
		[sdk, zod] = await Promise.all([esmImport<any>(SDK), esmImport<any>('zod')]);
	} catch {
		return { ok: false, note: NOT_INSTALLED };
	}
	const z = zod.z || zod.default?.z || zod.default;

	// Bill the login, never a key that happens to be in the server's environment.
	const env = { ...process.env };
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;

	const captured: ToolCall[] = [];
	const known = new Set(tools.map((t) => t.name));
	const seen = new Set<string>();
	const record = (id: string, name: string, input: Record<string, unknown>): void => {
		const key = `${name}:${JSON.stringify(input)}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		captured.push({ id, name, input });
	};

	const chiServer = sdk.createSdkMcpServer({
		name: MCP_SERVER,
		tools: tools.map((def) =>
			sdk.tool(def.name, def.description, shapeOf(z, def.inputSchema as JsonSchema), async () => ({
				// Unreachable: canUseTool denies every call before execution. Present because the
				// SDK requires a handler, and defensive in case a future SDK skips the gate.
				content: [{ type: 'text', text: 'Chi executes this tool itself.' }],
			})),
		),
	});

	try {
		const q = sdk.query({
			prompt: renderTranscript(system, turns),
			options: {
				env,
				tools: [], // no Bash/Read/Write — this runs on the workspace host
				settingSources: [], // never inherit the host's CLAUDE.md / settings / hooks
				mcpServers: { [MCP_SERVER]: chiServer },
				// DO NOT add an `allowedTools` list here. Registering the tools on the MCP server
				// is what offers them to the model; `allowedTools` is a permission allowlist, and
				// a bare entry AUTO-APPROVES that tool before canUseTool is consulted (the SDK
				// warns CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). With it set, the SDK would run its own
				// stub handler and Chi would receive zero tool calls — an orb that answers in
				// prose and silently never acts. Leaving it unset is what routes every call
				// through the callback below.
				maxTurns: 1,
				...(model && model !== 'inherit' && model !== 'claude-code' ? { model } : {}),
				// The seam: the model decides, Chi executes. Deny ALWAYS — that is the hard stop
				// that keeps this from being an arbitrary-execution surface on the workspace host,
				// and it holds even if a built-in slips past `tools: []`. Only calls that name a
				// real Chi tool are handed back to the loop; anything else is dropped, so an
				// unknown name can never reach runAnyTool. `interrupt` ends the SDK turn at once
				// rather than paying for a second one we would discard.
				canUseTool: async (name: string, input: Record<string, unknown>) => {
					const chiName = chiToolName(name);
					if (known.has(chiName)) {
						record(`cc_${captured.length}`, chiName, input || {});
					}
					return { behavior: 'deny', message: 'Chi runs this tool itself.', interrupt: true };
				},
			},
		});

		let text = '';
		for await (const msg of q) {
			const m = msg as { type: string; subtype?: string; result?: string; message?: { content?: unknown } };
			if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
				for (const block of m.message.content as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]) {
					if (block.type === 'text' && block.text?.trim()) {
						text += (text ? '\n\n' : '') + block.text.trim();
					} else if (block.type === 'tool_use' && block.name && known.has(chiToolName(block.name))) {
						// Preferred over the canUseTool capture when both fire: this carries the model's
						// real tool_use id. `record` dedupes on name+input so the pair collapses to one.
						record(block.id || `cc_${captured.length}`, chiToolName(block.name), block.input || {});
					}
				}
			}
			if (m.type === 'result' && /not logged in|please run \/login|oauth.*expired|re-authenticate/i.test(m.result || '')) {
				return { ok: false, note: NOT_SIGNED_IN };
			}
		}
		return { ok: true, text: text.trim(), toolCalls: captured };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/oauth|401|not logged in|\/login|authenticate/i.test(message)) {
			return { ok: false, note: NOT_SIGNED_IN };
		}
		if (/ENOENT|not found|executable/i.test(message)) {
			return { ok: false, note: NOT_INSTALLED };
		}
		return { ok: false, note: `The Claude sign-in provider failed — ${message}` };
	}
}
