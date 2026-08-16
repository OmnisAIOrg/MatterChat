import '../lib/message-read-receipt/hooks';
// CasePro comms-log: matter-linked channels auto-log their messages onto the
// matter's communication history (batched, cursor-resumed, per-channel toggle).
import '../lib/caseProCommsLog';
// CasePro auto-sync on login: trigger background matters+leads sync on user login.
import '../lib/boards/casepro/loginSync';
// MATTERCHAT: Omnis product widgets — AutoDoc feed poller + auto-process hook,
// CaseNotes meeting poller, OmnisProof document-type seed. All no-ops when the
// respective product is disabled.
import '../lib/omnis/startup';
// MATTERCHAT: stamp brand-new accounts as needing firm setup (self-serve firms).
import '../lib/firms/startup';
// MATTERCHAT: Chi "Ask Anything" — keep the passage index current as messages arrive
// (O(1) listener + a ticker; a complete no-op with no embedding provider configured).
import '../lib/chi/search/startup';
import './sauMonitorHooks';
import './userLogoutCleanUp';
