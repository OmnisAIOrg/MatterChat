import './models/startup';
import '../app/license/server';
import '../app/api-enterprise/server/index';
import '../app/authorization/server/index';
import '../app/canned-responses/server/index';
import '../app/livechat-enterprise/server/index';
// MatterChat: enterprise message-read-receipt is replaced by the MIT core implementation
// (see apps/meteor/server/lib/message-read-receipt/) — do not load the ee module.
import './api';
import '../app/settings/server/index';
import './requestSeatsRoute';
import './configuration/index';
import './local-services/ldap/service';
// MatterChat: getReadReceipts is provided by the MIT core method (server/methods/getReadReceipts).
import './patches';
import './hooks/federation';

export * from './apps/startup';
export { registerEEBroker } from './startup';
