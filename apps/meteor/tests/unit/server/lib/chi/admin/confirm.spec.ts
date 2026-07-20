import { expect } from 'chai';
import { describe, it } from 'mocha';

import { clearPendingAction, hasPendingAction, parkPendingAction, takePendingAction } from '../../../../../../server/lib/chi/admin/confirm';

const BASE = { rid: 'r1', userId: 'u1', toolName: 'set_user_active', input: { username: 'x', active: false }, summary: 'deactivate x' };

describe('chi admin confirm store', () => {
	it('parks and takes exactly once (one-shot)', () => {
		parkPendingAction(BASE, 1000);
		expect(hasPendingAction('r1', 'u1', 2000)).to.be.true;
		const taken = takePendingAction('r1', 'u1', 2000);
		expect(taken?.toolName).to.equal('set_user_active');
		expect(takePendingAction('r1', 'u1', 2000)).to.be.undefined;
	});

	it('is scoped per room+user', () => {
		parkPendingAction(BASE, 1000);
		expect(takePendingAction('r1', 'OTHER', 2000)).to.be.undefined;
		expect(takePendingAction('OTHER', 'u1', 2000)).to.be.undefined;
		clearPendingAction('r1', 'u1');
	});

	it('expires after the TTL', () => {
		parkPendingAction(BASE, 1000);
		const afterTtl = 1000 + 5 * 60 * 1000 + 1;
		expect(hasPendingAction('r1', 'u1', afterTtl)).to.be.false;
		expect(takePendingAction('r1', 'u1', afterTtl)).to.be.undefined;
	});

	it('clear drops a parked action', () => {
		parkPendingAction(BASE, 1000);
		clearPendingAction('r1', 'u1');
		expect(takePendingAction('r1', 'u1', 1001)).to.be.undefined;
	});
});
