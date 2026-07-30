/**
 * MATTERCHAT: New-user onboarding email wiring.
 *
 * Imported from server/importPackages.ts (alongside the other MatterChat server modules) so it loads
 * during server boot. Runs the one-time email de-branding at startup and exposes the welcome-email
 * sender used by server/methods/registerUser.ts.
 */
import { applyMatterChatEmailTheme } from './matterchatEmailBranding';

export { sendMatterChatWelcomeEmail } from './matterchatWelcomeEmail';

applyMatterChatEmailTheme();
