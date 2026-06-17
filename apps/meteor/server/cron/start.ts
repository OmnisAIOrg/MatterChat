import { cronJobs } from '@rocket.chat/cron';
import { MongoInternals } from 'meteor/mongo';

import { boardsMattersCron } from './boardsMattersCron';

export const startCron = async () => {
	const started = await cronJobs.start((MongoInternals.defaultRemoteCollectionDriver().mongo as any).client.db());
	// Boards/Matters depth (M5): SOL watch + deadline reminders + stuck-matter sweep.
	// Registered after the scheduler is started so `cronJobs.add` has a live driver.
	await boardsMattersCron();
	return started;
};
