import './appcache';
import './callbacks';
import { startCronJobs } from './cron';
import { ensureMessagesTextIndex } from './ensureMessagesTextIndex';
import './initialData';
import './serverRunning';
import './coreApps';
import { generateFederationKeys } from './generateKeys';
// MATTERCHAT: MIT presence Meteor wiring (EE removal plan step 3b) — marks users online/offline
import './presence';
import './presenceTroubleshoot';
import '../hooks';
import '../lib/rooms/roomTypes';
import '../lib/settingsRegenerator';
import { performMigrationProcedure } from './migrations';
import { isRunningMs } from '../lib/isRunningMs';

export const startup = async () => {
	await performMigrationProcedure();

	await generateFederationKeys();

	setImmediate(() => startCronJobs());
	setImmediate(() => ensureMessagesTextIndex());
	// only starts network broker if running in micro services mode
	if (!isRunningMs()) {
		require('./localServices');
	}
};
