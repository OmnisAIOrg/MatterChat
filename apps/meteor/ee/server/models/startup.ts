import { License } from '@rocket.chat/license';

// To facilitate our lives with the stream
// Collection will be registered on CE too
// No functionality will be imported tho, just the service registration
import('./OmnichannelServiceLevelAgreements');
import('./AuditLog');
// MatterChat: IReadReceiptsModel is registered by the MIT core (apps/meteor/server/models.ts)
// with the core ReadReceiptsRaw — do not overwrite it with the ee model.
import('./ReadReceiptsArchive');

void License.onLicense('livechat-enterprise', () => {
	import('./CannedResponse');
	import('./LivechatTag');
	import('./LivechatUnit');
	import('./LivechatUnitMonitors');
	import('./LivechatRooms');
	import('./LivechatInquiry');
	import('./LivechatDepartment');
	import('./Users');
	import('./LivechatDepartmentAgents');
});
