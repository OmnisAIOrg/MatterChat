/**
 * SMS Bridge Module — exports for the CasePro SMS integration.
 *
 * This is the public interface for the SMS bridge. All SMS operations
 * go through these exports.
 */

export {
	// Core bridge class and singleton
	SMSBridge,
	getSMSBridge,
	// Types
	type CaseProSMSThread,
	type CaseProSMSMessage,
	type SMSSyncEvent,
	type SMSPullResult,
	type SMSPullOpts,
	type SMSIngestMessage,
} from './sms-bridge';

export {
	// Sync operations
	syncSMSRoomMessages,
	syncAllSMSMessages,
	ingestSMSMessage,
} from './sms-sync';

export {
	// Scheduler lifecycle
	startSMSSyncScheduler,
	stopSMSSyncScheduler,
	initSMSSyncScheduler,
} from './sms-scheduler';
