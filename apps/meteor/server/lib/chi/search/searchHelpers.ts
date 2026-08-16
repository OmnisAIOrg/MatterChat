/**
 * MATTERCHAT: pure helpers for Chi "Ask Anything" (F9) — retrieval with citations.
 *
 * No Meteor, model, settings or network imports — everything here is input → output so it
 * unit-tests without a database or an embedding provider
 * (see tests/unit/server/lib/chi/search/searchHelpers.spec.ts).
 *
 * ## Why the access filter lives HERE, in a pure function
 *
 * "Ask Anything" answers from real messages, so the only thing standing between a user and
 * somebody else's confidential matter is the filter on the retrieval query. This product has
 * already shipped a cross-firm leak once, and the shape of that class of bug is always the
 * same: fetch broadly, filter afterwards. So the isolation rule is expressed as a pure value
 * (`buildAccessFilter`) that a unit test can inspect and a second pure predicate
 * (`matchesAccessFilter`) that re-checks every row AFTER it comes back from Mongo. Two
 * independent layers, both testable without a database:
 *
 *   layer 1 — FIRM: the stored `firmId` on every index row must equal the caller's firm.
 *   layer 2 — MEMBERSHIP: the stored `rid` must be one of the caller's own subscriptions.
 *
 * Neither layer is a post-filter on a broad fetch: both are clauses of the Mongo query, and
 * `matchesAccessFilter` is belt-and-braces on top. An empty room list produces `{ $in: [] }`,
 * which matches nothing — the failure mode is "no results", never "everyone's results".
 */

/* ────────────────────────────── chunking ────────────────────────────── */

/** One message as the chunker sees it. Room-scoped: a chunk never spans rooms. */
export type ChunkMessage = {
	id: string;
	username?: string;
	text: string;
	ts: Date;
};

/** A chunk of consecutive messages, ready to embed. */
export type Passage = {
	/** Every message that contributed, in order. First one is the chunk's anchor. */
	messageIds: string[];
	/** The rendered passage: one `username: text` line per message. */
	text: string;
	/** Timestamp of the FIRST message — chunks sort chronologically by this. */
	ts: Date;
	/** Timestamp of the LAST message. */
	endTs: Date;
	/**
	 * Which slice of an oversized single message this is (0 for every normal chunk).
	 * `(messageIds[0], part)` is unique within a room, which is what makes indexing
	 * idempotent — see server/models/ChiSearchIndex.ts.
	 */
	part: number;
};

export type ChunkOptions = {
	/** Soft size target: a chunk stops growing once the NEXT message would exceed it. */
	targetChars?: number;
	/** Hard ceiling: a single message longer than this is split. */
	maxChars?: number;
	/** How many trailing messages of a chunk are repeated at the head of the next one. */
	overlapMessages?: number;
};

/**
 * Chunking policy (deliberate, and the reason each number is what it is):
 *
 *  - **Target ~900 chars.** Embedding quality collapses at both ends: a one-line chunk has no
 *    context to disambiguate ("yes, the 14th" means nothing alone), and a 4k-char chunk
 *    averages several topics into one vector so it matches everything weakly. ~900 chars is
 *    roughly a 6–12 message exchange, which is the unit a decision actually happens in.
 *  - **Never split mid-message under the target.** A message is an atomic utterance; half of
 *    one is a citation that quotes a person saying something they did not say. So the target
 *    is a soft ceiling — a chunk stops BEFORE the message that would overflow it.
 *  - **One message overlap.** A decision routinely straddles a boundary ("shall we move it?"
 *    / "yes, to the 14th"). Repeating the last message at the head of the next chunk makes
 *    that exchange retrievable from either side. Overlap is intentionally 1 message, not a
 *    character window, so overlapping text is always a whole utterance.
 *  - **A single enormous message (> maxChars) is split, and only then.** A 20k-char pasted
 *    deposition cannot be embedded as one vector and cannot be dropped either. It is cut at
 *    whitespace near the ceiling, each slice keeps the SAME single message id (so every slice
 *    still cites back to the real message) and is numbered with `part`. Oversized messages
 *    never take part in overlap — repeating a slice of a wall of text adds nothing.
 */
export const CHUNK_TARGET_CHARS = 900;
export const CHUNK_MAX_CHARS = 1800;
export const CHUNK_OVERLAP_MESSAGES = 1;

/** Collapse whitespace so chunk sizes are deterministic and embeddings are not paying for layout. */
const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `username: text`, or bare text when the author is unknown. */
const renderLine = (message: ChunkMessage): string => {
	const body = flatten(message.text || '');
	const username = (message.username || '').trim();
	return username ? `${username}: ${body}` : body;
};

/**
 * Cut an over-long line into <= max-char slices, preferring a whitespace break in the last
 * fifth of the window so slices end on a word rather than mid-token.
 */
const splitLongLine = (line: string, max: number): string[] => {
	const slices: string[] = [];
	let rest = line;
	while (rest.length > max) {
		const window = rest.slice(0, max);
		const breakAt = window.lastIndexOf(' ', max);
		const cut = breakAt > Math.floor(max * 0.8) ? breakAt : max;
		slices.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) {
		slices.push(rest);
	}
	return slices;
};

/**
 * Group consecutive messages from ONE room into passages. Input must be in chronological
 * order; blank messages are dropped. Never returns an empty-text passage.
 */
export function chunkMessages(messages: readonly ChunkMessage[], options: ChunkOptions = {}): Passage[] {
	const usable = (messages || []).filter((message) => message && typeof message.text === 'string' && flatten(message.text).length > 0);
	if (!usable.length) {
		return [];
	}

	const target = Math.max(1, options.targetChars ?? CHUNK_TARGET_CHARS);
	const max = Math.max(target, options.maxChars ?? CHUNK_MAX_CHARS);
	const overlap = Math.max(0, Math.floor(options.overlapMessages ?? CHUNK_OVERLAP_MESSAGES));

	const passages: Passage[] = [];
	let index = 0;

	while (index < usable.length) {
		const first = usable[index];
		const firstLine = renderLine(first);

		// An enormous single message becomes its own numbered slices and stands alone.
		if (firstLine.length > max) {
			splitLongLine(firstLine, max).forEach((slice, part) => {
				passages.push({ messageIds: [first.id], text: slice, ts: first.ts, endTs: first.ts, part });
			});
			index += 1;
			continue;
		}

		let text = firstLine;
		const messageIds = [first.id];
		let end = index;
		let next = index + 1;

		while (next < usable.length) {
			const line = renderLine(usable[next]);
			// An oversized message always starts a fresh chunk rather than being truncated into this one.
			if (line.length > max || text.length + 1 + line.length > target) {
				break;
			}
			text += `\n${line}`;
			messageIds.push(usable[next].id);
			end = next;
			next += 1;
		}

		passages.push({ messageIds, text, ts: first.ts, endTs: usable[end].ts, part: 0 });

		// Everything is covered — overlapping here would emit a trailing chunk that repeats
		// the last message and says nothing new.
		if (end >= usable.length - 1) {
			break;
		}
		// Step back by the overlap, but ALWAYS advance at least one message: without this a
		// single-message chunk with overlap 1 would rebuild itself forever.
		index = Math.max(index + 1, end + 1 - overlap);
	}

	return passages;
}

/* ────────────────────────────── similarity ────────────────────────────── */

/**
 * Cosine similarity in [-1, 1].
 *
 * Returns 0 — never NaN — for the three degenerate cases that would otherwise poison a
 * ranking: a zero-magnitude vector (0/0), mismatched dimensions (two different embedding
 * models, or an index row written before a model change), and non-finite components.
 * 0 means "no signal", which is exactly what those cases carry.
 */
export function cosineSimilarity(a: readonly number[] | null | undefined, b: readonly number[] | null | undefined): number {
	if (!a || !b || a.length === 0 || a.length !== b.length) {
		return 0;
	}

	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return 0;
		}
		dot += x * y;
		magA += x * x;
		magB += y * y;
	}

	if (magA === 0 || magB === 0) {
		return 0;
	}

	const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB));
	if (!Number.isFinite(similarity)) {
		return 0;
	}
	// Floating-point drift can nudge identical vectors to 1.0000000000000002.
	return Math.min(1, Math.max(-1, similarity));
}

/* ────────────────────────────── keyword scoring ────────────────────────────── */

/**
 * Words carrying no retrieval signal. Kept small on purpose: an aggressive stoplist throws
 * away the words legal questions actually turn on ("no", "not", "before", "after").
 */
const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'did',
	'do',
	'does',
	'for',
	'from',
	'had',
	'has',
	'have',
	'he',
	'her',
	'his',
	'i',
	'in',
	'is',
	'it',
	'its',
	'me',
	'my',
	'of',
	'on',
	'or',
	'our',
	'she',
	'so',
	'that',
	'the',
	'their',
	'them',
	'they',
	'this',
	'to',
	'us',
	'was',
	'we',
	'were',
	'what',
	'when',
	'where',
	'which',
	'who',
	'will',
	'with',
	'you',
	'your',
]);

/** Lowercase alphanumeric terms, minus stopwords and single characters. */
export function tokenize(text: string): string[] {
	return (text || '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

/** Distinct query terms, order preserved. */
export function queryTerms(text: string): string[] {
	return Array.from(new Set(tokenize(text)));
}

/**
 * Keyword relevance in [0, 1]: mostly "how many of the asked-about terms appear", with a
 * small density component so a passage that dwells on the topic outranks one that mentions
 * it once. Purely deterministic — no randomness, no clock.
 */
export function keywordScore(terms: readonly string[], text: string): number {
	if (!terms.length) {
		return 0;
	}
	const haystack = tokenize(text);
	if (!haystack.length) {
		return 0;
	}
	const counts = new Map<string, number>();
	for (const word of haystack) {
		counts.set(word, (counts.get(word) || 0) + 1);
	}
	let matched = 0;
	let hits = 0;
	for (const term of terms) {
		const count = counts.get(term) || 0;
		if (count > 0) {
			matched += 1;
			hits += count;
		}
	}
	if (!matched) {
		return 0;
	}
	const coverage = matched / terms.length;
	const density = Math.min(1, hits / (terms.length * 3));
	return coverage * 0.9 + density * 0.1;
}

/* ────────────────────────────── ranking ────────────────────────────── */

export type RankQuery = {
	text: string;
	/** The question's embedding. Absent/empty ⇒ the whole ranking degrades to keywords. */
	embedding?: readonly number[] | null;
};

export type RankCandidate = {
	id: string;
	text: string;
	embedding?: readonly number[] | null;
	ts?: Date | null;
};

export type RankedPassage<T extends RankCandidate = RankCandidate> = T & { score: number; method: 'vector' | 'keyword' };

export type RankOptions = {
	/** How many to keep (default 8). */
	limit?: number;
	/** Passages must score strictly above this to survive (default 0). */
	minScore?: number;
};

const timeOf = (ts: Date | null | undefined): number => {
	const value = ts ? new Date(ts).getTime() : 0;
	return Number.isFinite(value) ? value : 0;
};

/**
 * Score and order candidates against a question.
 *
 * Vector mode when the question has an embedding, keyword mode otherwise — the SAME function
 * either way, so the fallback path is not a second, less-tested code path.
 *
 * Ordering is fully deterministic, which matters more than it sounds: two runs of the same
 * question must cite the same passages in the same order, or the user thinks the answer
 * changed. Ties break by score, then newest first, then message id ascending — the last one
 * guarantees a total order even for two passages with identical score and timestamp.
 */
export function rankPassages<T extends RankCandidate>(
	query: RankQuery,
	candidates: readonly T[],
	options: RankOptions = {},
): RankedPassage<T>[] {
	const limit = Math.max(0, options.limit ?? 8);
	const minScore = options.minScore ?? 0;
	const useVector = Boolean(query?.embedding && query.embedding.length > 0);
	const terms = useVector ? [] : queryTerms(query?.text || '');

	const scored: RankedPassage<T>[] = (candidates || []).map((candidate) => ({
		...candidate,
		score: useVector ? cosineSimilarity(query.embedding, candidate.embedding) : keywordScore(terms, candidate.text),
		method: useVector ? 'vector' : 'keyword',
	}));

	return scored
		.filter((candidate) => candidate.score > minScore)
		.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			const time = timeOf(b.ts) - timeOf(a.ts);
			if (time !== 0) {
				return time;
			}
			if (a.id < b.id) {
				return -1;
			}
			if (a.id > b.id) {
				return 1;
			}
			return 0;
		})
		.slice(0, limit);
}

/* ────────────────────────────── citations ────────────────────────────── */

/**
 * The URL path segment Rocket.Chat routes each room type under. A wrong segment produces a
 * link that 404s, which is worse than no link — unknown types fall back to `channel`, the
 * only one that is ever right by accident.
 */
export function roomPathSegment(roomType: string | undefined): string {
	switch (roomType) {
		case 'd':
			return 'direct';
		case 'p':
			return 'group';
		case 'l':
			return 'livechat';
		default:
			return 'channel';
	}
}

export type CitationPassage = {
	rid: string;
	/**
	 * The ROUTING name (`room.name`) — what the URL needs.
	 *
	 * Kept separate from `roomLabel` because these differ far more often than you would
	 * expect: a room can display "Smith & Associates" while routing as `smith-associates`,
	 * and deriving one from the other produces links that 404 for exactly the firms whose
	 * names needed prettifying.
	 */
	roomName?: string;
	/** The DISPLAY name (`room.fname`) — what the human reads. Falls back to `roomName`. */
	roomLabel?: string;
	roomType?: string;
	messageIds: string[];
	text: string;
	ts?: Date | null;
	score?: number;
};

/** A clickable jump link to one message, or '' when any piece is missing. */
export function buildPassagePermalink(siteUrl: string, passage: Pick<CitationPassage, 'roomName' | 'roomType' | 'messageIds'>): string {
	const base = (siteUrl || '').replace(/\/+$/, '');
	const roomName = (passage.roomName || '').trim();
	const messageId = (passage.messageIds || [])[0];
	if (!base || !roomName || !messageId) {
		return '';
	}
	return `${base}/${roomPathSegment(passage.roomType)}/${encodeURIComponent(roomName)}?msg=${encodeURIComponent(messageId)}`;
}

/** `#channel` / `@person`, using the DISPLAY name. */
export function citationLabel(passage: Pick<CitationPassage, 'roomLabel' | 'roomName' | 'roomType'>): string {
	const name = (passage.roomLabel || passage.roomName || 'conversation').trim() || 'conversation';
	return `${passage.roomType === 'd' ? '@' : '#'}${name}`;
}

const isoDay = (ts: Date | null | undefined): string => {
	if (!ts) {
		return '';
	}
	const date = new Date(ts);
	return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};

const clip = (text: string, max: number): string => {
	const flat = flatten(text);
	return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

export type CitationOptions = {
	/** Longest passage body rendered (default 600 chars). */
	maxChars?: number;
};

/**
 * Render retrieved passages as numbered, citable markdown.
 *
 * Deliberately plain: TOOLS GATHER, THE MODEL REASONS. Handing the model a pre-written answer
 * would mean summarizing a summary, and there would be nothing left to cite. Every entry
 * carries a `[jump]` link so the answer the model writes is something the user can verify in
 * one click — which is the entire point of a grounded answer.
 */
export function formatCitations(passages: readonly CitationPassage[], siteUrl: string, options: CitationOptions = {}): string {
	if (!passages?.length) {
		return 'No matching passages.';
	}
	const maxChars = Math.max(40, options.maxChars ?? 600);

	return passages
		.map((passage, i) => {
			const link = buildPassagePermalink(siteUrl, passage);
			const day = isoDay(passage.ts);
			const relevance = typeof passage.score === 'number' && Number.isFinite(passage.score) ? `relevance ${passage.score.toFixed(2)}` : '';
			const meta = [citationLabel(passage), day, relevance, link ? `[jump](${link})` : ''].filter(Boolean).join(' · ');
			return `[${i + 1}] ${meta}\n${clip(passage.text, maxChars)}`;
		})
		.join('\n\n');
}

/* ────────────────────────────── access control ────────────────────────────── */

export type AccessScope = {
	/** The caller's firm (`user.customFields.firmId`). Null/blank ⇒ the unstamped cohort. */
	firmId?: string | null;
	/** The caller's OWN subscriptions. Empty ⇒ the filter matches nothing, by design. */
	allowedRoomIds?: readonly string[];
	/**
	 * Also match rows stamped with no firm — rooms that belong to no team (workspace-wide
	 * channels, cross-firm rooms). OFF by default: the default must be the strict one.
	 */
	includeShared?: boolean;
};

/** The Mongo filter fragment enforcing both layers. Shape is asserted directly in tests. */
export type AccessFilter = {
	firmId: string | null | { $in: (string | null)[] };
	rid: { $in: string[] };
};

/**
 * Build the two-layer scope every retrieval query is constrained by.
 *
 * This is a QUERY fragment, not a post-filter: the firm and the room set are both clauses
 * Mongo evaluates, so a document outside the caller's scope is never read in the first
 * place. Room ids are de-duplicated and sorted so the same scope always produces the same
 * filter — an identical filter is an easy thing to assert on, and an easy thing to review.
 */
export function buildAccessFilter(scope: AccessScope): AccessFilter {
	const firmId = typeof scope?.firmId === 'string' && scope.firmId.trim() ? scope.firmId.trim() : null;
	const allowedRoomIds = Array.from(
		new Set(
			(scope?.allowedRoomIds || [])
				.filter((rid): rid is string => typeof rid === 'string' && rid.trim().length > 0)
				.map((rid) => rid.trim()),
		),
	).sort();

	// `includeShared` is meaningless for an unstamped caller — they ARE the null cohort.
	const firmClause: AccessFilter['firmId'] = scope?.includeShared === true && firmId !== null ? { $in: [firmId, null] } : firmId;

	return { firmId: firmClause, rid: { $in: allowedRoomIds } };
}

/**
 * Re-check one retrieved row against the filter it was supposed to have been fetched under.
 *
 * Redundant by design. A projection typo, a hand-written aggregation, or a future caller
 * that forgets to spread the filter would all silently widen the query; this predicate turns
 * that into a dropped row instead of a leaked one, and it costs a couple of comparisons.
 */
export function matchesAccessFilter(filter: AccessFilter, doc: { firmId?: string | null; rid?: string | null }): boolean {
	const rid = typeof doc?.rid === 'string' ? doc.rid : '';
	if (!rid || !filter.rid.$in.includes(rid)) {
		return false;
	}
	const docFirmId = typeof doc?.firmId === 'string' && doc.firmId ? doc.firmId : null;
	const clause = filter.firmId;
	if (clause !== null && typeof clause === 'object') {
		return clause.$in.includes(docFirmId);
	}
	return clause === docFirmId;
}

/* ── attachments ─────────────────────────────────────────────────────────────────────── */

/** The parts of a message the file describer looks at. Structural subset of IMessage. */
export type AttachedFileRef = {
	file?: { name?: string } | null;
	files?: ({ name?: string } | null)[] | null;
	attachments?: ({ title?: string; description?: string; title_link?: string } | null)[] | null;
};

/**
 * A one-line description of what was SHARED in a message, for the search index.
 *
 * The spec asks for search across "messages and files". Reading inside a PDF is the OCR
 * pipeline's job and is not attempted here; what this does is make the fact of the file
 * findable — "did anyone ever send the Hernandez deposition transcript?" is a question about a
 * filename, and today a message whose only content is an upload has no text at all and is
 * therefore invisible to retrieval.
 *
 * Returns an empty string when there is nothing shared, so the caller can keep skipping
 * genuinely empty messages.
 */
export function describeAttachments(message: AttachedFileRef | null | undefined): string {
	if (!message) {
		return '';
	}
	const names: string[] = [];
	const push = (value: unknown): void => {
		const name = typeof value === 'string' ? value.trim() : '';
		// De-duplicate: `file` and `files[0]` are the same upload on a single-file message, and
		// an attachment usually repeats the filename as its title.
		if (name && !names.includes(name)) {
			names.push(name);
		}
	};

	push(message.file?.name);
	(message.files || []).forEach((file) => push(file?.name));
	const descriptions: string[] = [];
	(message.attachments || []).forEach((attachment) => {
		push(attachment?.title);
		const description = typeof attachment?.description === 'string' ? attachment.description.trim() : '';
		if (description && !descriptions.includes(description)) {
			descriptions.push(description);
		}
	});

	if (!names.length && !descriptions.length) {
		return '';
	}
	// "shared" is deliberately in the text: it is what someone types when searching for one
	// ("who shared the settlement statement"), and it separates a file from a mention of it.
	const shared = names.length ? `shared ${names.join(', ')}` : 'shared a file';
	return descriptions.length ? `${shared} — ${descriptions.join(' ')}` : shared;
}
