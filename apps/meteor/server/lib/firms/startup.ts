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
