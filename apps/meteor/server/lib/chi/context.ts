/**
 * CHI assistant — pure helpers (no Meteor / no transport, unit-testable in isolation):
 *  - {@link parseChiQuestion}  — normalize the raw slash-command params into a question
 *  - {@link buildChiMessage}   — assemble the message CHI receives (question + room context,
 *                                including the room's CasePro `matterId` when present)
 *  - {@link parseChiReply}     — defensively extract the answer text from the AI-Agents
 *                                chat response (field names are not pinned by a published
 *                                contract yet — see client.ts "CONTRACT" notes)
 */

export type ChiQuestionContext = {
	/** The user's question (already parsed/trimmed). */
	question: string;
	/** Display name of the channel the question was asked in. */
	roomName?: string;
	/** CasePro matter id stamped on the room (rooms created via matter cards carry it). */
	matterId?: string;
	/** Username of the asker — CHI addresses the reply and scopes "my" questions. */
	askedBy?: string;
};

/**
 * Normalize slash-command params into the question. Strips a redundant leading
 * "@chi"/"chi:" (users copy the mention style) and collapses whitespace.
 */
export function parseChiQuestion(params: string): string {
	return (params || '')
		.replace(/^\s*@?chi\b[:,]?\s*/i, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Build the single message sent to the CHI agent. The room's `matterId` is the context
 * handle: the agent's system prompt instructs it to look the matter up via the CasePro
 * MCP tools using exactly this id. When the room has no matter we say so explicitly so
 * the agent doesn't go fishing across matters.
 */
export function buildChiMessage(ctx: ChiQuestionContext): string {
	const lines: string[] = ['[MatterChat context]'];
	if (ctx.roomName) {
		lines.push(`- Channel: ${ctx.roomName}`);
	}
	if (ctx.matterId) {
		lines.push(`- CasePro matter id: ${ctx.matterId}`);
	} else {
		lines.push('- This channel is not linked to a CasePro matter.');
	}
	if (ctx.askedBy) {
		lines.push(`- Asked by: ${ctx.askedBy}`);
	}
	return `${lines.join('\n')}\n\nQuestion: ${ctx.question}`;
}

/** One string-bearing field, if present and non-empty. */
function textOf(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}
	return undefined;
}

/** Candidate answer fields, in preference order (mirrors the AI-Agents response shapes seen so far). */
const ANSWER_FIELDS = ['response', 'reply', 'answer', 'message', 'text', 'content', 'output'] as const;

/**
 * Defensively extract the answer text from a CHI chat response body.
 * Handles: a bare string; `{ response|reply|answer|message|text|content|output }`;
 * the same fields nested one level under `data` / `result`; and Anthropic-style
 * `content: [{ text }]` block arrays. Returns undefined when nothing usable is found.
 */
export function parseChiReply(body: unknown): string | undefined {
	if (typeof body === 'string') {
		return textOf(body);
	}
	if (!body || typeof body !== 'object') {
		return undefined;
	}
	const obj = body as Record<string, unknown>;

	for (const field of ANSWER_FIELDS) {
		const value = obj[field];
		const direct = textOf(value);
		if (direct) {
			return direct;
		}
		// content/message may be a block array: [{ text: '...' }, ...]
		if (Array.isArray(value)) {
			const joined = value
				.map((block) => (block && typeof block === 'object' ? textOf((block as Record<string, unknown>).text) : textOf(block)))
				.filter(Boolean)
				.join('\n')
				.trim();
			if (joined) {
				return joined;
			}
		}
	}

	// One level of nesting: { data: {...} } / { result: {...} }
	for (const wrapper of ['data', 'result'] as const) {
		const inner = obj[wrapper];
		if (inner && typeof inner === 'object') {
			const found = parseChiReply(inner);
			if (found) {
				return found;
			}
		}
	}

	return undefined;
}
