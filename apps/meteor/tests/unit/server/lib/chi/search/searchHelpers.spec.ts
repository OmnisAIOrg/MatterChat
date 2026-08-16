import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { AccessFilter, ChunkMessage, CitationPassage, RankCandidate } from '../../../../../../server/lib/chi/search/searchHelpers';
import {
	CHUNK_MAX_CHARS,
	CHUNK_OVERLAP_MESSAGES,
	CHUNK_TARGET_CHARS,
	buildAccessFilter,
	buildPassagePermalink,
	chunkMessages,
	citationLabel,
	cosineSimilarity,
	describeAttachments,
	formatCitations,
	keywordScore,
	matchesAccessFilter,
	queryTerms,
	rankPassages,
	roomPathSegment,
	tokenize,
} from '../../../../../../server/lib/chi/search/searchHelpers';

/** Memoized so `at(3) === at(3)`: the chunker must pass timestamps through by reference. */
const clock = new Map<number, Date>();
const at = (minutes: number): Date => {
	const cached = clock.get(minutes);
	if (cached) {
		return cached;
	}
	const date = new Date(Date.UTC(2026, 7, 14, 9, minutes, 0));
	clock.set(minutes, date);
	return date;
};

/** A message of a precise rendered length: `${username}: ${body}` must come to `chars`. */
const sized = (id: string, chars: number, username = 'dana', ts: Date = at(0)): ChunkMessage => {
	const prefix = `${username}: `;
	const body = 'x'.repeat(Math.max(1, chars - prefix.length));
	return { id, username, text: body, ts };
};

const rendered = (message: ChunkMessage): string => `${message.username}: ${message.text}`;

describe('chi/search/searchHelpers', () => {
	describe('cosineSimilarity', () => {
		it('is 1 for identical vectors', () => {
			expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).to.equal(1);
		});

		it('is 1 for parallel vectors of different magnitude (direction, not length)', () => {
			expect(cosineSimilarity([1, 2, 3], [10, 20, 30])).to.be.closeTo(1, 1e-12);
		});

		it('is -1 for exactly opposite vectors', () => {
			expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).to.equal(-1);
		});

		it('is 0 for orthogonal vectors', () => {
			expect(cosineSimilarity([1, 0], [0, 1])).to.equal(0);
		});

		it('never returns NaN for a zero-magnitude vector', () => {
			for (const value of [
				cosineSimilarity([0, 0, 0], [1, 2, 3]),
				cosineSimilarity([1, 2, 3], [0, 0, 0]),
				cosineSimilarity([0, 0], [0, 0]),
			]) {
				expect(Number.isNaN(value), 'zero vector produced NaN').to.equal(false);
				expect(value).to.equal(0);
			}
		});

		it('returns 0 for mismatched lengths rather than comparing a prefix', () => {
			// A prefix comparison would score two DIFFERENT embedding models as similar.
			expect(cosineSimilarity([1, 2, 3], [1, 2])).to.equal(0);
			expect(cosineSimilarity([1, 2], [1, 2, 3])).to.equal(0);
		});

		it('returns 0 for empty, missing or non-finite input', () => {
			expect(cosineSimilarity([], [])).to.equal(0);
			expect(cosineSimilarity(null, [1, 2])).to.equal(0);
			expect(cosineSimilarity([1, 2], undefined)).to.equal(0);
			expect(cosineSimilarity([Number.NaN, 1], [1, 1])).to.equal(0);
			expect(cosineSimilarity([Number.POSITIVE_INFINITY, 1], [1, 1])).to.equal(0);
		});

		it('stays inside [-1, 1] despite floating-point drift', () => {
			const a = [0.1, 0.2, 0.30000000000000004, 0.7];
			expect(cosineSimilarity(a, a)).to.be.at.most(1);
			expect(cosineSimilarity(a, a)).to.be.at.least(-1);
		});

		it('is symmetric', () => {
			expect(cosineSimilarity([3, 1, 4], [1, 5, 9])).to.equal(cosineSimilarity([1, 5, 9], [3, 1, 4]));
		});
	});

	describe('chunkMessages', () => {
		it('returns nothing for empty input', () => {
			expect(chunkMessages([])).to.deep.equal([]);
		});

		it('returns nothing when every message is blank or whitespace', () => {
			expect(
				chunkMessages([
					{ id: 'a', text: '', ts: at(0) },
					{ id: 'b', text: '   \n\t ', ts: at(1) },
				]),
			).to.deep.equal([]);
		});

		it('turns one message into one passage that cites it', () => {
			const passages = chunkMessages([{ id: 'm1', username: 'dana', text: 'the deposition is on the 14th', ts: at(0) }]);
			expect(passages).to.have.lengthOf(1);
			expect(passages[0].messageIds).to.deep.equal(['m1']);
			expect(passages[0].text).to.equal('dana: the deposition is on the 14th');
			expect(passages[0].part).to.equal(0);
			expect(passages[0].ts).to.equal(at(0));
			expect(passages[0].endTs).to.equal(at(0));
		});

		it('renders a message with no author as bare text', () => {
			expect(chunkMessages([{ id: 'm1', text: 'system note', ts: at(0) }])[0].text).to.equal('system note');
		});

		it('collapses internal whitespace so chunk sizes are deterministic', () => {
			expect(chunkMessages([{ id: 'm1', username: 'dana', text: 'line one\n\n   line   two', ts: at(0) }])[0].text).to.equal(
				'dana: line one line two',
			);
		});

		it('groups consecutive messages up to the target and carries every message id', () => {
			const messages = [1, 2, 3, 4].map((n) => ({ id: `m${n}`, username: 'dana', text: `short ${n}`, ts: at(n) }));
			const passages = chunkMessages(messages, { targetChars: 1000 });
			expect(passages).to.have.lengthOf(1);
			expect(passages[0].messageIds).to.deep.equal(['m1', 'm2', 'm3', 'm4']);
			expect(passages[0].ts).to.equal(at(1));
			expect(passages[0].endTs).to.equal(at(4));
		});

		it('fills a chunk to EXACTLY the target without spilling (boundary, inclusive)', () => {
			// 40 + newline + 39 === 80 === target, so both messages belong to one chunk.
			const a = sized('m1', 40, 'dana', at(1));
			const b = sized('m2', 39, 'dana', at(2));
			expect(rendered(a).length + 1 + rendered(b).length).to.equal(80);
			const passages = chunkMessages([a, b], { targetChars: 80, overlapMessages: 0 });
			expect(passages).to.have.lengthOf(1);
			expect(passages[0].text).to.have.lengthOf(80);
		});

		it('splits when the combined length is ONE character over the target', () => {
			const a = sized('m1', 40, 'dana', at(1));
			const b = sized('m2', 40, 'dana', at(2));
			expect(rendered(a).length + 1 + rendered(b).length).to.equal(81);
			const passages = chunkMessages([a, b], { targetChars: 80, overlapMessages: 0 });
			expect(passages).to.have.lengthOf(2);
			expect(passages[0].messageIds).to.deep.equal(['m1']);
			expect(passages[1].messageIds).to.deep.equal(['m2']);
		});

		it('never splits a message that is merely over the target but under the ceiling', () => {
			const long = sized('m1', 150, 'dana', at(1));
			const passages = chunkMessages([long], { targetChars: 80, maxChars: 200 });
			expect(passages).to.have.lengthOf(1);
			expect(passages[0].text).to.have.lengthOf(150);
			expect(passages[0].part).to.equal(0);
		});

		it('splits a single message larger than the hard ceiling into numbered parts that all cite it', () => {
			const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
			const passages = chunkMessages([{ id: 'huge', username: 'dana', text: words, ts: at(5) }], { targetChars: 100, maxChars: 120 });
			expect(passages.length).to.be.greaterThan(1);
			passages.forEach((passage, i) => {
				expect(passage.messageIds).to.deep.equal(['huge']);
				expect(passage.part).to.equal(i);
				expect(passage.text.length).to.be.at.most(120);
				expect(passage.ts).to.equal(at(5));
			});
			// Nothing is lost: every original word survives somewhere.
			expect(passages.map((p) => p.text).join(' '))
				.to.include('word0')
				.and.to.include('word199');
		});

		it('prefers a whitespace break so a split slice does not end mid-word', () => {
			const words = Array.from({ length: 100 }, () => 'deposition').join(' ');
			const passages = chunkMessages([{ id: 'huge', text: words, ts: at(0) }], { targetChars: 100, maxChars: 100 });
			for (const passage of passages.slice(0, -1)) {
				expect(passage.text.endsWith('deposition'), `slice ended mid-word: "${passage.text.slice(-20)}"`).to.equal(true);
			}
		});

		it('gives an oversized message its own chunk instead of truncating it into a neighbour', () => {
			const small = sized('m1', 20, 'dana', at(1));
			const huge = { id: 'm2', username: 'dana', text: 'y'.repeat(500), ts: at(2) };
			const passages = chunkMessages([small, huge], { targetChars: 80, maxChars: 100 });
			expect(passages[0].messageIds).to.deep.equal(['m1']);
			expect(passages.slice(1).every((p) => p.messageIds[0] === 'm2')).to.equal(true);
		});

		it('overlaps the last message of a chunk into the next one', () => {
			const messages = [1, 2, 3, 4].map((n) => sized(`m${n}`, 40, 'dana', at(n)));
			const passages = chunkMessages(messages, { targetChars: 81, maxChars: 200, overlapMessages: 1 });
			expect(passages.length).to.be.greaterThan(1);
			expect(passages[0].messageIds).to.deep.equal(['m1', 'm2']);
			// m2 appears again at the head of the next chunk — the whole point of overlap.
			expect(passages[1].messageIds[0]).to.equal('m2');
		});

		it('does not overlap when overlapMessages is 0', () => {
			const messages = [1, 2, 3, 4].map((n) => sized(`m${n}`, 40, 'dana', at(n)));
			const passages = chunkMessages(messages, { targetChars: 81, maxChars: 200, overlapMessages: 0 });
			const seen = passages.flatMap((p) => p.messageIds);
			expect(seen).to.deep.equal(['m1', 'm2', 'm3', 'm4']);
		});

		it('terminates (and does not repeat a chunk) when every message fills a chunk alone', () => {
			// The pathological case for overlap: chunk = 1 message, overlap = 1.
			const messages = [1, 2, 3].map((n) => sized(`m${n}`, 60, 'dana', at(n)));
			const passages = chunkMessages(messages, { targetChars: 60, maxChars: 100, overlapMessages: 1 });
			expect(passages).to.have.lengthOf(3);
			expect(passages.map((p) => p.messageIds)).to.deep.equal([['m1'], ['m2'], ['m3']]);
		});

		it('gives every chunk in a room a distinct anchor, so index ids never collide', () => {
			const messages = Array.from({ length: 30 }, (_, i) => sized(`m${i}`, 50, 'dana', at(i)));
			const passages = chunkMessages(messages, { targetChars: 120, maxChars: 200, overlapMessages: 1 });
			const anchors = passages.map((p) => `${p.messageIds[0]}:${p.part}`);
			expect(new Set(anchors).size).to.equal(anchors.length);
		});

		it('is ordered chronologically and covers every input message', () => {
			const messages = Array.from({ length: 25 }, (_, i) => sized(`m${i}`, 70, 'dana', at(i)));
			const passages = chunkMessages(messages, { targetChars: 150, maxChars: 300 });
			const times = passages.map((p) => p.ts.getTime());
			expect([...times].sort((a, b) => a - b)).to.deep.equal(times);
			const covered = new Set(passages.flatMap((p) => p.messageIds));
			expect(covered.size).to.equal(25);
		});

		it('skips blanks without breaking grouping of the messages around them', () => {
			const passages = chunkMessages(
				[
					{ id: 'm1', username: 'dana', text: 'first', ts: at(1) },
					{ id: 'm2', username: 'dana', text: '   ', ts: at(2) },
					{ id: 'm3', username: 'dana', text: 'third', ts: at(3) },
				],
				{ targetChars: 500 },
			);
			expect(passages).to.have.lengthOf(1);
			expect(passages[0].messageIds).to.deep.equal(['m1', 'm3']);
		});

		it('ships sane defaults', () => {
			expect(CHUNK_TARGET_CHARS).to.be.greaterThan(0);
			expect(CHUNK_MAX_CHARS).to.be.at.least(CHUNK_TARGET_CHARS);
			expect(CHUNK_OVERLAP_MESSAGES).to.be.at.least(0);
			const passages = chunkMessages(Array.from({ length: 40 }, (_, i) => sized(`m${i}`, 120, 'dana', at(i))));
			expect(passages.length).to.be.greaterThan(1);
			expect(Math.max(...passages.map((p) => p.text.length))).to.be.at.most(CHUNK_MAX_CHARS);
		});
	});

	describe('tokenize / keywordScore', () => {
		it('lowercases, drops punctuation, single characters and stopwords', () => {
			expect(tokenize('What did WE decide about the Deposition date?')).to.deep.equal(['decide', 'about', 'deposition', 'date']);
		});

		it('de-duplicates query terms but keeps their order', () => {
			expect(queryTerms('deposition date deposition')).to.deep.equal(['deposition', 'date']);
		});

		it('scores 0 when nothing matches, and more for better coverage', () => {
			const terms = queryTerms('deposition date');
			expect(keywordScore(terms, 'entirely unrelated chatter')).to.equal(0);
			const one = keywordScore(terms, 'the deposition is somewhere');
			const both = keywordScore(terms, 'the deposition date is set');
			expect(one).to.be.greaterThan(0);
			expect(both).to.be.greaterThan(one);
			expect(both).to.be.at.most(1);
		});

		it('rewards a passage that dwells on the topic over one that mentions it once', () => {
			const terms = queryTerms('deposition');
			const once = keywordScore(terms, 'deposition, then unrelated words follow here');
			const often = keywordScore(terms, 'deposition deposition deposition');
			expect(often).to.be.greaterThan(once);
		});

		it('scores 0 for an empty term list or empty text', () => {
			expect(keywordScore([], 'deposition')).to.equal(0);
			expect(keywordScore(queryTerms('deposition'), '')).to.equal(0);
		});
	});

	describe('rankPassages', () => {
		const vec = (id: string, embedding: number[], ts: Date, text = 'passage'): RankCandidate => ({ id, text, embedding, ts });

		it('orders by cosine similarity when the question has an embedding', () => {
			const ranked = rankPassages({ text: 'q', embedding: [1, 0] }, [vec('far', [0.2, 1], at(1)), vec('near', [1, 0.1], at(2))], {
				limit: 5,
			});
			expect(ranked.map((r) => r.id)).to.deep.equal(['near', 'far']);
			expect(ranked.every((r) => r.method === 'vector')).to.equal(true);
		});

		it('falls back to keyword scoring when the question has no embedding', () => {
			const ranked = rankPassages(
				{ text: 'deposition date' },
				[
					{ id: 'a', text: 'lunch plans for friday', ts: at(1) },
					{ id: 'b', text: 'the deposition date moved to the 14th', ts: at(2) },
				],
				{ limit: 5 },
			);
			expect(ranked.map((r) => r.id)).to.deep.equal(['b']);
			expect(ranked[0].method).to.equal('keyword');
		});

		it('treats an empty embedding array as "no embedding"', () => {
			const ranked = rankPassages({ text: 'deposition', embedding: [] }, [{ id: 'a', text: 'the deposition', ts: at(1) }]);
			expect(ranked[0].method).to.equal('keyword');
		});

		it('drops passages with no positive signal', () => {
			expect(rankPassages({ text: 'q', embedding: [1, 0] }, [vec('orthogonal', [0, 1], at(1))])).to.deep.equal([]);
			expect(rankPassages({ text: 'deposition' }, [{ id: 'a', text: 'nothing relevant', ts: at(1) }])).to.deep.equal([]);
		});

		it('honours minScore', () => {
			const candidates = [vec('weak', [1, 1], at(1)), vec('strong', [1, 0.02], at(2))];
			const ranked = rankPassages({ text: 'q', embedding: [1, 0] }, candidates, { minScore: 0.9 });
			expect(ranked.map((r) => r.id)).to.deep.equal(['strong']);
		});

		it('honours limit', () => {
			const candidates = [vec('a', [1, 0], at(1)), vec('b', [1, 0], at(2)), vec('c', [1, 0], at(3))];
			expect(rankPassages({ text: 'q', embedding: [1, 0] }, candidates, { limit: 2 })).to.have.lengthOf(2);
		});

		it('breaks equal scores by recency, newest first', () => {
			const candidates = [vec('older', [1, 0], at(1)), vec('newer', [1, 0], at(9))];
			expect(rankPassages({ text: 'q', embedding: [1, 0] }, candidates).map((r) => r.id)).to.deep.equal(['newer', 'older']);
		});

		it('breaks an equal score AND equal timestamp by id, ascending', () => {
			const candidates = [vec('zeta', [1, 0], at(3)), vec('alpha', [1, 0], at(3)), vec('mid', [1, 0], at(3))];
			expect(rankPassages({ text: 'q', embedding: [1, 0] }, candidates).map((r) => r.id)).to.deep.equal(['alpha', 'mid', 'zeta']);
		});

		it('is deterministic: input order cannot change the output order', () => {
			const build = (): RankCandidate[] => [
				vec('c', [1, 0], at(3)),
				vec('a', [1, 0], at(3)),
				vec('b', [1, 0], at(3)),
				vec('d', [0.9, 0.1], at(9)),
			];
			const forwards = rankPassages({ text: 'q', embedding: [1, 0] }, build()).map((r) => r.id);
			const backwards = rankPassages({ text: 'q', embedding: [1, 0] }, build().reverse()).map((r) => r.id);
			expect(forwards).to.deep.equal(backwards);
			expect(forwards).to.deep.equal(['a', 'b', 'c', 'd']);
		});

		it('sorts candidates missing a timestamp last among equals, still deterministically', () => {
			const candidates: RankCandidate[] = [
				{ id: 'no-ts', text: 't', embedding: [1, 0] },
				{ id: 'has-ts', text: 't', embedding: [1, 0], ts: at(1) },
			];
			expect(rankPassages({ text: 'q', embedding: [1, 0] }, candidates).map((r) => r.id)).to.deep.equal(['has-ts', 'no-ts']);
		});

		it('scores a candidate whose vector has the wrong dimensions as 0 rather than crashing', () => {
			const ranked = rankPassages({ text: 'q', embedding: [1, 0, 0] }, [vec('stale', [1, 0], at(1)), vec('current', [1, 0, 0], at(1))]);
			expect(ranked.map((r) => r.id)).to.deep.equal(['current']);
		});

		it('handles an empty candidate list', () => {
			expect(rankPassages({ text: 'q', embedding: [1, 0] }, [])).to.deep.equal([]);
		});

		it('preserves the candidate fields it was given, so citations can be built from the result', () => {
			const ranked = rankPassages<RankCandidate & { rid: string }>({ text: 'q', embedding: [1, 0] }, [
				{ id: 'p1', text: 'passage', embedding: [1, 0], ts: at(1), rid: 'r1' },
			]);
			expect(ranked[0].rid).to.equal('r1');
			expect(ranked[0].score).to.equal(1);
		});
	});

	describe('roomPathSegment / buildPassagePermalink', () => {
		it('maps each room type to the segment it actually routes under', () => {
			expect(roomPathSegment('c')).to.equal('channel');
			expect(roomPathSegment('p')).to.equal('group');
			expect(roomPathSegment('d')).to.equal('direct');
			expect(roomPathSegment('l')).to.equal('livechat');
			expect(roomPathSegment(undefined)).to.equal('channel');
			expect(roomPathSegment('wat')).to.equal('channel');
		});

		it('builds a jump link from the ROUTING name and the first message id', () => {
			expect(buildPassagePermalink('https://chat.example.com', { roomName: 'intake', roomType: 'p', messageIds: ['abc', 'def'] })).to.equal(
				'https://chat.example.com/group/intake?msg=abc',
			);
		});

		it('trims trailing slashes off the site URL', () => {
			expect(buildPassagePermalink('https://chat.example.com///', { roomName: 'intake', roomType: 'c', messageIds: ['m1'] })).to.equal(
				'https://chat.example.com/channel/intake?msg=m1',
			);
		});

		it('URL-encodes the room name and the message id', () => {
			expect(buildPassagePermalink('https://x.test', { roomName: 'smith & jones', roomType: 'c', messageIds: ['a b'] })).to.equal(
				'https://x.test/channel/smith%20%26%20jones?msg=a%20b',
			);
		});

		it('returns an empty string rather than a broken URL when a piece is missing', () => {
			expect(buildPassagePermalink('', { roomName: 'intake', roomType: 'c', messageIds: ['m1'] })).to.equal('');
			expect(buildPassagePermalink('https://x.test', { roomName: '', roomType: 'c', messageIds: ['m1'] })).to.equal('');
			expect(buildPassagePermalink('https://x.test', { roomName: 'intake', roomType: 'c', messageIds: [] })).to.equal('');
		});
	});

	describe('formatCitations', () => {
		const passage = (over: Partial<CitationPassage> = {}): CitationPassage => ({
			rid: 'r1',
			roomName: 'intake',
			roomLabel: 'intake',
			roomType: 'c',
			messageIds: ['m1'],
			text: 'dana: the deposition moved to the 14th',
			ts: at(0),
			score: 0.812,
			...over,
		});

		it('says so plainly when there is nothing to cite', () => {
			expect(formatCitations([], 'https://x.test')).to.equal('No matching passages.');
		});

		it('numbers passages from 1 and includes label, date, relevance and jump link', () => {
			const out = formatCitations([passage()], 'https://chat.example.com');
			expect(out).to.include('[1] #intake');
			expect(out).to.include('2026-08-14');
			expect(out).to.include('relevance 0.81');
			expect(out).to.include('[jump](https://chat.example.com/channel/intake?msg=m1)');
			expect(out).to.include('the deposition moved to the 14th');
		});

		it("links by ROUTING name while displaying the room's different display name", () => {
			// The trap: "Smith & Associates" displays, but the room routes as smith-associates.
			const out = formatCitations(
				[passage({ roomName: 'smith-associates', roomLabel: 'Smith & Associates', roomType: 'p' })],
				'https://x.test',
			);
			expect(out).to.include('#Smith & Associates');
			expect(out).to.include('[jump](https://x.test/group/smith-associates?msg=m1)');
			expect(out).to.not.include('/group/Smith');
		});

		it('prefixes a DM with @ rather than #', () => {
			expect(citationLabel({ roomLabel: 'dana', roomType: 'd' })).to.equal('@dana');
			expect(formatCitations([passage({ roomType: 'd', roomName: 'dana', roomLabel: 'dana' })], 'https://x.test')).to.include('[1] @dana');
		});

		it('falls back to the routing name when there is no display name', () => {
			expect(citationLabel({ roomName: 'intake', roomType: 'c' })).to.equal('#intake');
			expect(citationLabel({ roomType: 'c' })).to.equal('#conversation');
		});

		it('numbers several passages in the order given', () => {
			const out = formatCitations(
				[passage({ messageIds: ['m1'] }), passage({ messageIds: ['m2'] }), passage({ messageIds: ['m3'] })],
				'https://x.test',
			);
			expect(out).to.include('[1] ');
			expect(out).to.include('[2] ');
			expect(out).to.include('[3] ');
			expect(out).to.include('msg=m3');
		});

		it('omits the link (but still renders the passage) when there is no site URL', () => {
			const out = formatCitations([passage()], '');
			expect(out).to.not.include('[jump]');
			expect(out).to.include('the deposition moved to the 14th');
		});

		it('omits relevance when the passage carries no score', () => {
			expect(formatCitations([passage({ score: undefined })], 'https://x.test')).to.not.include('relevance');
		});

		it('truncates a long passage with an ellipsis', () => {
			const out = formatCitations([passage({ text: 'w'.repeat(5000) })], 'https://x.test', { maxChars: 100 });
			expect(out).to.include('…');
			expect(out.length).to.be.lessThan(400);
		});

		it('flattens newlines inside a passage so one citation stays one block', () => {
			const out = formatCitations([passage({ text: 'dana: one\nerin: two' })], 'https://x.test');
			expect(out.split('\n\n')).to.have.lengthOf(1);
			expect(out).to.include('dana: one erin: two');
		});
	});

	describe('buildAccessFilter — the firm/membership isolation rule', () => {
		it('constrains BOTH the firm and the room set', () => {
			expect(buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'] })).to.deep.equal({ firmId: 'firmA', rid: { $in: ['r1'] } });
		});

		it('de-duplicates and sorts room ids so the same scope always yields the same filter', () => {
			expect(buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r3', 'r1', 'r3', 'r2'] }).rid.$in).to.deep.equal(['r1', 'r2', 'r3']);
		});

		it('drops blank and non-string room ids', () => {
			const filter = buildAccessFilter({
				firmId: 'firmA',
				allowedRoomIds: ['r1', '', '   ', null as unknown as string, 7 as unknown as string],
			});
			expect(filter.rid.$in).to.deep.equal(['r1']);
		});

		it('fails CLOSED: no rooms means a filter that matches nothing', () => {
			const filter = buildAccessFilter({ firmId: 'firmA', allowedRoomIds: [] });
			expect(filter.rid.$in).to.deep.equal([]);
			expect(matchesAccessFilter(filter, { firmId: 'firmA', rid: 'r1' })).to.equal(false);
		});

		it('fails CLOSED: an entirely empty scope matches nothing', () => {
			const filter = buildAccessFilter({});
			expect(matchesAccessFilter(filter, { firmId: null, rid: 'r1' })).to.equal(false);
			expect(matchesAccessFilter(filter, { firmId: 'firmA', rid: 'r1' })).to.equal(false);
		});

		it('treats a blank firm id as the unstamped (null) cohort, not as "any firm"', () => {
			for (const firmId of [undefined, null, '', '   ']) {
				expect(buildAccessFilter({ firmId, allowedRoomIds: ['r1'] }).firmId).to.equal(null);
			}
		});

		it('widens to team-less rooms ONLY when includeShared is explicitly set', () => {
			expect(buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'], includeShared: true }).firmId).to.deep.equal({
				$in: ['firmA', null],
			});
			expect(buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'] }).firmId).to.equal('firmA');
			expect(buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'], includeShared: false }).firmId).to.equal('firmA');
		});

		it('never widens an unstamped caller: includeShared is a no-op for them', () => {
			expect(buildAccessFilter({ firmId: null, allowedRoomIds: ['r1'], includeShared: true }).firmId).to.equal(null);
		});
	});

	describe('matchesAccessFilter — proving the two layers actually hold', () => {
		const firmAScope: AccessFilter = buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'] });

		it('admits the one document that satisfies both layers', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA', rid: 'r1' })).to.equal(true);
		});

		it('REJECTS a document from another firm, even in an allowed room id', () => {
			// The cross-firm leak this whole design exists to prevent.
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmB', rid: 'r1' })).to.equal(false);
		});

		it('REJECTS a document in a room the caller is not in, even inside their own firm', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA', rid: 'r2' })).to.equal(false);
		});

		it('REJECTS a document that fails both layers at once', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmB', rid: 'r2' })).to.equal(false);
		});

		it('REJECTS a team-less (null-firm) document for a firm-stamped caller by default', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: null, rid: 'r1' })).to.equal(false);
			expect(matchesAccessFilter(firmAScope, { firmId: undefined, rid: 'r1' })).to.equal(false);
		});

		it('admits a team-less document only under an includeShared filter', () => {
			const shared = buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'], includeShared: true });
			expect(matchesAccessFilter(shared, { firmId: null, rid: 'r1' })).to.equal(true);
			// …and STILL rejects another firm, and still rejects a room they are not in.
			expect(matchesAccessFilter(shared, { firmId: 'firmB', rid: 'r1' })).to.equal(false);
			expect(matchesAccessFilter(shared, { firmId: null, rid: 'r2' })).to.equal(false);
		});

		it('REJECTS a firm-stamped document for an unstamped caller', () => {
			const unstamped = buildAccessFilter({ firmId: null, allowedRoomIds: ['r1'] });
			expect(matchesAccessFilter(unstamped, { firmId: 'firmA', rid: 'r1' })).to.equal(false);
			expect(matchesAccessFilter(unstamped, { firmId: null, rid: 'r1' })).to.equal(true);
		});

		it('REJECTS a document with no room id at all', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA' })).to.equal(false);
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA', rid: '' })).to.equal(false);
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA', rid: null })).to.equal(false);
		});

		it('is not fooled by a firm id that merely shares a prefix', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA2', rid: 'r1' })).to.equal(false);
			expect(matchesAccessFilter(buildAccessFilter({ firmId: 'firmA', allowedRoomIds: ['r1'] }), { firmId: 'firm', rid: 'r1' })).to.equal(
				false,
			);
		});

		it('is not fooled by a room id that merely shares a prefix', () => {
			expect(matchesAccessFilter(firmAScope, { firmId: 'firmA', rid: 'r10' })).to.equal(false);
		});

		it('holds across a whole mixed corpus: exactly the in-scope rows survive', () => {
			const corpus = [
				{ id: 'ok', firmId: 'firmA', rid: 'r1' },
				{ id: 'other-firm-same-room', firmId: 'firmB', rid: 'r1' },
				{ id: 'same-firm-other-room', firmId: 'firmA', rid: 'r2' },
				{ id: 'other-firm-other-room', firmId: 'firmB', rid: 'r2' },
				{ id: 'shared-room', firmId: null, rid: 'r1' },
			];
			expect(corpus.filter((doc) => matchesAccessFilter(firmAScope, doc)).map((doc) => doc.id)).to.deep.equal(['ok']);
		});
	});
});

describe('describeAttachments', () => {
	it('is empty when nothing was shared, so empty messages stay skippable', () => {
		expect(describeAttachments(undefined)).to.equal('');
		expect(describeAttachments(null)).to.equal('');
		expect(describeAttachments({})).to.equal('');
		expect(describeAttachments({ files: [], attachments: [] })).to.equal('');
	});

	it('names a single file', () => {
		expect(describeAttachments({ file: { name: 'deposition.pdf' } })).to.equal('shared deposition.pdf');
	});

	it('names every file in a multi-file upload', () => {
		expect(describeAttachments({ files: [{ name: 'a.pdf' }, { name: 'b.pdf' }] })).to.equal('shared a.pdf, b.pdf');
	});

	it('does not repeat the same name from file, files and the attachment title', () => {
		expect(
			describeAttachments({
				file: { name: 'deposition.pdf' },
				files: [{ name: 'deposition.pdf' }],
				attachments: [{ title: 'deposition.pdf' }],
			}),
		).to.equal('shared deposition.pdf');
	});

	it('keeps a genuine description alongside the name', () => {
		expect(
			describeAttachments({ file: { name: 'deposition.pdf' }, attachments: [{ title: 'deposition.pdf', description: 'Volume II' }] }),
		).to.equal('shared deposition.pdf — Volume II');
	});

	it('says something even when the name is missing', () => {
		expect(describeAttachments({ attachments: [{ description: 'the signed release' }] })).to.equal('shared a file — the signed release');
	});

	it('ignores null rows rather than throwing on them', () => {
		expect(describeAttachments({ files: [null, { name: 'a.pdf' }], attachments: [null] })).to.equal('shared a.pdf');
	});
});
