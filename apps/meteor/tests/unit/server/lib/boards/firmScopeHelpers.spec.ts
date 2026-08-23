import type { IBoard } from '@rocket.chat/core-typings';
import { expect } from 'chai';

import { filterBoardsForFirm, firmIdOfUser } from '../../../../../server/lib/boards/firmScopeHelpers';

const board = (id: string, memberIds: string[]): IBoard =>
	({ _id: id, members: memberIds.map((userId) => ({ userId, role: 'member' })) }) as IBoard;

describe('boards firm scope helpers', () => {
	describe('firmIdOfUser', () => {
		it('reads the stamp off customFields', () => {
			expect(firmIdOfUser({ customFields: { firmId: 'firmA' } })).to.equal('firmA');
		});
		it('treats a missing, empty or non-string stamp as unstamped', () => {
			expect(firmIdOfUser({ customFields: {} })).to.be.undefined;
			expect(firmIdOfUser({ customFields: { firmId: '' } })).to.be.undefined;
			expect(firmIdOfUser({ customFields: { firmId: 42 } })).to.be.undefined;
			expect(firmIdOfUser({})).to.be.undefined;
			expect(firmIdOfUser(null)).to.be.undefined;
		});
	});

	describe('filterBoardsForFirm', () => {
		// The regression that matters most: a workspace with one firm must see no
		// change at all, whether or not its users carry a firm stamp.
		it('returns EVERY board in a single-firm workspace', () => {
			const boards = [board('b1', ['alice']), board('b2', ['bob']), board('b3', ['carol'])];
			const firms = new Map([
				['alice', 'firmA'],
				['bob', 'firmA'],
				['carol', 'firmA'],
			]);
			expect(filterBoardsForFirm(boards, 'alice', 'firmA', firms)).to.have.lengthOf(3);
		});

		it('returns EVERY board when nobody is stamped (workspace predating self-serve firms)', () => {
			const boards = [board('b1', ['alice']), board('b2', ['bob'])];
			const firms = new Map<string, string | undefined>([
				['alice', undefined],
				['bob', undefined],
			]);
			expect(filterBoardsForFirm(boards, 'alice', undefined, firms)).to.have.lengthOf(2);
		});

		it('hides another firm’s board', () => {
			const boards = [board('b1', ['alice']), board('b2', ['bob'])];
			const firms = new Map([
				['alice', 'firmA'],
				['bob', 'firmB'],
			]);
			expect(filterBoardsForFirm(boards, 'alice', 'firmA', firms).map((b) => b._id)).to.deep.equal(['b1']);
			expect(filterBoardsForFirm(boards, 'bob', 'firmB', firms).map((b) => b._id)).to.deep.equal(['b2']);
		});

		it('reaches a same-firm board the caller is not a member of', () => {
			const boards = [board('b1', ['alice']), board('b2', ['bob'])];
			const firms = new Map([
				['alice', 'firmA'],
				['bob', 'firmA'],
			]);
			// carol is in firmA but on no board — she still reaches her firm's boards
			expect(filterBoardsForFirm(boards, 'carol', 'firmA', firms)).to.have.lengthOf(2);
		});

		it('lets explicit membership win over the firm cohort (a shared board)', () => {
			const boards = [board('b1', ['bob', 'alice'])];
			const firms = new Map([
				['alice', 'firmA'],
				['bob', 'firmB'],
			]);
			expect(filterBoardsForFirm(boards, 'alice', 'firmA', firms)).to.have.lengthOf(1);
		});

		it('does not let an unresolvable member grant reach', () => {
			// b2's only member was deleted, so nothing attributes it to a firm
			const boards = [board('b1', ['alice']), board('b2', ['ghost'])];
			const firms = new Map([['alice', 'firmA']]);
			expect(filterBoardsForFirm(boards, 'alice', 'firmA', firms).map((b) => b._id)).to.deep.equal(['b1']);
		});

		it('does not let the unstamped cohort reach a stamped firm’s board', () => {
			const boards = [board('b1', ['alice'])];
			const firms = new Map([['alice', 'firmA']]);
			expect(filterBoardsForFirm(boards, 'admin', undefined, firms)).to.have.lengthOf(0);
		});

		it('returns nothing rather than everything when the caller reaches no board', () => {
			const boards = [board('b1', ['alice']), board('b2', ['bob'])];
			const firms = new Map([
				['alice', 'firmA'],
				['bob', 'firmA'],
			]);
			expect(filterBoardsForFirm(boards, 'mallory', 'firmZ', firms)).to.deep.equal([]);
		});
	});
});
