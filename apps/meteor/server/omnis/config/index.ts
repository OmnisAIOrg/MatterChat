/**
 * MATTERCHAT: startup configuration fixes.
 *
 * Imported from server/importPackages.ts (alongside ./omnis/email). Applies known-good
 * corrections to live settings at boot — each one conditional, idempotent, and admin-safe
 * (see matterchatConfigFixes.ts for the per-fix semantics). This exists because several
 * production settings were found misconfigured during the 2026-07-30 org-readiness audit
 * (OIDC signups blocked, stock ToS/Privacy placeholders, malformed CasePro URL, no usable
 * 2FA method) and settings-by-env requires an ops-repo deploy while these ship with the app.
 */
import { applyMatterChatConfigFixes } from './matterchatConfigFixes';

applyMatterChatConfigFixes();
