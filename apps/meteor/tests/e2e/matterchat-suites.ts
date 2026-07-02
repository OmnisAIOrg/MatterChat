/**
 * MatterChat curated e2e suites (single source of truth).
 *
 * Consumed by `apps/meteor/playwright.matterchat.config.ts`, which defines two projects:
 *   - `mit-core` — every upstream spec that is valid on our MIT (Community Edition) fork.
 *   - `smoke`    — a small, fast pre-merge tier run on every PR to `staging`.
 *
 * Run with:
 *   yarn test:e2e --config=playwright.matterchat.config.ts --project=smoke
 *   yarn test:e2e --config=playwright.matterchat.config.ts --project=mit-core
 *
 * WHY EXCLUDE INSTEAD OF DELETE: these specs are upstream Rocket.Chat code. Deleting them
 * would create permanent merge conflicts with upstream. They stay on disk; we just don't
 * schedule them.
 */

/**
 * Specs that are ENTIRELY Enterprise-Edition-gated: every top-level describe starts with
 * `test.skip(!IS_EE, ...)`. We ship the MIT core without an EE license, so 100% of the tests
 * in these files self-skip. Excluding the files saves scheduling/transpile time and keeps
 * reports honest (no wall of "skipped").
 *
 * Specs with only PARTIAL EE coverage (e.g. administration.spec.ts, homepage.spec.ts,
 * omnichannel-agents.spec.ts) are intentionally NOT listed here — their CE tests still run
 * and their EE tests self-skip via the built-in `IS_EE` guard (we never set IS_EE=true).
 */
export const EE_ONLY_SPECS = [
	// device management is an EE feature
	'account-manage-devices.spec.ts',
	'admin-device-management.spec.ts',
	// marketplace/private apps require a license with app subscriptions
	'apps/apps-contextualbar.spec.ts',
	'apps/apps-modal.spec.ts',
	'apps/uikit-interactions.spec.ts',
	// "enforce 2FA for a role" is EE
	'enforce-2FA.spec.ts',
	// read receipts are EE
	'read-receipts.spec.ts',
	'read-receipts-thread.spec.ts',
	'read-receipts-deactivated-users.spec.ts',
	// video conference + internal voice calls are Premium/EE
	'video-conference.spec.ts',
	'video-conference-ring.spec.ts',
	'voice-calls-ee.spec.ts',
	// omnichannel EE features (tags/units/priorities/SLAs/monitors/canned responses/etc.)
	'omnichannel/omnichannel-assign-room-tags.spec.ts',
	'omnichannel/omnichannel-auto-onhold-chat-closing.spec.ts',
	'omnichannel/omnichannel-auto-transfer-unanswered-chat.spec.ts',
	'omnichannel/omnichannel-business-hours.spec.ts',
	'omnichannel/omnichannel-canned-responses-sidebar.spec.ts',
	'omnichannel/omnichannel-canned-responses-usage.spec.ts',
	'omnichannel/omnichannel-changing-room-priority-and-sla.spec.ts',
	'omnichannel/omnichannel-contact-unknown-callout.spec.ts',
	'omnichannel/omnichannel-departaments.spec.ts',
	'omnichannel/omnichannel-livechat-agent-idle-setting.spec.ts',
	'omnichannel/omnichannel-livechat-department.spec.ts',
	'omnichannel/omnichannel-livechat-queue-management.spec.ts',
	'omnichannel/omnichannel-livechat-queue-management-autoselection.spec.ts',
	'omnichannel/omnichannel-livechat-read-receipts.spec.ts',
	'omnichannel/omnichannel-manager-role.spec.ts',
	'omnichannel/omnichannel-monitor-department.spec.ts',
	'omnichannel/omnichannel-monitor-role.spec.ts',
	'omnichannel/omnichannel-rooms-forward.spec.ts',
	'omnichannel/omnichannel-tags.spec.ts',
	'omnichannel/omnichannel-triggers-setDepartment.spec.ts',
	'omnichannel/omnichannel-units.spec.ts',
] as const;

/**
 * Specs excluded because they need infrastructure our gate does not boot (NOT because of EE):
 *   - saml.spec.ts spins up its own SAML IdP via `docker-compose` (tests/e2e/containers/saml)
 *     and drives users directly in Mongo. Heavy + flaky in a shared runner; revisit if we
 *     ever sell SAML.
 *   - federation/** needs a second homeserver + Matrix bridge (already ignored upstream via
 *     the base config's testIgnore; repeated here because Playwright projects override the
 *     top-level testIgnore).
 */
export const EXTERNAL_DEPENDENCY_SPECS = ['saml.spec.ts', 'federation/**'] as const;

/**
 * SMOKE tier — the fast pre-merge gate (~26 tests, 7 files, ≈8-12 min against a warm server).
 * Criteria: highest-value core flows a legal team hits daily, all CE, no flaky media/webrtc.
 *   - login.spec.ts                    (5)  auth: login, bad password, required fields
 *   - create-channel.spec.ts           (2)  channel + team creation via UI
 *   - create-direct.spec.ts            (1)  DM creation
 *   - messaging.spec.ts                (12) send/edit messages, attachments, keyboard nav, multi-context
 *   - global-search.spec.ts            (1)  message search
 *   - administration-settings.spec.ts  (4)  admin settings panel basics
 *   - admin-users.spec.ts              (1)  admin user management (pending users)
 * Message DELETE is covered by message-actions.spec.ts in the mit-core tier (21 tests was too
 * heavy for the smoke budget).
 */
export const SMOKE_SPECS = [
	'login.spec.ts',
	'create-channel.spec.ts',
	'create-direct.spec.ts',
	'messaging.spec.ts',
	'global-search.spec.ts',
	'administration-settings.spec.ts',
	'admin-users.spec.ts',
] as const;

/**
 * FORK tier — e2e coverage for the FORK's own features (Boards, Forms, legal hold, matter link,
 * read receipts, OIDC), the "next tier" the gate's author + reviewer flagged as missing. These
 * live under `tests/e2e/matterchat/` and every top-level describe is tagged `@matterchat` (grep
 * with `--grep @matterchat`). Unlike the upstream specs these are OURS, so — no upstream merge
 * conflicts — they can be deleted/renamed freely.
 *
 * Setup is API-seeded via the `boards.*` / `rooms.*` REST surface (fixtures/boards-api.ts); the
 * UI is driven only for the assertion itself. Robustness notes:
 *   - boards.spec.ts        (5)  create/render board, add card (UI), move card (API contract), drawer
 *   - boards-pagination.spec.ts (1) >100 cards all render (page-1 truncation regression)
 *   - forms.spec.ts         (1)  logged-out public /form/<slug> submit → card on target list
 *   - legal-hold.spec.ts    (1)  hold refuses rooms.cleanHistory; clear re-allows it
 *   - matter-link.spec.ts   (1)  matter-linked channel groups under the "Matters" sidebar section
 *                                (self-skips if the matters chain is unavailable on a bare CE gate)
 *   - read-receipts.spec.ts (3)  1 EE-only receipt indicator (@skip !IS_EE), 2 CE-valid (menu-off, settings API)
 *   - oidc-login.spec.ts    (4)  2 @skip (need mock IdP + OMNISAI_OIDC_* env), 2 CE gating checks
 */
export const FORK_SPECS = [
	'matterchat/boards.spec.ts',
	'matterchat/boards-pagination.spec.ts',
	'matterchat/forms.spec.ts',
	'matterchat/legal-hold.spec.ts',
	'matterchat/matter-link.spec.ts',
	'matterchat/read-receipts.spec.ts',
	'matterchat/oidc-login.spec.ts',
] as const;

/**
 * The 3-4 most stable fork specs, promoted into the SMOKE tier (all API-seeded, all CE-valid,
 * no EE/IdP/drag dependency): boards render+add+move+drawer, the pagination regression, and the
 * public-form intake. Legal hold is API-only (fast + deterministic) so it rides along too.
 */
export const FORK_SMOKE_SPECS = ['matterchat/boards.spec.ts', 'matterchat/boards-pagination.spec.ts', 'matterchat/forms.spec.ts', 'matterchat/legal-hold.spec.ts'] as const;
