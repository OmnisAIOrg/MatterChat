# HANDOFF — 2026-08-16 (Programme wired live + a production HTTP/2 incident)

Branch `feature/omnis-widgets`, commit `9e2f28492a` on top of the eleven from 08-14/15.
Nothing pushed. Spec: `docs/superpowers/specs/2026-08-14-matterchat-easiest-org-comms-design.md`.

## ⚠️ TWO CLAUDE SESSIONS WERE EDITING THIS CHECKOUT AT ONCE

At 14:35 today another session switched this working tree off `feature/omnis-widgets`,
created `hotfix/http2-content-length`, committed `82005d2ee3`, and ran `git reset` twice —
which silently reverted two of this session's edits mid-flight and made `ls`/`find` disagree
with `git status`. Nothing was lost (82005d2ee3's content is inside `9e2f28492a`), but the
lesson is cheap to state and expensive to relearn:

**Before a long session, check `ps aux | grep claude` and `git reflog`. If another agent has
this checkout, work in a `git worktree`, not in the shared tree.**

A dangling `82005d2ee3` and the branch `hotfix/http2-content-length` are leftovers from that
session; both are superseded and safe to delete.

## PRODUCTION INCIDENT — the theme stylesheet never delivered over HTTP/2

**Symptom:** MatterChat intermittently hangs on the loading splash. The site is *up* —
`/api/info` healthy, every bundle 200 — but `css-theme_<hash>.css` returns **0 bytes and hangs
for the full timeout over HTTP/2**, while HTTP/1.1 serves its 512 bytes instantly. It is a
render-blocking `<link>` in `<head>`, so the browser stalls on a stylesheet that never comes.

**Cause:** `Content-Length: content.length` — UTF-16 code units — with the body written as
UTF-8. The brand CSS opens `/* MatterChat — OmnisAI house brand (GREEN) */`; that em dash is
1 character and 3 bytes, so the response declared 510 and sent 512. HTTP/1.1 tolerates the
mismatch, HTTP/2 enforces it and resets the stream.

**Why it survived review:** it is *correct for pure ASCII*, it **cannot reproduce against a
local dev server** (HTTP/1.1 only), and `curl` hides it unless you pass `--http2`.

**Reproduction** (kept at `scratchpad/repro-h2.mjs`; serves the real production bytes over a
real HTTP/2 connection):

    BROKEN (content.length)      declared=510  ->  STREAM ERROR after 0 bytes
    FIXED  (Buffer.byteLength)   declared=512  ->  delivered 512 bytes

**Fixed** in PR #194 → `staging`, MERGED as `42a2b91b`. Both affected handlers now go through
one tested helper, `textResponse()`. NOTE THE PATHS DIFFER BY BRANCH: on `staging` they are
`app/ui-master/server/inject.ts` + `app/theme/server/server.ts`; on `feature/omnis-widgets`
they are `server/lib/ui-master/inject.ts` + `server/settings/theme/server.ts`. The feature
branch carries its own copy of the fix, so the two will not conflict.

**Verify after any deploy** — this is the whole test, and it must be `--http2`:

    curl -sS --http2 -o /dev/null -w "%{size_download}\n" --max-time 20 \
      https://matterchat.stg-omnisai.io/css-theme_a4ea65289607c99271e96a51cdd478eb50fb63b8.css

Pre-fix that printed `0` after a 20 s hang on BOTH staging and production. Post-fix it must
print the full byte count promptly.

## What shipped in `9e2f28492a`

- **F9 is live.** `CHI_SEARCH_TOOLS` spread into `ws-tools.ts`; `createChiSearchSettings()`
  registered; a new `afterSaveMessage` hook (`server/lib/chi/search/startup.ts`) keeps the
  index current through a dirty-room queue — O(1) on the hot path, ticker-flushed, bounded per
  tick, fair-ordered oldest-dirty-first, backed off on failure, and capped so a busy workspace
  cannot grow the map without limit. A bounded cron (`chiSearchIndexCron.ts`) backfills history
  the hook can never see; without it the index is empty on the day search is switched on.
- **F9 also indexes files** by filename/description, so "did anyone send the deposition
  transcript?" is answerable; deleted and `_hidden` messages are unindexed, because a legal
  retrieval system must not quote something somebody deleted.
- **F5 is hooked into delivery** — one early return in `sendNotification` covering desktop,
  push and email, plus two projected fields. It is deliberately NARROWER than the engine's
  baseline: the overlay only acts when a rule ACTUALLY matched, so a user with no rules is
  unaffected and one narrow rule cannot cost them notifications everywhere else. Quiet-by-
  default is expressible via the new `everything` condition, which any real condition beats.
  `silence` is now filtered out of Catch Me Up and the morning brief too.
- **Spec gaps closed:** F4's channel-header entry point (new `chi.catchup` route, needs no LLM
  configured); F7 channel export (reuses core's export machinery but returns a link, because
  staging has no SMTP and Chi is a chat); F2's QR now ends the setup concierge.

~150 new specs. Typecheck **739**, two below the 741 baseline, zero errors in touched files.
Client jest: the same five pre-existing suites fail, nothing new.

## VERIFIED AGAINST A LIVE SERVER — and it found two real bugs

A dev server was booted from a worktree at `9e2f28492a` and driven through
`scratchpad/verify.mjs` + `verify2.mjs`. **Green:** boot; all 7 new settings registered with
correct defaults; all three fork-owned collections created their indexes (including the new
`messageIds_1`); `firms.create` with practice areas seeding 7 channels; owner stamped with BOTH
`customFields.firmId` and `firmRole=owner`; invite create/list/revoke; the invite URL on our own
host rather than `go.rocket.chat`; gmail.com refused as a public provider; domain claim written
with a token, listed, and `/firm-domain/verify/:token` responding; `chi.catchup` returning real
content with working `?msg=` jump links and refusing a room the caller is not in; and the
reminders cron firing a DM plus staying silent on a follow-up whose condition was met.

**Two bugs that only a live run could have found, both now fixed:**

1. **Chi reminders stopped firing after any restart.** `cronJobs.has()` asks Agenda, whose job
   records live in MONGO and survive restarts; `cronJobs.add()` is what calls `define()`, which
   registers the callback IN THIS PROCESS. `chiRemindersCron` did `if (has) return`, so after
   the first ever boot every later pod had a scheduled job with no handler attached. Reminders
   fired once on a fresh database and then never again, silently. Now remove-then-add. It was
   the ONLY cron with that shape — the morning brief already re-added via its schedule sync.
2. **Conditional follow-ups recorded the wrong outcome.** `claimDue` stamps `resolution:'fired'`
   as part of its atomic claim, and `resolve()` guards on `resolvedAt: {$exists:false}` — which
   the claim has just filled in. So a `no-reply` reminder that correctly stayed silent was still
   recorded as "fired". Behaviour was right, the audit trail lied. New `ChiReminders.reclassify`
   corrects a just-claimed row and cannot touch one genuinely delivered earlier.

**Still not exercised live:** the F5 triage suppression could not be proven either way — with
`Troubleshoot_Disable_Notifications` off and a receiver set to `all`, the notification queue
stayed empty in every case including the controls, so "suppressed" and "never queued" are
indistinguishable in that harness. The unit specs cover the decision; the delivery wiring needs
a better probe (watch the DDP stream, or assert on `sendNotification` directly). Also unexercised:
the embedding/search index end to end (needs a provider), and APNs (needs a device).

## HARNESS NOTES (both traps cost time)

This remains the programme's open risk, unchanged from 08-14. The crons, the three Mongo-backed
stores and every REST route are compiled and unit-tested but have never touched a database.
`ChiReminders.claimDue` matches `resolvedAt: { $exists: false }` — inserting a fixture with an
explicit `resolvedAt: null` means it is NEVER claimed. That cost a false "the cron is broken".

**Running a dev server from a git worktree needs four things linked from the main checkout**,
because they are build artifacts that git does not track and Meteor dies on each in turn:

    node_modules (root, apps/meteor, packages/*/)
    apps/meteor/packages/rocketchat-i18n/i18n
    packages/*/dist                       (54 of them)
    apps/meteor/public/livechat           (careful: `ln -sfn` into an existing dir nests it)

# HANDOFF — 2026-08-14 (Easiest-org-comms programme: 9 features, Phases 1–3)

Branch `feature/omnis-widgets`. Spec: `docs/superpowers/specs/2026-08-14-matterchat-easiest-org-comms-design.md`.
Read that first — it states the tenancy assumption every feature is built on.

**Local toolchain now works, which it did not before.** Previous sessions could not
install dependencies. The blocker was the `~/.npmrc` token lacking `read:packages`; the
`gh` CLI token has it. Setup lives in `~/Desktop/matterchat-work/`: `env.sh` (node
**exactly 22.22.3** — the yarn engines plugin rejects anything else — plus `NPM_TOKEN=$(gh
auth token)`), `t.sh` (isolated mocha; the repo `.mocharc.js` otherwise loads every spec
in the repo and dies), `j.sh` (client jest), `tc.sh` (typecheck).
Also needed: `deno` on PATH (the `@rocket.chat/apps` build shells out to it), and
`--experimental-require-module` in NODE_OPTIONS for jest to load its ESM preset.

**Typecheck baseline is 741 pre-existing errors** — measured AFTER `yarn turbo run build`
for the workspace packages. Without that build it reads ~10,400, almost all "cannot find
module @rocket.chat/models", which is not real debt. `tc.sh` refuses to print a count if
tsc OOMs, because **an OOM otherwise looks exactly like "0 errors"** — that false green
cost time this session. tsc needs ~7 GB; do not run several at once on a 16 GB machine.

**What shipped (all committed, none pushed):**
- **F1 setup concierge** — practice-area channel templates (`firmTemplates.ts`, data not
  code), a 3-step wizard, and Chi posting what it built. Plus the two structural fixes
  from the July audit: `ensureFirmForOrg` now stamps `firmRole`, and roster mirroring is
  authorized by firm ownership rather than the workspace-admin role, which is what
  unblocks every org after the first.
- **F2 zero-friction join** — email-verified domain auto-join, invite expiry/caps/
  revocation, and the `go.rocket.chat` de-branding fix.
- **F3 push** — token-based (.p8) APNs alongside certificate auth.
- **F4 Catch Me Up** — `unread_digest` returns message CONTENT with jump links (the
  existing `catch_me_up` returns counts only); opt-in morning-brief DM cron.
- **F5 notification triage** — rules engine + storage + tools. **NOT hooked into message
  delivery yet** — that is the one deliberate gap; hook point is in DECISIONS.md.
- **F6 reminders** — including follow-ups that cancel themselves when someone replies.
- **F7 firm administration** — for owners, who are not workspace admins.
- **F8 Firm Console / F9 Ask Anything** — see the session tail; landing at time of writing.

**Verification actually performed:** ~340 unit specs (mocha for server-pure logic, jest +
testing-library driving real DOM controls for the wizard), typecheck at or below the 741
baseline with zero errors in touched files. **A full Meteor boot was NOT part of the
green** — no end-to-end run against a live server, no staging deploy. Treat the cron jobs,
the Mongo-backed stores (`chi_reminders`, `matterchat_firm_domains`, the search index) and
every REST route as compiled-and-unit-tested but not yet exercised against a database.

**Two live footguns found and fixed** (both would have been silent): `chi.prefs` replaced
the whole `settings.chi` object, wiping the morning-brief opt-in and all notification
rules whenever the orb saved a model override; and the "canonical" invite URL routes a
firm's invitees through rocket.chat under stock defaults.

# HANDOFF — 2026-07-30 (Onboarding emails + org-readiness audit + firm-leak closures + PURE-MIT EE REMOVAL)

Four workstreams, all merged to `staging` today. Read this top-to-bottom before touching anything — the EE removal changes the fork's foundations.

1. **Onboarding emails (PR #163, merged + deployed to staging).** Branded welcome email for self-signups (settings under Admin → Email → MatterChat Onboarding), full visual redesign of ALL account emails (`server/omnis/email/theme.ts`, `mc-email-theme-v1`: forest→emerald gradient header + ensō + rounded card; idempotent startup applier `matterchatEmailBranding.ts` respects admin-customised values), verification-email failures now logged (were an empty catch), reset-password page shows "Password changed successfully", forgot-password hard failures show an error toast. NOTE: staging has NO SMTP (emails render but don't send there); prod SMTP is wired via GH-Actions secrets → `matterchat-feature-secrets` (see `docs/SMTP-WIRING-RUNBOOK.md`, though its office365 host claim is stale — DNS says Google Workspace).

2. **Org-readiness audit (7-agent, 2026-07-30) — the decisions.** Tenancy answer: today ONE shared workspace per env; per-org URLs = design-only (`docs/design/MATTERCHAT-MULTIWORKSPACE-SPIKE.md`). **FOUNDER DECISION: Path B — one instance per firm at `<firm>.matterchat.com` — is the destination; shared-workspace self-serve firms stays as the trial tier.** Live-config traps found (verify before onboarding anyone): prod has `Firms_SelfServe_Enabled=true` but staging doesn't (QA can't exercise the live flow); prod `Accounts_Registration_AuthenticationServices_Enabled=false` BLOCKS new-user creation via "Sign in with OmnisAI" (almost certainly accidental); prod ToS/Privacy are stock RC placeholders; `CasePro_Web_URL` has a leading space; org auto-provision (`orgProvision.ts`) only fires for a workspace ADMIN → **org #2's roster can never mirror** (structural; fix = per-ORG provisioned marker + org-admin claim trigger); OIDC users get no `customFields.firmId` (the two org models are unlinked). Ops truths (from MatterChat-New audit): **prod is NOT ArgoCD/GitOps** (manual `kubectl apply` workflow; only staging is ArgoCD, synced from the `staging` BRANCH of MatterChat-New); prod+staging share one EKS cluster; prod Mongo = in-cluster 3-member rs0 with **NO AUTH** and a **single-host seed list** (HA defect — RCA requires all 3 hosts); **Mongo no-auth + shared oplog is THE blocker for Path B isolation** — enable auth + per-firm users before customer #2. Factory design (agreed, not built): ArgoCD ApplicationSet + Helm chart `kubernetes/charts/matterchat-firm/` + one values file per firm; needs wildcard ACM cert + wildcard DNS (GoDaddy, external-dns currently disabled) + parameterized `register-oidc-client.yml` (redirect URIs hardcoded to app.matterchat.com).

3. **Cross-firm leak closures (PR #166, merged).** Firm scoping only covered users.list/directory/spotlight; closed the rest: `users.autocomplete` (was enumerating ALL active users — powers DM/mention pickers), `users.info` (cross-firm probe → same "User not found."), `users.presence` (was returning every online user), `createDirectMessage` (cross-firm DMs now refused), Firm Feed (entries carry optional `firmId`, stamped on create, scoped on list; absent = workspace-wide/legacy). All reuse `getFirmScopeExtraQuery`/`userMatchesFirmScope`; no-op when firms off or caller is admin. NOT covered (deliberate follow-up): public channels/teams still enumerable cross-firm via spotlight room search / channels.list — needs a product decision.

4. **PURE-MIT EE REMOVAL (PR #168, merged — THE BIG ONE).** Both Enterprise trees (`apps/meteor/ee/`, `ee/`) are DELETED; the fork is now MIT + our own code. **The air-gapped countdown (was ~9 days from read-only) is dead** — the only code that threw `restricted-workspace` was an EE boot patch. Full plan + adversarial review in `docs/design/MATTERCHAT-EE-REMOVAL-PLAN.md`. Clean-room MIT replacements: `packages/presence` (full IPresence, service name 'presence', reaper, wiring in `server/startup/presence.ts` — without this everyone shows permanently offline), `packages/license` (permanent-CE, SAME npm name so 16 import sites unchanged), `packages/media-calls` (dormant stub, calls fail cleanly), `server/models/raw/ReadReceiptsArchive.ts` + `server/cron/readReceiptsArchive.ts` (read receipts ARE used), 7 rescued settings (VideoConf_Enable_* family + Calendar_BusyStatus_Enabled in `settings/video-conference.ts` + new `settings/outlook-calendar.ts`), MIT `v1/licenses.ts` route + `api/server/middlewares/license.ts`, `lib/misc/{Utilities,determineFileType}.ts`. Key rewires: boot flip (`main.ts`/`startRocketChat.ts`), migrations v294/v307 return instead of throw without Apps orchestrator (**fresh DBs would have crashed — matters for every future per-firm instance**), `getServerInfo` workspaceUrl/hashedWorkspaceUrl from `Site_Url`, QueueManager/canned-response local no-ops, ci.yml EE jobs removed. **VERIFY ON STAGING (next session if the deploy finished): register test user → send message (restriction gone) → `users.presence` shows the user online (presence port = the one real runtime risk) → `/api/info` has workspaceUrl → admin has no air-gap banner.** Deploy run 30588943145 was in progress at session end.

**NEXT TASKS (priority order):** (a) verify #168 on staging as above, then founder decides prod promote (`matterchat-kubernetes-production-deploy.yaml`, manual); (b) config-fix startup module: flip prod `Accounts_Registration_AuthenticationServices_Enabled`, trim `CasePro_Web_URL`, real ToS/Privacy, enable TOTP; (c) org provisioning: stamp `customFields.firmId` from `services.omnisai.orgId`, per-ORG provisioned marker, org-admin trigger (kills the org-#2 dead-end); (d) firm invite links: finite maxUses + shorter expiry (now 15-day unlimited); (e) Path B: Mongo auth first, then the ApplicationSet/Helm factory in MatterChat-New (PRs only — ArgoCD selfHeal+prune owns staging), then CentralizedAuth org-picker (org→instance registry + post-login routing; repos never audited — scope first). PR #167 (plan-doc-only) is superseded by #168 — close it.

---

# HANDOFF — 2026-07-24 (Standalone-Chi auth bridge: chi.session-exchange + Chi-Desktop OmnisAI OAuth client mode)

**Branch `feat/chi-session-exchange` (PR #162 → staging):** the CentralizedAuth→MatterChat auth bridge + the Chi-Desktop side (Chi-Desktop@main, shipped).

1. **BE bridge** — `POST /v1/chi.session-exchange` (in `app/api/server/v1/chi.ts`; verification core `server/lib/chi/sessionExchange.ts`, Meteor-free + 25 mocha specs). HARD verification (JWS lane: EdDSA/RS256/ES256 vs issuer JWKS, iss REQUIRED, aud vs `Chi_Session_Exchange_Client_Ids` allowlist; opaque/HS* lane: live introspection at `${issuer}/api/auth/mcp/get-session`; `alg:none` terminal). Identity via the now-EXPORTED `resolveOmnisaiUser` (loginHandler refactor — same mapping web login uses). Mint = `users.createToken` internals with `when` backdated → ~30-day effective expiry, revocable. Gated `Chi_Session_Exchange_Enabled` (default OFF) + rate-limited 10/min + `postAuditEntry` line per mint.
2. **Chi-Desktop client mode** (Chi-Desktop repo, main) — `omnisAuth.js` (PKCE, self-serve DCR, system browser, `chi://` + loopback `127.0.0.1:44145` fallback, safeStorage vault, refresh ROTATION) + `matterchat.js` (exchange → `{userId,authToken}`; chi.ask routing w/ needsConfirm passthrough + actions→browser/deep-link; DDP `stream-notify-user <uid>/notification` → orb cards; reply via chat.postMessage; Sign out revokes both). Orb Connections row = live account row (LED / Connect OmnisAI account / Sign out) via the new `orb.omnis` host hook — chi-orb.js synced BOTH repos, OMNIS_WIDGET_VERSION 14, chi-window ?v=19.
3. **The CURRENT auth link (founder-confirmed, verified live):** the public issuer is **`https://sso-app.omnisai.io`** (RFC 8414 discovery + JWKS live; authorize 302s to the login page `sso.omnisai.io/auth/login`). `auth-app.omnisai.io` is VPC-internal and TIMES OUT from user machines — the first cut defaulted to it; fixed everywhere (desktop `omnisIssuer` default, bridge fallback, new `Chi_Session_Exchange_Issuer` override setting because staging web-SSO points at internal staging auth while desktops reach only the public issuer). Introspection verified against the LIVE issuer: invalid bearer → `200 null` → bridge rejects (fail-closed).
4. **To finish QA (founder):** (a) flip `Chi_Session_Exchange_Enabled` ON on staging (Admin → Chi Assistant); (b) click "Connect OmnisAI account" in Chi-Desktop and log in at sso.omnisai.io — first click self-serve-registers the desktop OAuth client via the same open DCR DepoLink uses (or pin a pre-registered `omnisClientId` in config); (c) optionally pin that client id in `Chi_Session_Exchange_Client_Ids`. CI: my one new TS error fixed; remaining failures = the known fork-wide debt (boards types, license spec, E2E /api/apps flake).

---

# HANDOFF — 2026-07-21 PM (Teams/GChat inbound parity + Chi caller-scoping + user-pref tools + per-provider bridge sections)

**Branch `feat/external-unread-dots` (continuing past merged PR #136), four workstreams in one package:**
1. **Chi caller-scoped permissions** — tools now declare `access: 'admin' | 'user'`; EVERY user can DM @chi.bot (non-admins get ONLY the self-service tools + a scoped system prompt); `runTool` re-enforces per call; cross-user targets go through `resolveTargetUser`, which reuses the EXACT admin-API permission ids (`edit-other-user-info` writes / `view-full-other-user-info` reads). SHIPPING RULE (in tools.ts header): no new tool without an `access` declaration + resolveTargetUser for cross-user targets. Audit-channel creation no longer seats a non-admin actor (audit.ts).
2. **Chi user-preference tools** — `get_user_preferences`, `set_user_notification_sound`, `bulk_set_user_notification_sound` (always-confirm, cap 1000, `all=true` supported). Writes go through core `saveUserPreferences` → the SAME field as Account → Notifications → Sound (`newMessageNotification`); sound names matched against stock ids + CustomSounds (helpers.matchSound — "Notification.wav" style accepted).
3. **Teams/GChat inbound parity** — new shared `app/connectors/server/bridge/inboundBrowse.ts` (`recordAndPushInbound` + `inboundChannelKindOf`); Teams webhook now writes `source:'inbound'` browse rows + fires the `external-inbound` push for owner+sharers (gated on anyInserted → Graph redeliveries are silent; author echo-suppressed); `backfillBridge` does the same for NEWLY-ingested recent messages on INCREMENTAL runs only (GChat's only inbound lane; Teams/Slack missed-window recovery; activation seeds never storm). Unread dots (rows + pills + rail badge) light up automatically — that pipeline was already provider-generic. Constraints that REMAIN (Graph/API ceilings + deploy config) documented in docs/KNOWN-ISSUES.md 🟠.
4. **Per-provider bridge sidebar sections** — bridged rooms now group under **Slack Bridges / Teams Bridges / Google Chat Bridges** (fixed order, member counts on the collapser) instead of blending into Channels/DMs. Plumbing: `room.customFields.connectorBridge` → `connectorBridge` on SubscriptionWithRoom (both cached stores + ui-contexts type) → useRoomList buckets woven above Channels. Also fixed a double-render of UnreadPill in ExternalSidebar channels rows.

Unit suites green: chi helpers 17, connectors 137, useRoomList 15. Verify loop = prod bundle on :3100.

---

# HANDOFF — 2026-07-21 (Slack arc: push + unread + BRIDGE-INBOUND root cause; Chi full admin; all → PR #136)

**PROD (app.matterchat.com) currently e20f48ea** = live-push v1 + Chi Admin Assistant with FULL settings surface (search/read/write any setting, connector_status; founder uses it with his key). **PR #136 (branch `feat/external-unread-dots`) is the complete next package, founder-approved to ship:** store-computed unread pills (channels+DMs, slack/teams/google) + refetch-storm fix + DM-scoped notifications + **the bridge-inbound fix** (impersonate + custom-fields — see docs/KNOWN-ISSUES.md §2 RESOLVED and CLAUDE.md gotchas; bridge/bridgeBot.ts is new) + docs/SLACK-CONNECT-GUIDE.md (user-facing onboarding; Chi serves it via the slack_setup_guide tool).

**Verification rigs (session scratchpad, rebuild-and-run then run):** `push-e2e.sh` (signed event → DDP frame w/ channelKind → browse store → unreadSummary 1→markRead→0; NOTE fake Slack ts MUST be current epoch or it falls outside the 14-day unread window) and `bridge-e2e.sh` (seeded bridged room + signed event → asserts the message IN the RC room). DDP listener: `ddp-listen.mjs`.

**Slack app config truth** (the half code can't fix): the four `message.*` events must be under **"Subscribe to events on behalf of users"** (bot events never cover personal DMs), Request URL `/_slack/events` verified, redirect `/_slack/oauth/callback`, and users must DISCONNECT/RECONNECT after any scope/event change. All spelled out in docs/SLACK-CONNECT-GUIDE.md.

**Deploy pipeline notes:** merge gate = `mergeable == MERGEABLE` (CodeQL fails repo-wide, non-required → UNSTABLE is normal); after any MatterChat-New manifest apply, re-promote the current SHA. Prod replicas MUST stay 1 until INSTANCE_IP wiring (see manifest comment).

---

# HANDOFF — 2026-07-20 (Chi Admin Assistant BUILT + live-verified on :3100)

**NEW FEATURE on branch `feature/chi-admin-assistant` (off `staging` @ b6b357d5): the Chi Admin Assistant** — admins DM `@chi.bot` in plain English and Chi EXECUTES admin work via an LLM tool-loop. All additive under `apps/meteor/server/lib/chi/admin/` (+ `server/settings/chi-assistant.ts`, i18n keys, 2 marked one-line registry imports in `importPackages.ts` + `settings/index.ts`). OFF by default.

**What it does:** users (create / bulk create ≤100 / roles / activate-deactivate / password reset), channels (create + add members), Slack provisioning (status/configure/connect-link), workspace_info, allowlisted settings read/write. Safety enforced IN CODE not prompt: every tool re-checks the SENDER's `admin` role (non-admins refused, zero tools); destructive/bulk calls PARK until the admin types `confirm` (deterministic re-run); every executed action → private `#chi-admin-audit` channel (secrets masked); prompts/replies never logged.

**BYO-LLM** (Admin → Settings → Chi Assistant): provider dropdown Anthropic / OpenAI / **Cerebras** / **Groq** / **OpenRouter** / custom — endpoint baked in per provider (`admin/providers.ts`), just paste the matching key. Model field BLANK = provider default.

**Live-verified on :3100 with a real Anthropic key** (create user, list, deactivate→confirm→executed all green; audit + email-auto-verify confirmed; DB checked). 30 unit tests green (helpers/llm/confirm/providers).

**TWO BUGS found by live testing + fixed (both committed):**
1. `could not reach the model endpoint` — model transport used a DYNAMIC `import('@rocket.chat/server-fetch')` whose `serverFetch` named export is `undefined` under Meteor interop (works in plain Node — standalone curl passed while the server threw). Fixed: resolve fn across all interop shapes (named/default.named/default), mirroring the STATIC import in `boards/ai/provider.ts`. Catch now surfaces the REAL thrown message. **The same latent bug still exists in `server/lib/chi/client.ts` (the /chi relay) line ~55 — fix it the same way when that path is next touched.**
2. Confirm flow was NARRATED by the model, not executed (nothing parked → `confirm` found nothing). Fixed via system-prompt: MUST call the tool; platform auto-intercepts destructive/bulk calls for confirmation; never narrate a park you didn't create.

**COLD-START GOTCHA:** the FIRST model call right after boot can fail with node-fetch `reason: (empty)` (abort while Meteor finishes booting). Give the server ~8s after `SERVER RUNNING` before the first DM. Not a code bug.

**NEXT:** open draft PR `feature/chi-admin-assistant` → `staging` (founder-tests-before-merge). After promote, enable in Admin → Chi Assistant + paste key. Local test rig: `bash chi-e2e.sh` in the session scratchpad (mock LLM on :9333) OR real key via the DB setting. Local admin creds in `TEST-CREDS.md` (`e2e-test` / documented pw).

---

# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **"checkpoint matterchat" updates this before a session ends.** Decisions + reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-07-02 · **Branch:** `staging` (deploy is now BUILD-ONLY — ArgoCD owns the cluster; see below)

## 🔌 2026-07-02 — CasePro LIVE WIRE built (branch `auto/casepro-live-wire`, pushed, NOT merged/enabled)
The boards↔CasePro integration now has a real transport behind it (was stub-only). `McpGatewayTransport` speaks the deployed casepro-mcp-v2 gateway (JSON-RPC `tools/call` → `{base}/mcp/v2`; path verified live) with `X-MCP-API-Key` (env `CASEPRO_MCP_API_KEY` ONLY — never a setting) + `X-Organization-ID` (+ advisory `X-Acting-User` on writes). No key ⇒ refuses live, serves stub, loud boot warning + `GET boards.casepro.status` diagnostics (gated `boards-manage-casepro-settings`). SSRF hardened (https-only, single-host allow-list, no redirects). The 4 casepro permissions are now ENFORCED on `boards.casepro.*` / `syncFromCasePro` / `seedFromCasePro` / `convertToMatter` (+ migration v338 backfills partner/attorney). New 15-min `BoardsCaseProLeadsPull` cron (only when enabled + transport live + board exists). `CasePro_Web_URL` setting drives the "Open in CasePro" deep link (empty = hidden). Admin settings have real i18n labels now. Unit tests: `tests/unit/server/lib/boards/casepro/transport.spec.ts`. Docs: `docs/features/casepro-integration.md` (incl. the exact staging enablement env list — the MCP key must be provisioned on the CasePro side first). **Not enabled anywhere; envelope shapes need first-live-run verification.**
## 🤖 2026-07-02 — /chi CHI assistant in-channel (branch `auto/chi-assistant`, code-complete; go-live is deploy-time only)
`/chi <question>` in any channel asks the CHI agent (AI-Agents platform) about the channel's CasePro matter and posts the answer as a "Chi" bot user (immediate "Chi is thinking…" placeholder → edited in place with the answer or a friendly failure; ephemeral-only on usage/permission/not-configured misses; question/answer content never logged). New `server/lib/chi/` (config/context/client/bot/service) + `/chi` registration in `app/slashcommands-omnis/` + `chi-use` permission (seeded to admin/user/partner/attorney/paralegal). Config = env `CHI_API_URL`/`CHI_API_KEY`/`CHI_AGENT_ID`, all optional (unset ⇒ "CHI is not configured"). 28 unit tests green (`tests/unit/server/lib/chi/`), typecheck 0 errors, eslint clean.
**Deploy-time to go live (documented in DECISIONS.md 2026-07-02, nothing executed):**
1. Deploy `~/matterchat-mcp-v2`: create k8s secret `matterchat-mcp-v2-secrets` (per `kubernetes/staging/secrets.yaml.example`; point `MATTERCHAT_API_URL` at staging MatterChat), then create+push a `staging` branch (repo only has `master`) → `.github/workflows/deploy-staging.yaml` builds→ECR→applies → `matterchat-mcp-v2.stg-omnisai.io`.
2. Register a CHI agent in AI-Agents wired to BOTH MCP servers (`casepro-mcp-v2.stg-omnisai.io` for matter data + `matterchat-mcp-v2.stg-omnisai.io/mcp` for boards/chat) with the legal-assistant system prompt (template in DECISIONS entry).
3. Set `CHI_API_URL`/`CHI_API_KEY`/`CHI_AGENT_ID` on the MatterChat staging deployment — **via `MatterChat-New` `kubernetes/staging/` (ArgoCD owns the manifests; this repo's k8s dir is dead)**.
**Must verify live before go-live:** the invoke contract in `server/lib/chi/client.ts` is the documented best guess (`POST /api/v1/chat/agents/{id}/chat`, dual `Authorization: Bearer` + `X-API-Key` send) — run the curl in that file's CONTRACT comment against staging AI-Agents, then pin route/header/field names.

## ✅ 2026-07-02 — Integration pass 4 SHIPPED to staging (verification + ship of pass 3's merges)
Pass 3 merged 4 branches (`staging-typecheck-debt`, `boards-pagination-2`, `legal-hold-admin`, `teams-message-bridge`+`teams-oauth-connect`) but was cut off pre-verification. Pass 4 verified + fixed + shipped everything, plus merged **`auto/playwright-gate`** (PR #32 — the e2e gate + staging smoke workflows are now armed on `staging`):
- **requireUid purge**: `boards-reports.ts` (2), `boards-matters.ts` (12, 3 effect-only deleted) **and `boards-views.ts` (5 — missed by the pass-3 notes, found because the harness views-family 500'd)** all switched to `this.userId`. The typed REST router CANNOT run `Meteor.userId()` — any future boards endpoint must use `this.userId` (see boards-forms.ts line-60 comment).
- **Typecheck: 0 errors** (fixed teams-bridge fallout: `isEditedMessage()` guard in bridgeCore; explicit variable annotation for the TS7022 `page`/`next` control-flow cycle in TeamsProvider.syncMessages — the generic alone does NOT fix it). `@rocket.chat/ui-contexts` dist ALSO needed a rebuild (stale `SubscriptionWithRoom`), on top of the 4 usual typings/models packages.
- **Tests**: jest server suite 173/173 (legal-hold specs incl., legalHold.ts 100% cov); connector mocha suite 41/41 (`npx mocha --config ./.mocharc.base.json 'tests/unit/app/connectors/**/*.spec.ts'` — they are NOT in jest's testMatch).
- **Runtime on :3100**: boards harness **115/115** (incl. 4 new uid-fix smoke cases for reports/matters); legal-hold REST smoke green (set → `rooms.cleanHistory` refuses `error-room-under-legal-hold` → clear → allowed); Teams smokes green (validation handshake is **POST**-only and echoes token; fake notification with no `TEAMS_WEBHOOK_CLIENT_STATE_SECRET` → 202 accepted-and-dropped, zero ingest — fail-closed; `external-workspaces.bridges` 401 unauth / `{ok:true,bridges:[]}` with auth). Boot warns `EXTERNAL_TOKEN_ENC_KEY is not set` (plaintext credentials at rest — set it on the deployment).
- **Harness gotcha**: `boards-api-test.mjs` does not clean up after itself — leftover boards from a prior run double the `boards.cards.search` hit counts. Purge `boards_boards` titles `^(Copy of )?(API Test Board|Pagination Board|Reorder Board)` + children + `^PagLead` leads before a run.

## 🧪 2026-07-01 — E2E regression net exists (branch `auto/playwright-gate`, unmerged — MERGED 2026-07-02, see above)
Curated the upstream Playwright suite for our MIT fork + wired two gates (see **`docs/E2E-GATE.md`** for everything):
- **`e2e-gate.yml`** — on PR into `staging`: builds the PR image (Dockerfile.alpha + ECR cache), boots app+Mongo in CI, runs a 26-test **smoke** tier; `workflow_dispatch` can run the full **mit-core** suite (592 tests; 136 EE-only tests excluded, never deleted). Check shows on the PR, deliberately NOT required.
- **`staging-smoke.yml`** — 4 read-only checks against live staging, chained after every staging deploy (verified green against the live site 2026-07-01).
Suite lists live in `apps/meteor/tests/e2e/matterchat-suites.ts`. Fork features (Boards UI, OIDC, cross-firm) still have NO e2e specs — that's the next tier to grow.

## 🔴 READ FIRST (2026-06-25) — staging is ArgoCD-owned; deploy is BUILD-ONLY; OmnisAI login works E2E
- **Staging is deployed by ArgoCD** (app `matterchat-staging`, syncs from repo **`MatterChat-New`** `kubernetes/staging/`, automated+prune+selfHeal — owns Deployment/Service/**Ingress**). THIS repo only BUILDS the image (→ ECR `matterchat:staging-latest`); its `kubernetes/staging/*.yaml` is **DEAD** (ArgoCD reverts it). The GHA deploy (PR #16) is now **build-only** → builds image + `kubectl delete pod` to roll it. So merging to `staging` is **safe again** (it no longer `kubectl apply`s the conflicting manifests that flipped the Ingress to the wrong ALB and 404'd the site). Full story in `DECISIONS.md` (2026-06-25) + memory `matterchat-staging-argocd-truth`.
- **OmnisAI login works end-to-end.** Fixes: ingress rebound to the frontend ALB; OIDC issuer/clientId seeded as **persisted Mongo settings** (`getConfig` reads settings-first) — survive ArgoCD; Setup Wizard held at `completed`; `verifyIdToken` accepts a missing `iss`/`aud`. **Still fail-soft (production TODO):** Ed25519 signature verify + nonce; CentralizedAuth should emit standard iss/aud/nonce, then re-enable strict.
- **No local `kubectl`.** Cluster introspection = founder-authorized read-only `matterchat-staging-diag.yml` (`workflow_dispatch` on `develop`). cluster `stg-omnisai-cluster`, ns `staging`.

## ⚡ Prior session (2026-06-24) — Omnis Boards parity (PR #12, merged 2026-06-25)
Three Trello/Asana parity features on **Omnis Boards**, all generic / **standalone-safe** (work on a plain `general`/`task` board, no CasePro — verified by an 8-agent code map + adversarial standalone check):
- **True Gantt** in the Timeline view — **hand-built, no third-party Gantt lib** (the free ones are AGPL/GPL or paywall advanced features). Month/week/day axis, bars, milestone diamonds, finish-to-start dependency arrows, progress fill, today line, drag-to-reschedule + edge-resize. Timeline gains a Gantt|List toggle (Gantt default). New: `client/views/boards/views/gantt/{ganttModel.ts,GanttChart.tsx}`.
- **Nested subtasks** — child cards in the same board+list via the existing `parent`/`child` relation; new `card/SubtasksPanel.tsx` (add/complete/unlink/drill-in) + progress rollup + tile badge. Typed the relations.add/remove + complete REST endpoints (server routes already existed).
- **Time tracking** — `ITimeEntry` sub-doc + `timeEstimateMinutes`/`timeEntries` on `IBoardCard`; `logTime`/`deleteTimeEntry` service fns + `boards.card.log-time`/`delete-time-entry` routes; new `card/TimePanel.tsx` + tile badge. Estimate rides existing `boards.cardUpdate`.

A **multi-agent adversarial review found 11 real bugs → all fixed** (2nd commit): subtasks silently dropped on boards >100 cards (the board-cards endpoint caps at `API_Upper_Count_Limit`=100 → children now resolved per-id via `useQueries`); Gantt drag listener leak + no `pointercancel`; orphan card if a subtask link fails (now archived back); time-input validation (minutes>0, valid `spentAt`, non-negative integer estimate). **Typecheck-clean (0 new errors vs the 23 pre-existing baseline), ESLint-clean.** Shared `core-typings`/`rest-typings` gained additive optional fields/endpoints — the meteor app consumes them as built `dist`, so **rebuild those two packages after pulling** (`yarn workspace @rocket.chat/core-typings run build`, then rest-typings) before the meteor `tsc`.

## ⚡ MatterChat is LIVE on real staging
**https://matterchat.stg-omnisai.io** — on EKS. Deploy model: push to **`staging`** → GitHub Actions builds → ECR → `kubectl apply` `kubernetes/staging/matterchat-{mongo,deployment-staging}.yaml` → rollout (**`Recreate`** strategy). The `matterchat-staging-deploy.yaml` workflow now dumps pod state + events + crash logs on a failed rollout (so a boot failure is diagnosable, not a blind revert). ⚠️ `Recreate` = brief downtime if a rollout fails, and a rollout can flake on a stuck termination (one did 2026-06-24 — a clean redeploy was green).

## ⚡ Cross-firm (CFCS / Omnis Counsel) is LIVE + SECURE on staging (2026-06-24)
Opposing-counsel messaging is wired end-to-end and turned ON:
- **CFCS backend** (`~/omnis-counsel`, `staging`) — internal ClusterIP service in **STRICT identity mode** + real audit key + a NetworkPolicy. REFUSES to start without `CFCS_AUDIT_KEY`; requires the proxy's verified `x-cfcs-caller` on every non-`/health` route (no header-less body-trust in prod). `CFCS_TEST_MODE=1` relaxes it for the test suite/demo only.
- **`/_crossfirm` server proxy** (`app/omnisai-oauth/server/crossFirmProxy.ts`) — authenticates the MatterChat user, derives the verified OmnisAI subject (`services.omnisai.id`), strips inbound `x-cfcs-*`, forwards to `http://cfcs:9200` with an unforgeable `x-cfcs-caller`/`x-cfcs-firm`. **Verified live:** unauth `POST /_crossfirm/whoami` → 401 (mounted + enabled + auth-gated).
- **CFCS identity gateway** (`omnis-counsel/server.js`) — single pre-dispatch step binds every actor field to the resolved caller (unique principal or fail closed); firm asserted ONLY by the verified header.
- **Browser** (`useCrossFirmFetch.ts` / `CrossFirmSection.tsx`) — calls same-origin `/_crossfirm` with a Bearer loginToken; the panel gates on `CrossFirm_Enabled`.
- **Enabled via deployment env:** `CFCS_API_URL=http://cfcs:9200`, `OVERWRITE_SETTING_CrossFirm_Enabled=true`, `OVERWRITE_SETTING_CrossFirm_Firm_Name="Apex Law LLP"`.
- **Red-teamed before deploy** (5 lenses): go-list M1/M2/M3/M5 + S1–S6 + the audit-key all fixed + verified — CFCS `test.js` **26/0**, `test-audit.js` **8/0**, strict-mode security suite all-pass (spoof blocked, header-less→401, missing firm→400, unprovisioned→403, refuses-boot-without-key).

## 🆕 Org auto-provision — built 2026-06-24, PRs up (NOT merged)
On a firm **admin's first "Sign in with OmnisAI"**, MatterChat now mirrors the firm's CasePro team into the workspace automatically. Branch `feature/matterchat-org-autoprovision` in BOTH repos:
- **MatterChat** ([PR #11](https://github.com/OmnisAIOrg/MatterChat/pull/11), base `staging`) — `app/omnisai-oauth/server/orgProvision.ts` (`provisionOrgFromRoster`: roster fetch + idempotent per-member pre-create) + `loginHandler.ts` `maybeAutoProvisionOrg` hook (admin + orgId + per-admin `services.omnisai.provisionedOrgId` marker set only after success; background; never blocks/breaks login).
- **CentralizedAuth** ([PR #352](https://github.com/OmnisAIOrg/CentralizedAuthBackend/pull/352), base `staging-backend`) — new `GET /organizations/:id/members` (service-auth) + `ProvisionApiAuthGuard` (shared secret `x-provision-key` or KeyGate `auth:organizations:read`). Shared-auth ⇒ **needs a non-author review; do not self-merge.**
- **Two deliberate deviations from the design** (see DECISIONS 2026-06-24): service provision-key (not user-token replay, which the session-based AuthGuard rejects); IMPORT/pre-create accounts (not `invite-multiple`, which no-ops on the already-member team — and import needs no SMTP).
- **Config to set on both Alpha/staging apps:** `MATTERCHAT_PROVISION_KEY` (same secret both sides), MatterChat also `OMNISAI_OIDC_ISSUER` (or `OMNISAI_AUTH_API_BASE`). Absent ⇒ silent no-op.
- **Verified:** CentralizedAuth `tsc` clean; MatterChat scoped `tsc` consistent with shipping code. **NOT yet:** live E2E (needs both full stacks → run in Alpha per-PR env).

## Prior session (2026-06-23, all live on staging)
OmnisAI OIDC login E2E (client `WoqXiUHmfiYFRtRhtZoPYygvbthcwqdz`); setup-wizard skip; email-2FA off; first-OmnisAI-user→admin; Admin rail entry; Activity `/boards/inbox` route fixed; Boards code-split; Slack IMPORT verified.

## Deferred / open
- **M4 — before authoritative PRODUCTION cross-firm:** bind firm to a verified CentralizedAuth tenant/org id, not the free-text `CrossFirm_Firm_Name` (name collisions merge escrow domains). Safely deferred behind M2's fail-closed stopgap. Also required before a production launch: real per-state bar verification, firm-held KMS/HSM escrow, and the **legal-ethics (Rule 4.2) + security/crypto expert sign-offs**.
- **Two-firm demo:** staging is a single firm ("Apex Law LLP"), so the panel/identity/create-room work but a full two-firm exchange needs a second instance — or a strict-mode-compatible seed path (`seed-demo.js` hits `POST /firms|/attorneys`, which strict mode now gates).
- **LitBox proxy token-expiry** (`litboxProxy.ts resolveUser`) has the same M3 gap the cross-firm proxy just fixed — task chip spawned.
- LitBox Files PR #186 (trust the OIDC client); branch consolidation; Boards server-side pagination; LitBox encrypt-at-rest key.

## Single next safe task
**This session's open loop (Boards parity, PR #12):** browser-verify it via an alpha preview — click through Gantt drag-reschedule + edge-resize, subtask add/complete/unlink, and time logging — then land the 1 required non-author review (PRs open under Chi-Omnis can't self-approve) and merge `feature/boards-gantt-timeline` → `staging`. Remaining Boards parity gap after this: a Forms/intake builder.

**Prior standing thread (cross-firm):** Browser E2E of cross-firm — log into matterchat.stg-omnisai.io → open a channel → "Cross-firm · Opposing counsel" action → confirm `/whoami` bridges identity + a matter room can be created. Then design the two-firm demo (second instance, or a bootstrap seed path that works under strict mode).
