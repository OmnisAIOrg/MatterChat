import { expect } from 'chai';
import { describe, it } from 'mocha';

import { buildChiMessage, parseChiQuestion, parseChiReply } from '../../../../../server/lib/chi/context';

describe('chi/context', () => {
	describe('parseChiQuestion (command parsing)', () => {
		it('trims a plain question', () => {
			expect(parseChiQuestion('  what is the SOL date?  ')).to.equal('what is the SOL date?');
		});

		it('strips a redundant leading @chi mention', () => {
			expect(parseChiQuestion('@chi what is the last offer?')).to.equal('what is the last offer?');
			expect(parseChiQuestion('chi: what is the last offer?')).to.equal('what is the last offer?');
		});

		it('collapses internal whitespace', () => {
			expect(parseChiQuestion('total   billed\n so far?')).to.equal('total billed so far?');
		});

		it('returns empty for empty/whitespace/mention-only input', () => {
			expect(parseChiQuestion('')).to.equal('');
			expect(parseChiQuestion('   ')).to.equal('');
			expect(parseChiQuestion('@chi')).to.equal('');
		});

		it('does not eat a question that merely starts with a chi-prefixed word', () => {
			expect(parseChiQuestion('chihuahua bite case — status?')).to.equal('chihuahua bite case — status?');
		});
	});

	describe('buildChiMessage (context assembly)', () => {
		it('includes the matterId, room name, asker and question', () => {
			const msg = buildChiMessage({
				question: 'what is the treatment status?',
				roomName: 'smith-v-jones',
				matterId: 'matter-123',
				askedBy: 'phillip',
			});
			expect(msg).to.include('CasePro matter id: matter-123');
			expect(msg).to.include('Channel: smith-v-jones');
			expect(msg).to.include('Asked by: phillip');
			expect(msg).to.include('Question: what is the treatment status?');
		});

		it('states explicitly when the room has no matter (no cross-matter fishing)', () => {
			const msg = buildChiMessage({ question: 'hello', roomName: 'general' });
			expect(msg).to.include('not linked to a CasePro matter');
			expect(msg).to.not.include('CasePro matter id:');
		});
	});

	describe('parseChiReply (defensive answer extraction)', () => {
		it('reads a bare string', () => {
			expect(parseChiReply('the answer')).to.equal('the answer');
		});

		it('reads the common flat fields in preference order', () => {
			expect(parseChiReply({ response: 'a' })).to.equal('a');
			expect(parseChiReply({ reply: 'b' })).to.equal('b');
			expect(parseChiReply({ answer: 'c' })).to.equal('c');
			expect(parseChiReply({ message: 'd' })).to.equal('d');
			expect(parseChiReply({ text: 'e' })).to.equal('e');
		});

		it('reads one level of data/result nesting', () => {
			expect(parseChiReply({ data: { answer: 'nested' } })).to.equal('nested');
			expect(parseChiReply({ result: { response: 'nested2' } })).to.equal('nested2');
		});

		it('joins content block arrays', () => {
			expect(
				parseChiReply({
					content: [
						{ type: 'text', text: 'part1' },
						{ type: 'text', text: 'part2' },
					],
				}),
			).to.equal('part1\npart2');
		});

		it('returns undefined for junk', () => {
			expect(parseChiReply(undefined)).to.equal(undefined);
			expect(parseChiReply(null)).to.equal(undefined);
			expect(parseChiReply(42)).to.equal(undefined);
			expect(parseChiReply({})).to.equal(undefined);
			expect(parseChiReply({ response: '' })).to.equal(undefined);
			expect(parseChiReply({ status: 'ok' })).to.equal(undefined);
		});
	});
});
