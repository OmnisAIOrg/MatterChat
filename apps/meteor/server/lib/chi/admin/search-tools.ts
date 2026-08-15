/**
 * Chi — "Ask Anything" (F9): grounded retrieval with citations.
 *
 * "What did we decide about the deposition date?" is not a search query, it is a question,
 * and the honest answer to it is a short paragraph with links to the messages it came from.
 * This module supplies the second half — the passages and the links. The model writes the
 * paragraph.
 *
 * Two rules, the same two as ws-tools.ts:
 *
 *  1. AUTHORITY IS THE CALLER'S — and here it is enforced twice. `resolveScopedRooms` gives
 *     the caller's firm ∩ their own subscriptions; `buildAccessFilter` turns that into the
 *     Mongo clause the retrieval query runs under; `matchesAccessFilter` re-checks every row
 *     that comes back. A user cannot retrieve from a room they are not in, and cannot
 *     retrieve from another firm even if they somehow were.
 *  2. TOOLS GATHER, THE MODEL REASONS. Nothing here calls an LLM to write an answer. It
 *     returns numbered passages with jump links and lets the tool-loop model compose from
 *     them — so every sentence in the answer is traceable to a message that exists.
 *
 * ## Degrading without an embedding provider
 *
 * With no embeddings configured this does NOT error and does NOT go quiet: it falls back to
 * keyword retrieval over the same scoped rooms and SAYS SO in the text it returns, so the
 * model does not present a keyword hit as a semantic understanding of the question.
 */
import type { IMessage, IUser } from '@rocket.chat/core-typings';
import { Messages } from '@rocket.chat/models';

import type { ChiTool } from './tools';
import { getChiContext } from './turnctx';
import { ChiSearchIndex, DEFAULT_CANDIDATE_LIMIT } from '../../../models/ChiSearchIndex';
import { settings } from '../../../settings';
import { embedOne, isEmbeddingConfigured } from '../search/embeddings';
import { backfillIndex, resolveScopedRooms } from '../search/indexer';
import type { ScopedRoom } from '../search/indexer';
import type { CitationPassage, RankCandidate } from '../search/searchHelpers';
import { buildAccessFilter, formatCitations, matchesAccessFilter, queryTerms, rankPassages } from '../search/searchHelpers';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const norm = (s?: string): string => (s || '').toLowerCase();
const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Passages returned to the model in one answer. More than this and it stops citing them all. */
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 12;

/** Messages scanned by the keyword fallback before ranking. */
const KEYWORD_SCAN_LIMIT = 120;

/** One message as the keyword fallback ranks and cites it. */
type KeywordRow = { id: string; text: string; ts: Date; rid: string; score?: number };

const siteUrl = (): string => {
	try {
		return str(settings.get<string>('Site_Url'));
	} catch {
		return '';
	}
};

const roomLabel = (room: Pick<ScopedRoom, 'name' | 'fname' | 't'>): string =>
	`${room.t === 'd' ? '@' : '#'}${room.fname || room.name || 'conversation'}`;

/** Narrow the caller's in-scope rooms to one they named. Never widens the set. */
function narrowToChannel(rooms: ScopedRoom[], channel: string): ScopedRoom[] | null {
	const q = norm(channel.replace(/^[#@]/, ''));
	if (!q) {
		const ctx = getChiContext();
		if (ctx?.rid) {
			const hit = rooms.find((room) => room.rid === ctx.rid);
			return hit ? [hit] : null;
		}
		return rooms;
	}
	const match =
		rooms.find((room) => norm(room.name) === q || norm(room.fname) === q) ||
		rooms.find((room) => norm(room.name).startsWith(q) || norm(room.fname).startsWith(q)) ||
		rooms.find((room) => norm(room.name).includes(q) || norm(room.fname).includes(q));
	return match ? [match] : null;
}

/** How the model is told to use what it just got. Kept short — it is prepended to every answer. */
const GROUNDING_NOTE = [
	'Answer ONLY from the passages below, and cite each point with its [jump](…) link so the user can open the source message.',
	'If the passages do not actually contain the answer, say that plainly rather than filling the gap.',
].join(' ');

const askAnything: ChiTool = {
	def: {
		name: 'ask_anything',
		description:
			'Answer a question from what was actually said in the user\'s conversations, with a citation and jump link for every passage. Use this for any "what did we decide/agree/say about X", "when is Y", "what was the number for Z", "did anyone ever mention W" — anything whose answer lives in past messages rather than in a task, file or setting. Retrieval is semantic when the workspace has an embedding provider, keyword otherwise (the result says which). Only searches conversations the user is in, within their own firm. Compose the answer from the returned passages and KEEP the [jump](…) links.',
		inputSchema: {
			type: 'object',
			properties: {
				question: { type: 'string', description: "The question in the user's own words — not keywords." },
				channel: { type: 'string', description: 'Optional: limit to one channel/DM by name.' },
				limit: { type: 'number', description: `How many passages to return (default ${DEFAULT_TOP_K}, max ${MAX_TOP_K}).` },
			},
			required: ['question'],
		},
	},
	access: 'user',
	async execute(input, actor: IUser) {
		const question = str(input.question);
		if (!question) {
			return 'What would you like me to look up?';
		}
		const limit = Math.max(1, Math.min(num(input.limit, DEFAULT_TOP_K), MAX_TOP_K));

		const scope = await resolveScopedRooms(actor._id);
		if (!scope.rooms.length) {
			return 'There are no conversations in scope for you to search yet.';
		}

		const channel = str(input.channel);
		const rooms = channel ? narrowToChannel(scope.rooms, channel) : scope.rooms;
		if (!rooms?.length) {
			return `You're not in a conversation matching "${channel}".`;
		}

		const byRid = new Map(rooms.map((room) => [room.rid, room]));
		const filter = buildAccessFilter({
			firmId: scope.firmId,
			allowedRoomIds: rooms.map((room) => room.rid),
			includeShared: scope.includeShared,
		});
		const where = channel ? roomLabel(rooms[0]) : `${rooms.length} conversation(s) you're in`;

		// ── semantic path ───────────────────────────────────────────────────────────────────
		const embedded = isEmbeddingConfigured() ? await embedOne(question) : null;
		if (embedded) {
			const candidates = await ChiSearchIndex.findScoped(filter, { limit: DEFAULT_CANDIDATE_LIMIT, requireEmbedding: true });
			// Belt-and-braces: the query was already scoped; drop anything that somehow was not.
			const safe = candidates.filter((row) => matchesAccessFilter(filter, row) && byRid.has(row.rid));
			const ranked = rankPassages(
				{ text: question, embedding: embedded },
				safe.map((row): RankCandidate & { rid: string; messageIds: string[] } => ({
					id: row._id,
					text: row.text,
					embedding: row.embedding,
					ts: row.ts,
					rid: row.rid,
					messageIds: row.messageIds,
				})),
				{ limit },
			);
			if (ranked.length) {
				const passages: CitationPassage[] = ranked.map((row) => {
					const room = byRid.get(row.rid);
					return {
						rid: row.rid,
						roomName: room?.name,
						roomLabel: room?.fname || room?.name,
						roomType: room?.t,
						messageIds: row.messageIds,
						text: row.text,
						ts: row.ts,
						score: row.score,
					};
				});
				return [
					`${ranked.length} passage(s) most related in meaning to "${question}", from ${where}.`,
					GROUNDING_NOTE,
					'',
					formatCitations(passages, siteUrl()),
				].join('\n');
			}
		}

		// ── keyword fallback ────────────────────────────────────────────────────────────────
		const terms = queryTerms(question);
		const pattern = terms.length ? terms.slice(0, 8).map(escapeRx).join('|') : escapeRx(question);
		const hits = await Messages.find<Pick<IMessage, '_id' | 'msg' | 'u' | 'ts' | 'rid'>>(
			{ rid: { $in: filter.rid.$in }, t: { $exists: false }, msg: new RegExp(pattern, 'i') },
			{ sort: { ts: -1 }, limit: KEYWORD_SCAN_LIMIT, projection: { msg: 1, u: 1, ts: 1, rid: 1 } },
		).toArray();

		let why = 'Semantic search is not configured on this workspace, so these are KEYWORD matches, not a meaning-based search.';
		if (embedded) {
			why = 'Semantic search found nothing indexed for these conversations yet, so these are KEYWORD matches.';
		} else if (isEmbeddingConfigured()) {
			why = 'The embedding provider could not be reached, so these are KEYWORD matches, not a meaning-based search.';
		}
		const caveat = `${why} Tell the user that plainly if the passages only partly fit the question — do not present a keyword hit as a confident answer.`;

		if (!hits.length) {
			return `${caveat}\n\nNothing in ${where} mentions "${question}".`;
		}

		const rows: KeywordRow[] = hits.map((message) => ({
			id: message._id,
			text: `${message.u?.username || 'someone'}: ${(message.msg || '').replace(/\s+/g, ' ').trim()}`,
			ts: message.ts,
			rid: message.rid,
		}));
		const ranked = rankPassages({ text: question }, rows, { limit });
		// A question made only of stopwords scores nothing; the raw regex hits are still the best answer.
		const chosen: KeywordRow[] = ranked.length ? ranked : rows.slice(0, limit);

		const passages: CitationPassage[] = chosen.map((row) => {
			const room = byRid.get(row.rid);
			return {
				rid: row.rid,
				roomName: room?.name,
				roomLabel: room?.fname || room?.name,
				roomType: room?.t,
				messageIds: [row.id],
				text: row.text,
				ts: row.ts,
				score: row.score,
			};
		});

		return [
			`${chosen.length} message(s) matching "${question}", from ${where}.`,
			caveat,
			GROUNDING_NOTE,
			'',
			formatCitations(passages, siteUrl()),
		].join('\n');
	},
};

const rebuildSearchIndex: ChiTool = {
	def: {
		name: 'rebuild_search_index',
		description:
			'Build or refresh the Ask Anything passage index by embedding recent messages. Admin only, and bounded — one run covers a limited number of the most recently active conversations, and it is safe to run repeatedly (each run resumes where the last stopped). Use for "index our chats for search", "rebuild the Chi search index", "why can\'t Chi find anything".',
		inputSchema: {
			type: 'object',
			properties: {
				rooms: { type: 'number', description: 'How many conversations to cover in this run (default 50).' },
				messagesPerRoom: { type: 'number', description: 'Cap on messages read per conversation (default 400).' },
				rebuild: { type: 'boolean', description: "Discard each conversation's existing passages and rebuild from scratch." },
			},
		},
	},
	access: 'admin',
	needsConfirm: (input) => {
		const rooms = num(input.rooms, 50);
		return `${input.rebuild === true ? 'Rebuild' : 'Refresh'} the Ask Anything index over up to ${rooms} conversation(s) — this sends message text to the configured embedding provider.`;
	},
	async execute(input) {
		if (!isEmbeddingConfigured()) {
			return 'No embedding provider is configured, so there is nothing to index — Ask Anything is running on keyword search. Set the Chi Search embedding base URL, model and key under Admin → Settings.';
		}
		const optionalNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
		const result = await backfillIndex({
			roomLimit: optionalNum(input.rooms),
			messagesPerRoom: optionalNum(input.messagesPerRoom),
			rebuild: input.rebuild === true,
		});
		if (result.reason === 'embeddings-not-configured') {
			return 'The embedding provider is no longer configured — nothing was indexed.';
		}
		const total = await ChiSearchIndex.total();
		return [
			`Indexed ${result.indexed} passage(s) from ${result.messages} message(s) across ${result.rooms} conversation(s).`,
			result.skipped ? `${result.skipped} conversation(s) had nothing new (or could not be indexed).` : '',
			`The index now holds roughly ${total} passage(s).`,
		]
			.filter(Boolean)
			.join('\n');
	},
};

export const CHI_SEARCH_TOOLS: ChiTool[] = [askAnything, rebuildSearchIndex];
