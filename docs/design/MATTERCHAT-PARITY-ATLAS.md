# MatterChat Parity Atlas

**Purpose.** Map every capability the MatterChat fork inherits from Rocket.Chat, so we can build our own
platform and swap Rocket.Chat out without users noticing. This document is the parity contract: if the
replacement satisfies everything in §6, the swap is seamless by construction.

**Status.** Survey complete, measured against the working tree at `feature/omnis-widgets`
(2026-08-16). Numbers are counted from source, not estimated.

**Decision on record.** Day-1 scope is **full Rocket.Chat parity** — no user-visible feature is dropped
in the swap. Narrowing happens after the swap, if at all, as a separate product decision.

---

## 1. The thesis: parity is a wire contract, not a code contract

MatterChat is not one program. It is a server plus four independent clients, three of which are
hard-wired to Rocket.Chat's *network protocol*:

| Client | What it is | How it binds to the server |
|---|---|---|
| Web app | React SPA inside the Meteor bundle | Shares the server's process and build |
| **MatterChat-Mobile** | Fork of `rocket-chat-reactnative` **4.75.0** | **112 REST endpoints + 44 DDP methods + 3 streams** |
| **matterchat-mcp-v2** | Chi's tool server | **31 REST endpoints** (20 RC + 11 ours) |
| MatterChat-Desktop / Chi-Desktop | Electron shells | Load the hosted web app; call `chi.*` REST |

The mobile app and the MCP server do not care what language the server is written in, what database it
uses, or how it is deployed. They care that `POST /api/v1/chat.sendMessage` accepts a known shape,
returns a known shape, and that `stream-room-messages` pushes a known event.

**That is the whole strategy.** Build our own server behind the same REST + DDP contract, point the
existing clients at it, and the swap is invisible — no mobile release, no MCP change, no user retraining.
It also lets us cut over *subsystem by subsystem* instead of all at once, because a proxy can route
`chat.*` to the new server while `livechat.*` still hits Rocket.Chat.

The corollary is the constraint: **the wire contract is frozen until every client is off it.** Internals
are ours to redesign freely; the 628 endpoint signatures are not, until we choose to version them.

---

## 2. What the fork actually is, in numbers

| Surface | Count | Source of truth |
|---|---|---|
| Typed REST endpoints | **628** | `packages/rest-typings/src/**` |
| REST endpoint files | 64 | `apps/meteor/app/api/server/v1/` |
| Realtime streams | **16** | `packages/ddp-client/src/types/streams.ts` |
| DDP methods (client-callable) | ~193 files declaring methods | `apps/meteor/server/meteor-methods/`, `app/*/server/methods/` |
| Mongo collections | **~100** (104 model classes) | `packages/models/src/models/` |
| Settings keys | **935** | `apps/meteor/server/settings/` (49 files) |
| Permissions | **221** | `server/lib/authorization/constant/permissions.ts` |
| Roles | **19** (12 RC + 7 MatterChat legal roles) | `server/lib/authorization/upsertPermissions.ts` |
| i18n keys × locales | **8,682 × 68** | `packages/i18n/src/locales/` |
| Slash commands | 13 | `apps/meteor/app/slashcommands-*` |
| Cron jobs | 19 | `apps/meteor/server/cron/` |
| Feature modules | 43 | `apps/meteor/app/` |
| Workspace packages | 60 | `packages/` |
| Meteor packages (runtime) | 63 | `apps/meteor/.meteor/packages` |
| Domain service contracts | 44 | `packages/core-services/src/types/` |
| File storage backends | 5 | GridFS, AmazonS3, GoogleCloudStorage, Webdav, FileSystem |
| Production TS/TSX | **~174,000 LOC** | `apps/meteor` + `packages`, tests excluded |

### 2.1 Ownership split — the number that changes the plan

| | LOC (production TS/TSX) | Share |
|---|---|---|
| **Omnis-owned** | **~73,500** | **42%** |
| Rocket.Chat substrate | ~100,400 | 58% |

Omnis-owned breaks down as:

| Area | LOC | What it is |
|---|---|---|
| Boards | ~26,100 | Matters, cards, lists, automations, forms, leads, calendar sync, CasePro sync — 25 Mongo collections, 14 REST endpoint files |
| Chi | ~8,800 | Assistant brain, tool registry, providers, intake, confirm/park, audit, search, reminders |
| Client `omnis/` + widgets | ~6,900 | Orb mount, popout, realtime voice, LitBox + OmnisProof embeds, chi-orb/chi-window/chi-mobile |
| Firms + Firm Console | ~4,200 | Firm model, invites, domain verification, scoping, console UI |
| omnisai-oauth | ~1,900 | CentralizedAuth PKCE login handler, org provisioning |
| Models / endpoints / crons | ~7,200 | Boards*, firms, chi, cross-firm, legal-hold, casepro |
| Other (omnis server libs, cross-firm, litbox views, casepro-events) | ~18,400 | |

**Read this carefully: the fork is already 42% ours.** "Getting off Rocket.Chat" is not rebuilding
174K lines. It is rebuilding the ~100K-line substrate underneath code we already own and understand —
and that substrate is mostly well-understood, well-bounded commodity chat infrastructure.

---

## 3. Layer map

```
┌─ L7  Adjacent clients ── Mobile (RN fork) · Desktop (Electron) · Chi-Desktop · MCP v2
│                          bind via REST + DDP  ←── THE FROZEN CONTRACT
├─ L6  Web client ──────── React SPA · Fuselage design system · 33 view areas · 28 routes
├─ L5  Realtime ────────── 16 streams · Streamer/StreamerCentral · presence · DDP session
├─ L4  API ─────────────── 628 REST endpoints · ~193 DDP method modules · rate limiter · auth middleware
├─ L3  Domain services ─── 44 service contracts · 28 implementations (message, room, user, upload,
│                          push, team, authorization, settings, media-call, video-conf, …)
├─ L2  Data ───────────── ~100 Mongo collections · BaseRaw · Trash/soft-delete · migrations · oplog
└─ L1  Platform ────────── Meteor 3.4.1 · 63 Meteor packages · accounts-* · DDP transport · build
```

Replacement difficulty rises as you go *down*, not up. L6/L7 are ours to restyle already. L1 is the
one with no incremental path — Meteor is all-or-nothing, and it is the layer imposing the hard ceilings
(§7).

---

## 4. Subsystem inventory

Each row: what it is, its surface, who consumes it, and the parity verdict.

### 4.1 Core messaging — **must be wire-identical**

| Subsystem | Surface | Consumers | Notes |
|---|---|---|---|
| Messages | `chat.*` (24 endpoints), `Messages` collection, `stream-room-messages` | Web, Mobile, MCP, Chi | Send, edit, delete, react, star, pin, report, quote, search, sync. Message is the richest schema in the system: attachments, blocks, reactions, mentions, threads, urls, translations, files, stars, pinned, drafts. |
| Rooms | `rooms.*`, `channels.*`, `groups.*`, `im.*` (~120 endpoints), `Rooms` collection, `stream-room-data` | Web, Mobile, MCP | Four room types (c/p/d/l) with divergent endpoint families — a major source of surface bloat. |
| Subscriptions | `subscriptions.*`, `Subscriptions` collection, `stream-notify-user` | Web, Mobile, MCP | Per-user-per-room state: unread counts, alerts, notification prefs, favorite, open, ts/ls/lr. The join table that drives every list. |
| Threads | `chat.getThreadsList`, `chat.syncThreadsList`, follow/unfollow, `readThreads` | Web, Mobile | Threads are messages with `tmid`; parents carry `tcount`/`tlm`/`replies`. |
| Read state / receipts | `subscriptions.read/unread`, `chat.getMessageReadReceipts`, `MessageReads`, `ReadReceipts` | Web, Mobile | |
| Presence | `users.presence`, `stream-user-presence`, `UserPresence:online/away` | Web, Mobile | Now our own MIT `packages/presence` (built during EE strip). **Already replaced.** |
| Typing | `stream-notify-room` (`typing`) | Web, Mobile | |
| Uploads | `rooms.upload`, `uploads.*`, `Uploads`/`Avatars` collections, 5 storage backends | Web, Mobile | Currently GridFS in the shared Mongo; EFS for some paths. |
| Search | `chat.search`, `spotlight`, `directory`, provider abstraction | Web, Mobile, MCP | Plus our own `Chi_Search` semantic index. |

### 4.2 Identity & access — **must be wire-identical**

| Subsystem | Surface | Notes |
|---|---|---|
| Accounts | `accounts-password`, `accounts-oauth`, `users.register`, login tokens, `Users` collection | Meteor `accounts-base` owns the token format. **The login-token shape is a hard compatibility point** — Chi's `chi.session-exchange` mints them via `_generateStampedLoginToken`. |
| OAuth / SSO | `omnisai-oauth` (ours, PKCE → CentralizedAuth), Apple, Google, GitLab, custom OAuth, CAS, LDAP, SAML | Ours is the one in production use. |
| 2FA | `server/lib/2fa`, TOTP + email codes, `users.2fa.*` | |
| Authorization | 221 permissions, 19 roles, `stream-roles`, `canAccessRoom` chain | Room-access logic is subtle: type, subscription, team ancestry, ABAC hooks, firm scoping. |
| Firms | `firms.*`, `firm-feed.*`, `cross-firm.*`, domain verification, invites | **Ours already.** |

### 4.3 Delivery & notification

| Subsystem | Surface | Notes |
|---|---|---|
| Push | `push.*`, `PushToken`, `NotificationQueue`, APNs `.p8` (ours, F3) + FCM | Stock RC routes push through **RC Cloud gateway** — a live dependency on Rocket.Chat's infrastructure that direct APNs/FCM removes. |
| Web push | `app/web-push` | |
| Email | `email@3.1.2`, mailer, `matterchat-email` settings, onboarding templates (ours) | SMTP via Microsoft 365. |
| Desktop notifications | Client-side + our Chi notification triage (F5) | |
| Notification triage | Ours (F5, rules engine) | Built, not yet hooked into delivery. |

### 4.4 Collaboration surface

Integrations (in/out webhooks, bots, `Integrations`/`IntegrationHistory`), 13 slash commands, custom
emoji, custom sounds, custom user status, banners, moderation, mentions, markdown/message-parser,
autotranslate, OEmbed/link preview, discussions, teams (`Team`/`TeamMember`, 20+ endpoints), starred/
pinned messages, canned responses, retention policy, import/export, user data download.

### 4.5 Subsystems present but not in production use

These still count for *code* parity if we lift-and-shift, but not for *behaviour* parity — nobody uses
them. They are the natural first candidates to leave behind once the swap is done:

- **Livechat / Omnichannel** — 13 collections, large endpoint family. Dropped in the EE strip; the FOSS
  remnant still compiles.
- **Federation / Matrix** — `FederationEvents`, `FederationRoomEvents`, `FederationKeys`. EE parts removed.
- **Apps / Marketplace engine** — dropped in EE strip; `apps`, `apps_logs`, `apps_persistence` remain.
- **E2E encryption** — settings exist, off in both environments. Mobile still calls 11 `e2e.*` endpoints.
- **Video conferencing** — Jitsi/`videoConference.*`; Omnis Voice is the intended replacement.
- **Media calls** — dormant MIT stub built during the EE strip.
- **NPS, Smarsh, WordPress, SlackBridge, IRC, WebDAV, Wordpress** — vestigial.

### 4.6 Platform services with no user-facing surface

Migrations (300+), cron scheduler (`agenda`), `InstanceStatus`, `Trash` (soft delete), statistics/usage
report, `ServerEvents`, `Sessions`, device management, logging/tracing (Highlight.io), rate limiter,
settings cache + `OVERWRITE_SETTING_*` env overrides, asset pipeline, i18n loader.

---

## 5. Consumer dependency map

What breaks if a given surface changes:

```
chat.sendMessage ──────► Web · Mobile · MCP · Chi tools · Boards automations
subscriptions.get ─────► Web · Mobile · MCP
stream-room-messages ──► Web · Mobile
stream-notify-user ────► Web · Mobile  (subscription + notification fan-out)
users.info ────────────► Web · Mobile · MCP · Chi
login token format ────► Web · Mobile · Desktop · Chi-Desktop · chi.session-exchange
settings.public ───────► Web · Mobile  (mobile gates features on server version + settings)
boards.* ──────────────► MCP · Chi · Web            (ours)
chi.* ─────────────────► Web orb · Desktop · Chi-Desktop · Mobile chi-mobile.html   (ours)
```

**Mobile's exact dependency — the real parity bar for the mobile swap:** 112 REST endpoints, 44 DDP
methods, 3 streams (`stream-notify-room`, `stream-notify-room-users`, `stream-notify-user`). Full lists
belong in the implementation plan; the headline is that mobile touches **18% of the 628 endpoints**.

Mobile also version-gates behaviour via `compareServerVersion`, so the replacement must report a
Rocket.Chat-compatible version string in `/api/info` until mobile is rebuilt.

---

## 6. The parity contract

The swap is seamless if and only if all of the following hold on cutover day.

**C1 — Wire compatibility.** Every REST endpoint in §2 that a live client calls accepts and returns
byte-compatible shapes, including error codes and pagination envelopes (`{count, offset, total, success}`).

**C2 — Realtime compatibility.** All 16 streams emit the same event names with the same payloads over a
DDP-compatible transport; `sub`/`unsub`/`method`/`ready`/`nosub`/`changed`/`added`/`removed` framing preserved.

**C3 — Auth continuity.** Existing login tokens keep working, or every session is migrated without a
forced re-login. `chi.session-exchange`'s minted tokens must remain valid.

**C4 — Data continuity.** All ~100 collections migrate with `_id`s preserved. Message `_id`s appear in
permalinks, Boards cards, Chi audit records, and CasePro links — regenerating them breaks references
across products.

**C5 — Settings continuity.** All 935 settings resolve, including `OVERWRITE_SETTING_*` env overrides
that production depends on.

**C6 — Permission continuity.** 221 permissions and 19 roles evaluate identically; room-access decisions
match for every room type, team ancestry, and firm scope.

**C7 — Our code runs unchanged, or ports mechanically.** ~73.5K LOC of Boards/Chi/firms is the product.
Any replacement that requires rewriting it has failed the test.

**C8 — Delivery continuity.** Push tokens keep working; notification fan-out matches.

**C9 — i18n continuity.** 8,682 keys resolve across 68 locales.

**C10 — Version reporting.** `/api/info` reports a version mobile's `compareServerVersion` gates accept.

---

## 7. Why this is worth doing — the ceilings we do not control

Recorded so the cost/benefit stays honest:

1. **Scaling is licence-gated.** `replicas` must stay at 1 because cross-pod DDP fan-out requires an
   enterprise "scalability" module. Every firm instance is a singleton; there is no HPA anywhere. This
   is a hard ceiling on someone else's terms.
2. **741 permanent TypeScript errors** in the baseline that we can never fix and must measure around.
3. **Meteor is a dead end.** Meteor 3.4.1 + 63 Meteor packages + an opaque build; the whole platform
   layer is unmaintainable by us and unfashionable to hire for.
4. **RC Cloud dependency for push.** Stock push rides Rocket.Chat's gateway.
5. **Multi-tenancy is impossible in-instance** — rejected at 800–1000h with leak risk; per-org instances
   cost linearly.
6. **Upstream merge tax.** Every Rocket.Chat release is a merge we either take or diverge from.

---

## 8. Decomposition — the buildable units

Full parity is a programme, not a project. Proposed order; each unit gets its own spec, plan, and ships
behind the frozen contract so the fork keeps running throughout.

| # | Unit | Why it is first / what it unblocks |
|---|---|---|
| **0** | **Contract capture** | Machine-readable spec of all 628 endpoints, 16 streams, ~100 collections, generated *from* the fork and backed by a conformance test suite that runs against both old and new servers. Nothing else is verifiable without this. |
| **1** | **Data core** | Schemas + access layer for the ~100 collections, `_id` preservation, migration harness. |
| **2** | **Identity & access** | Accounts, login tokens, OAuth/PKCE, 2FA, 221 permissions, room-access rules. |
| **3** | **Messaging core** | Messages, rooms, subscriptions, threads, read state — plus the `chat.*`/`rooms.*`/`channels.*`/`groups.*`/`im.*` endpoint families. |
| **4** | **Realtime layer** | DDP-compatible transport, 16 streams, presence, typing. |
| **5** | **Delivery** | Push (direct APNs/FCM), email, notification fan-out, triage. |
| **6** | **Ancillary surface** | Uploads, search, teams, integrations, slash commands, emoji, moderation, admin, settings, i18n. |
| **7** | **Port our 73.5K** | Boards, Chi, firms onto the new core. Mechanical if C7 holds. |
| **8** | **Web client** | Replace the Meteor-bundled SPA. Can lag the server swap. |
| **9** | **Cutover** | Dual-run, proxy-based traffic split, data migration, rollback plan. |
| **10** | **Client modernisation** *(post-swap)* | Retire the RN fork and the frozen contract, on our own schedule. |

Units 0–1 are prerequisites for everything. Units 3–6 can run in parallel once 0–2 land.

---

## 9. Traps

1. **The contract is not documented anywhere — it must be *extracted*.** 628 endpoints with real-world
   edge cases (undocumented fields mobile depends on, error-code specifics). Hand-transcription will
   miss things; Unit 0 must generate it and prove it with conformance tests.
2. **`_id` preservation is non-negotiable** (C4). Message and room `_id`s are referenced from Boards,
   Chi audit, CasePro, and permalinks — cross-product breakage, not just chat breakage.
3. **Mobile version-gates on server version.** Report an accepted version or mobile silently disables features.
4. **Meteor `accounts-base` owns the token format.** Reverse-engineer before replacing; `chi.session-exchange` depends on internals (`_generateStampedLoginToken`, `_insertLoginToken`).
5. **Mongo runs with no auth**, and `MONGO_OPLOG_URL` points at the shared `local` db. Any multi-instance
   design inherits this unless fixed. Settle before customer #2.
6. **Boards is 26K LOC and 25 collections** — it is a project-management product living inside the chat
   app. It is ours, but it is not small, and it binds tightly to rooms and subscriptions.
7. **Do not fix the 741 baseline errors.** Measure against the baseline; never add to it.
8. **68 locales × 8,682 keys** is a real migration, not a copy — key namespacing differences will bite.
9. **The fork keeps moving.** Nine features shipped in the last programme alone. The contract capture in
   Unit 0 must be regenerable, or it is stale the week it is written.

---

## 10. Open questions for the founder

1. **Language/runtime for the new server.** Node/TypeScript keeps our 73.5K LOC portable and is the
   lowest-risk answer to C7. Anything else means rewriting Boards and Chi too.
2. **Dual-run or big-bang cutover?** Dual-run behind a proxy is safer and enables incremental swap;
   it costs a compatibility shim and a period of running both.
3. **Does the web client swap with the server, or later?** Later is lower-risk and is what the frozen
   contract buys us.
4. **Keep Mongo, or move?** Keeping it makes C4 nearly free. Moving is a second migration on top of a
   rewrite.
5. **What happens to the unused subsystems (§4.5)?** Full parity as stated includes them. Confirm we
   are carrying Livechat/Federation/Apps/E2E forward, or agree now to drop them and revise §6.

---

*Counts measured 2026-08-16 against `feature/omnis-widgets`. Regenerate before relying on them for
estimation — the fork is under active development.*
