import { expect } from 'chai';

import {
	firmCohortFromScope,
	firmRoomScopeQuery,
	roomMatchesFirmScope,
	withPreservedRoomFirmId,
} from '../../../../../server/lib/firms/firmsRoomScope';

describe('firms room scope helpers', () => {
	describe('firmCohortFromScope', () => {
		it('collapses a missing scope (firms off / scoping off / admin) to undefined', () => {
			expect(firmCohortFromScope(null)).to.be.undefined;
			expect(firmCohortFromScope(undefined)).to.be.undefined;
		});
		it('collapses a firm scope to the firmId string', () => {
			expect(firmCohortFromScope({ 'customFields.firmId': 'team1' } as never)).to.equal('team1');
		});
		it('collapses the unstamped-cohort scope to null', () => {
			expect(firmCohortFromScope({ 'customFields.firmId': { $exists: false } } as never)).to.be.null;
		});
	});

	describe('firmRoomScopeQuery', () => {
		it('returns null (no scoping) when the cohort is undefined — firms off or admin', () => {
			expect(firmRoomScopeQuery(undefined)).to.be.null;
			expect(firmRoomScopeQuery(undefined, ['room1'])).to.be.null;
		});
		it('lets a firm user see own-firm rooms AND legacy unstamped rooms', () => {
			expect(firmRoomScopeQuery('team1')).to.deep.equal({
				$or: [{ 'customFields.firmId': { $exists: false } }, { 'customFields.firmId': 'team1' }],
			});
		});
		it('restricts an unstamped caller to legacy unstamped rooms only', () => {
			expect(firmRoomScopeQuery(null)).to.deep.equal({
				$or: [{ 'customFields.firmId': { $exists: false } }],
			});
		});
		it('adds a membership arm so rooms the caller is already in stay visible', () => {
			expect(firmRoomScopeQuery('team1', ['roomA', 'roomB'])).to.deep.equal({
				$or: [{ 'customFields.firmId': { $exists: false } }, { 'customFields.firmId': 'team1' }, { _id: { $in: ['roomA', 'roomB'] } }],
			});
		});
		it('omits the membership arm for an empty membership list', () => {
			expect(firmRoomScopeQuery(null, [])).to.deep.equal({
				$or: [{ 'customFields.firmId': { $exists: false } }],
			});
		});
	});

	describe('roomMatchesFirmScope', () => {
		it('passes every room (even a missing one) when there is no scoping', () => {
			expect(roomMatchesFirmScope({ customFields: { firmId: 'other' } }, undefined)).to.be.true;
			expect(roomMatchesFirmScope(null, undefined)).to.be.true;
		});
		it('shows a firm user their own-firm rooms', () => {
			expect(roomMatchesFirmScope({ customFields: { firmId: 'team1' } }, 'team1')).to.be.true;
		});
		it('hides a foreign firm room from a firm user', () => {
			expect(roomMatchesFirmScope({ customFields: { firmId: 'team2' } }, 'team1')).to.be.false;
		});
		it('keeps legacy unstamped rooms visible to every cohort', () => {
			expect(roomMatchesFirmScope({ customFields: {} }, 'team1')).to.be.true;
			expect(roomMatchesFirmScope({}, 'team1')).to.be.true;
			expect(roomMatchesFirmScope({ customFields: {} }, null)).to.be.true;
		});
		it('hides stamped rooms from the unstamped cohort', () => {
			expect(roomMatchesFirmScope({ customFields: { firmId: 'team1' } }, null)).to.be.false;
		});
		it('fails closed on a missing room under an active scope', () => {
			expect(roomMatchesFirmScope(null, 'team1')).to.be.false;
			expect(roomMatchesFirmScope(undefined, null)).to.be.false;
		});
	});

	describe('withPreservedRoomFirmId', () => {
		it('restores the existing firmId over a forged/removed one', () => {
			expect(withPreservedRoomFirmId({ firmId: 'team1' }, { topic: 'x', firmId: 'team2' })).to.deep.equal({
				topic: 'x',
				firmId: 'team1',
			});
			expect(withPreservedRoomFirmId({ firmId: 'team1' }, { topic: 'x' })).to.deep.equal({ topic: 'x', firmId: 'team1' });
		});
		it('strips an injected firmId when the room has none', () => {
			expect(withPreservedRoomFirmId({}, { firmId: 'team2', topic: 'x' })).to.deep.equal({ topic: 'x' });
			expect(withPreservedRoomFirmId(undefined, { firmId: 'team2' })).to.deep.equal({});
		});
		it('never mutates its inputs', () => {
			const existing = { firmId: 'team1' };
			const incoming = { firmId: 'team2', other: 1 };
			withPreservedRoomFirmId(existing, incoming);
			expect(existing).to.deep.equal({ firmId: 'team1' });
			expect(incoming).to.deep.equal({ firmId: 'team2', other: 1 });
		});
		it('strips a FORGED firmTeam/firmName on a room that carries neither', () => {
			// forging firmTeam makes invite redemption adopt every redeemer into a cohort
			// of the forger's choosing (useInviteToken -> adoptUserIntoFirm)
			expect(withPreservedRoomFirmId({ firmId: 'team1' }, { firmTeam: true, firmName: 'Anything', topic: 'x' })).to.deep.equal({
				topic: 'x',
				firmId: 'team1',
			});
		});
		it('restores firmTeam/firmName when the caller tries to STRIP them', () => {
			// stripping firmTeam disables firm adoption AND exempts the room from the
			// tightenFirmInvites sweep, which selects on customFields.firmTeam
			expect(withPreservedRoomFirmId({ firmId: 'team1', firmTeam: true, firmName: 'Acme Law' }, {})).to.deep.equal({
				firmId: 'team1',
				firmTeam: true,
				firmName: 'Acme Law',
			});
		});
		it('restores firmTeam/firmName over forged replacements', () => {
			expect(
				withPreservedRoomFirmId({ firmId: 'team1', firmTeam: true, firmName: 'Acme Law' }, { firmTeam: false, firmName: 'Evil Corp' }),
			).to.deep.equal({ firmId: 'team1', firmTeam: true, firmName: 'Acme Law' });
		});
	});
});
