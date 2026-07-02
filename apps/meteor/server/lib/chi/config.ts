/**
 * CHI assistant — configuration seam.
 *
 * CHI is the OmnisAI AI-Agents platform (a.k.a. "Chi"). MatterChat talks to it through
 * three env vars, ALL optional — when any is missing the /chi command degrades to a
 * friendly "CHI is not configured" reply instead of erroring:
 *
 *  - CHI_API_URL   — base URL of the AI-Agents backend (staging: https://ai-agent-app.stg-omnisai.io)
 *  - CHI_API_KEY   — credential the adapter presents (sent as BOTH `Authorization: Bearer`
 *                    and `X-API-Key`; see client.ts for the contract notes)
 *  - CHI_AGENT_ID  — the id of the registered MatterChat/CasePro agent to invoke
 *
 * Read at call time (not module load) so tests and runtime restarts pick up changes.
 */

export type ChiConfig = {
	/** Base URL of the AI-Agents backend, no trailing slash. */
	apiUrl: string;
	/** Shared credential for the AI-Agents backend. */
	apiKey: string;
	/** Agent id to invoke. */
	agentId: string;
};

/** Resolve the CHI config from the environment; undefined when incomplete (⇒ "not configured"). */
export function getChiConfig(env: NodeJS.ProcessEnv = process.env): ChiConfig | undefined {
	const apiUrl = (env.CHI_API_URL || '').trim().replace(/\/+$/, '');
	const apiKey = (env.CHI_API_KEY || '').trim();
	const agentId = (env.CHI_AGENT_ID || '').trim();
	if (!apiUrl || !apiKey || !agentId) {
		return undefined;
	}
	return { apiUrl, apiKey, agentId };
}

/** Whether all three CHI env vars are set. */
export function isChiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return getChiConfig(env) !== undefined;
}
