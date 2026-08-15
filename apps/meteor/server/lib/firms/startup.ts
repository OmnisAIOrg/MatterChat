import { registerFirmDomainAutoJoin } from './firmDomainLogin';
import { registerFirmOnboarding } from './firmsOnboarding';

/**
 * MATTERCHAT: self-serve firms boot. Side-effecting on import, registered from
 * `server/hooks/index.ts`.
 *
 * The callback itself re-reads `Firms_SelfServe_Enabled` on every invocation,
 * so registering unconditionally lets an admin turn self-serve firms on without
 * a restart — and costs one boolean check per account creation when it is off.
 */
registerFirmOnboarding();

/**
 * Email-domain auto-join, on the same terms: the callback re-reads
 * `Firms_Domain_AutoJoin_Enabled` on every login, so it can be switched on
 * without a restart and costs one boolean check per login when it is off.
 */
registerFirmDomainAutoJoin();
