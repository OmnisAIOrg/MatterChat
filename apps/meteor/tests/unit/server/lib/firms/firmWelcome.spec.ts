import { expect } from 'chai';
import { describe, it } from 'mocha';

import { renderWelcome } from '../../../../../server/lib/firms/firmWelcomeText';

const channels = [
	{ slug: 'general', display: 'General', topic: 'Firm-wide announcements.' },
	{ slug: 'intake', display: 'Intake', topic: 'New enquiries.' },
];

describe('firmWelcome', () => {
	it('greets the owner by name when we know it', () => {
		expect(renderWelcome('Smith & Co', channels, 'jane')).to.contain('Welcome to **Smith & Co**, @jane.');
	});

	it('greets the firm alone when the username is unknown', () => {
		const text = renderWelcome('Smith & Co', channels);
		expect(text).to.contain('Welcome to **Smith & Co**.');
		expect(text).to.not.contain('@undefined');
	});

	it('states what was built, with each channel and its purpose', () => {
		const text = renderWelcome('Smith & Co', channels, 'jane');
		expect(text).to.contain('I set up 2 channels');
		expect(text).to.contain('**General** — Firm-wide announcements.');
		expect(text).to.contain('**Intake** — New enquiries.');
	});

	it('uses the singular for one channel', () => {
		expect(renderWelcome('Solo', [channels[0]], 'jo')).to.contain('I set up 1 channel to match');
	});

	it('omits the channel section entirely when nothing was seeded', () => {
		// Seeding is best-effort; claiming channels exist when they do not is
		// worse than staying quiet about it.
		const text = renderWelcome('Solo', [], 'jo');
		expect(text).to.not.contain('I set up');
		expect(text).to.contain('Welcome to **Solo**');
	});

	it('tells the owner what they can ask for next', () => {
		const text = renderWelcome('Smith & Co', channels, 'jane');
		expect(text).to.contain('invite');
		expect(text).to.contain('catch me up');
	});

	it('says the channels are ordinary and can be changed', () => {
		expect(renderWelcome('Smith & Co', channels, 'jane')).to.contain('rename or delete');
	});
});
