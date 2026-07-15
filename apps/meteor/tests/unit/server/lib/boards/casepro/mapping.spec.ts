import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	userDisplayName,
	buildUserNameMap,
	mapProviders,
	mapExpenseTotal,
	mapMatterSnapshot,
	type MatterRowBundle,
} from '../../../../../../server/lib/boards/casepro/mapping';

/**
 * Pure-mapper coverage for the CasePro-depth fields added to IMatterSnapshot:
 * incidentDescription, expensesTotal, providers[] and resolved team names.
 */
describe('CasePro mapping — matter-depth fields', () => {
	describe('userDisplayName', () => {
		it('prefers the single `name` column (CentralizedAuth shape)', () => {
			expect(userDisplayName({ id: 'u1', name: 'Alex Marshall', email: 'a@x.com' })).to.equal('Alex Marshall');
		});
		it('falls back to first_name + last_name, then email', () => {
			expect(userDisplayName({ id: 'u2', first_name: 'Bianca', last_name: 'Torres' })).to.equal('Bianca Torres');
			expect(userDisplayName({ id: 'u3', email: 'chris@x.com' })).to.equal('chris@x.com');
		});
		it('returns undefined for a null/empty user', () => {
			expect(userDisplayName(null)).to.equal(undefined);
			expect(userDisplayName({ id: 'u4' })).to.equal(undefined);
		});
	});

	describe('buildUserNameMap', () => {
		it('maps id -> display name and skips rows without an id or name', () => {
			const map = buildUserNameMap([
				{ id: 'u1', name: 'Alex Marshall' },
				{ id: 'u2', first_name: 'Bianca', last_name: 'Torres' },
				{ name: 'No Id' },
				{ id: 'u3' },
			]);
			expect(map.get('u1')).to.equal('Alex Marshall');
			expect(map.get('u2')).to.equal('Bianca Torres');
			expect(map.size).to.equal(2);
		});
	});

	describe('mapProviders', () => {
		it('sources name/type from a nested party (native) and from a party map (stub)', () => {
			const partyById = new Map<string, Record<string, unknown>>([
				['pp1', { id: 'pp1', record_type: 'Business', party_name: 'St. Joseph Medical Center', provider_type: 'Hospital' }],
			]);
			const providers = mapProviders(
				[
					{ id: 'mp1', party_id: 'pp1', deleted_at: null },
					{ id: 'mp2', party: { id: 'pp2', record_type: 'Business', party_name: 'Elite PT', provider_type: 'Physical Therapy' } },
				],
				partyById,
			);
			expect(providers).to.deep.equal([
				{ name: 'St. Joseph Medical Center', type: 'Hospital' },
				{ name: 'Elite PT', type: 'Physical Therapy' },
			]);
		});
		it('skips soft-deleted providers and rows with no resolvable name', () => {
			const providers = mapProviders([
				{ id: 'mp1', party_id: 'gone', deleted_at: '2026-01-01' },
				{ id: 'mp2', party_id: 'unknown' },
			]);
			expect(providers).to.deep.equal([]);
		});
		it('omits `type` when the party has no provider_type', () => {
			const providers = mapProviders([{ id: 'mp1', party: { id: 'p', party_name: 'Solo Clinic' } }]);
			expect(providers).to.deep.equal([{ name: 'Solo Clinic' }]);
		});
	});

	describe('mapMatterSnapshot — new fields', () => {
		const baseBundle = (over: Partial<MatterRowBundle> = {}): MatterRowBundle => ({
			matter: {
				id: 'm1',
				matter_name: 'Doe v. Roe',
				description: 'Rear-end collision on I-45.',
				principal_attorney: 'u-att',
				case_manager: 'u-cm',
			},
			caseTypes: [],
			matterStages: [],
			matterSubStages: [],
			settlementTypes: [],
			providerCount: 1,
			providers: [{ id: 'mp1', party_id: 'pp1' }],
			providerPartyById: new Map([['pp1', { id: 'pp1', record_type: 'Business', party_name: 'St. Joseph Medical Center', provider_type: 'Hospital' }]]),
			bills: [],
			negotiations: [],
			resolutions: [],
			liens: [],
			reductions: [],
			expenses: [{ amount: '1500.00' }, { amount: '850.25' }],
			...over,
		});

		it('maps incidentDescription, expensesTotal and providers[]', () => {
			const snap = mapMatterSnapshot(baseBundle());
			expect(snap.incidentDescription).to.equal('Rear-end collision on I-45.');
			expect(snap.expensesTotal).to.equal(mapExpenseTotal(baseBundle().expenses));
			expect(snap.expensesTotal).to.equal(2350.25);
			expect(snap.providers).to.deep.equal([{ name: 'St. Joseph Medical Center', type: 'Hospital' }]);
			expect(snap.providerCount).to.equal(1);
		});

		it('resolves team names when a resolver map is supplied', () => {
			const snap = mapMatterSnapshot(baseBundle({ teamNameById: new Map([['u-att', 'Alex Marshall'], ['u-cm', 'Bianca Torres']]) }));
			expect(snap.team).to.deep.include({ role: 'Principal Attorney', name: 'Alex Marshall' });
			expect(snap.team).to.deep.include({ role: 'Case Manager', name: 'Bianca Torres' });
		});

		it('falls back to the raw user id when no resolver map is given', () => {
			const snap = mapMatterSnapshot(baseBundle());
			expect(snap.team).to.deep.include({ role: 'Principal Attorney', name: 'u-att' });
		});
	});
});
