# MatterChat External-Workspace Connectors (Slack + Microsoft Teams)

**One design + build spec. Provider-pluggable architecture, two providers, one org-switcher rail.**

Status: ready to build. Verified against `/Users/davidnguyen/MatterChat` on `develop` and `auto/slack-switcher-complete` (June 2026). Every "what exists today" claim below was grepped/read, not assumed.

---

## 0. TL;DR

- **Goal:** let a MatterChat user work inside an *external* company's Slack or Microsoft Teams from inside MatterChat — read their channels, post as themselves, all behind the org-switcher rail on the far left.
- **Architecture:** one `ChatProvider` interface, a `ProviderRegistry`, a provider-agnostic `BridgeCore` (the generalized version of today's `RocketAdapter`), and a per-user/per-workspace `ExternalConnection` record. Slack and Teams are two implementations of the same interface; the rail and room-list never branch on provider.
- **Slack** already exists as a workspace-level bridge (MIT `apps/meteor/app/slackbridge/`) — we *wrap* it, we do not rebuild it.
- **Teams** is true greenfield on Microsoft Graph — no Graph/Azure code anywhere in the repo today.
- **The one real cost gotcha is dead:** Microsoft **ended metering on the Teams message/membership Graph APIs on Aug 25, 2025**. The historic per-message billing gate on chatMessage change-notifications is gone for our path.
- **The one product decision for the founder:** per-user vs workspace-level connections. Recommendation: **per-user** (matches law-firm confidentiality), shipped in two steps so there's a live demo this week.
- **The build runs as 6 parallel workstreams** behind a tiny types-only interface PR. Wall-clock ~3–5 weeks; critical path is the Teams track + your Azure app registration + admin-consent turnaround.

---

## 1. Goal + the provider-pluggable architecture

### 1.1 What we're building

A connector layer that makes "an external Slack/Teams workspace" a first-class thing in MatterChat:

- The far-left **org-switcher rail** shows a tile per connected external workspace (plus the native MatterChat tile).
- Selecting a tile filters the room list to *that* workspace's bridged channels.
- Inbound messages from the external workspace appear as MatterChat messages; outbound messages typed in MatterChat post back to the external workspace **as the real signed-in user**.
- Adding a new provider in the future = one new file implementing one interface + one icon in the rail. No caller changes.

### 1.2 The three pieces of the abstraction

```
                       ┌───────────────────────────────┐
   Org-switcher rail ──┤  ProviderRegistry             │
   (client)            │  Map<ProviderKind, Provider>  │
                       │  + connection manager         │
                       └───────────────┬───────────────┘
                                       │ boots one BridgeCore per active connection
                          ┌────────────┴────────────┐
                          │       BridgeCore         │  (generalized RocketAdapter)
                          │  ALL RC/Mongo writes,    │  speaks RC vocabulary only
                          │  callbacks, importIds    │
                          └────────────┬────────────┘
                                       │ provider.* calls (external vocabulary only)
                 ┌─────────────────────┴─────────────────────┐
                 │                                            │
        ┌────────┴────────┐                         ┌─────────┴─────────┐
        │  SlackProvider  │                         │  TeamsProvider     │
        │  wraps existing │                         │  Microsoft Graph   │
        │  SlackBridge    │                         │  (greenfield)      │
        └─────────────────┘                         └────────────────────┘
```

**`ChatProvider` interface** — new file `apps/meteor/app/external-workspaces/lib/ChatProvider.ts`. Deliberately a provider-neutral superset of what `RocketAdapter`↔`SlackAdapter` already do:

```ts
export type ProviderKind = 'slack' | 'teams';      // extend the registry, never branch on it in callers

export interface ExternalChannel  { externalId: string; name: string; isPrivate: boolean; topic?: string; memberExternalIds: string[]; }
export interface ExternalUser     { externalId: string; displayName: string; email?: string; isBot: boolean; avatarUrl?: string; }
export interface ExternalMessage  { externalId: string; channelExternalId: string; authorExternalId: string; text: string; ts: string; threadTs?: string; editedTs?: string; files?: ExternalFileRef[]; }
export interface OutboundMessage  { text: string; threadExternalId?: string; files?: ExternalFileRef[]; }

export interface ConnectionContext {
  connectionId: string;                 // _id of the external_connections doc
  scope: 'workspace' | 'user';
  ownerUserId?: string;                 // RC userId when scope === 'user'
  credentials: ProviderCredentials;     // decrypted at use-time
}

export interface ChatProvider {
  readonly kind: ProviderKind;
  // auth / lifecycle
  beginOAuth(ctx: { scope: 'workspace'|'user'; ownerUserId?: string }): Promise<{ authorizeUrl: string; state: string }>;
  completeOAuth(state: string, params: Record<string,string>): Promise<ProviderCredentials>;
  connect(ctx: ConnectionContext): Promise<void>;       // open socket/subscription + register inbound handlers
  disconnect(ctx: ConnectionContext): Promise<void>;
  verifyCredentials(creds: ProviderCredentials): Promise<{ ok: boolean; externalTeamId: string; externalTeamName: string }>;
  // discovery / sync
  listChannels(ctx: ConnectionContext): Promise<ExternalChannel[]>;
  fetchHistory(ctx: ConnectionContext, channelExternalId: string, since?: string): AsyncIterable<ExternalMessage>;
  // identity
  getUser(ctx: ConnectionContext, externalUserId: string): Promise<ExternalUser | null>;
  getChannel(ctx: ConnectionContext, externalChannelId: string): Promise<ExternalChannel | null>;
  // outbound
  postMessage(ctx: ConnectionContext, channelExternalId: string, msg: OutboundMessage): Promise<{ externalId: string }>;
  updateMessage(ctx, channelExternalId, externalMessageId, msg): Promise<void>;
  deleteMessage(ctx, channelExternalId, externalMessageId): Promise<void>;
  addReaction(ctx, channelExternalId, externalMessageId, emoji): Promise<void>;
  removeReaction(ctx, channelExternalId, externalMessageId, emoji): Promise<void>;
}
```

**Key architectural rule:** the RC-side mapping is **NOT** in the provider. Providers speak only "external" vocabulary (external channel/user/message IDs). A single shared **`BridgeCore`** translates external↔RC via `importIds`. Providers never touch Mongo.

**`BridgeCore`** — `apps/meteor/app/external-workspaces/server/BridgeCore.ts`. This is today's `RocketAdapter`, refactored to be provider-agnostic. It owns:
- the RC callbacks `afterSaveMessage` / `afterDeleteMessage` / `afterSetReaction` / `afterUnsetReaction` (today registered in `RocketAdapter.registerForEvents`);
- `findChannel`/`findUser`/`addChannel`/`addUser`/`createAndSaveMessage`/`addAliasToMsg` (lifted from `RocketAdapter`);
- mention conversion (`convertSlackMsgTxtToRocketTxtFormat` → `convertExternalMentions(provider, text)`);
- the RC message ID scheme, **re-namespaced** from `slack-<channel>-<ts>` to `ext-<connectionId>-<channelExternalId>-<ts>` so two providers / two per-user connections cannot collide and the loop-prevention guard (`_id.indexOf('slack-') === 0` today) still works per-connection.

It is parameterized by a `ChatProvider` + `ConnectionContext` instead of a hard-coded `SlackAdapter`.

**`ProviderRegistry`** — `apps/meteor/app/external-workspaces/server/ProviderRegistry.ts`. `register(provider)` / `get(kind)`, plus a connection manager that **replaces the global `SlackBridge` singleton**: at boot it reads `external_connections`, and for each active connection it instantiates one `BridgeCore` bound to the right provider + credentials.

### 1.3 Why this is clean-room-safe

Verified by grep: **nothing Slack/Teams lives in `apps/meteor/ee/`** (the proprietary tree) — only `node_modules` noise. The entire bridge is in MIT `apps/meteor/app/slackbridge/`. So the abstraction is extracted only from MIT code, and `TeamsProvider` is written from Microsoft Graph docs, never adapted from any `ee/` federation code. **Standing rule for this work: do not read, import, or copy anything under `apps/meteor/ee/`.**

---

## 2. The two providers (concrete)

### 2.1 SlackProvider — wraps the existing SlackBridge

**What exists today (verified):**
- `apps/meteor/app/slackbridge/server/` — `slackbridge.ts` (`export const SlackBridge = new SlackBridgeClass()` at line 199; wired at boot from `apps/meteor/server/importPackages.ts:47`), `SlackAdapter.ts` (the connection: `@slack/bolt` Socket Mode via `connectApp`, legacy `@slack/rtm-api` via `connectLegacy`; inbound `onMessage`/reactions; outbound `postMessage`/`postMessageUpdate`/`postDeleteMessage`/`postReactionAdded`/`postReactionRemove`; the in-memory `slackChannelRocketBotMembershipMap`), `RocketAdapter.ts` (RC writes + `importIds` stamping via `Rooms.addImportIds`/`Users.addImportIds`), `SlackAPI.ts`.
- Credentials come from **admin settings** (`apps/meteor/server/settings/slackbridge.ts`): `SlackBridge_BotToken` / `SlackBridge_AppToken` / `SlackBridge_SigningSecret` (Socket Mode) or legacy `SlackBridge_APIToken` (RTM). Newline-delimited; one bridge per line. **This is instance-wide, not per-user** — the one thing the per-user requirement breaks.

**What we build:** `apps/meteor/app/external-workspaces/providers/SlackProvider.ts` — a thin adapter implementing `ChatProvider` by delegating to the existing classes:
- `connect` → existing `connectApp`/`connectLegacy`.
- `postMessage`/`updateMessage`/`deleteMessage`/`addReaction`/`removeReaction` → existing `SlackAdapter` posters.
- `listChannels` → `slackAPI.getChannels() + getGroups()`.
- `getUser`/`getChannel` → `slackAPI.getUser` / `getRoomInfo`.
- `slackChannelRocketBotMembershipMap` becomes an internal cache of `SlackProvider` only.

The only edit to `slackbridge.ts` is to expose a programmatic `connectOne(credential)` the provider calls (today it only reads newline token lists from settings) — **keep the settings path working** for backward compat. For MVP, Slack stays **workspace-level** (admin token), just surfaced through the new abstraction so the rail is uniform. Per-user Slack OAuth is a fast-follow (M4) that reuses the connection storage + a `/_slack/oauth` route cloned from the OmnisAI OAuth pattern.

### 2.1a Slack live inbound — Events API (BUILT; the full two-way bridge)

> Status: **SHIPPED.** Per-user Slack OAuth (`/_slack/oauth/*`), discovery, backfill, and outbound
> posting were already live; this section documents the **inbound realtime half** that replaced the
> `subscribe` stub — the Slack sibling of the Teams change-notification webhook (§3.3), to the same
> security model.

**Transport:** Slack **Events API** (HTTP event subscriptions), NOT socket-mode. One app-level
subscription covers every channel the connected users can see — unlike Graph there is **no
per-channel subscription** to create/renew/delete, so a bridge's channel mapping (the
`bridgedChannels` record) *is* the subscription.

**Endpoint:** `POST /_slack/events` (`apps/meteor/app/connectors/server/providers/slack/events.ts`;
mounted outside `/api` like `/_slack/oauth` + `/_connectors/teams`). Flow:
1. `url_verification` handshake → echoes the `challenge` (only after the signature verifies — Slack
   signs the handshake too).
2. Every request verified: `X-Slack-Signature` = `v0=` + hex HMAC-SHA256(signing secret,
   `v0:{X-Slack-Request-Timestamp}:{raw body}`), constant-time compare, timestamps staler than
   **5 minutes rejected** (replay guard). FAIL-CLOSED: no secret → nothing processed, no crashes —
   bridges stay outbound-only + the 30-min reconcile poll (`realtime: 'none'` in
   `external-workspaces.bridges` is the admin-facing status).
3. Ack **200 within 3s**, process async (`setImmediate`) — Slack retries slow/failed deliveries
   (`X-Slack-Retry-Num`) then disables the subscription; a short-TTL `(team_id, event_id)` dedup set
   drops retries at the door, and the deterministic `ext-…` RC `_id` keeps ingest idempotent across
   restarts.
4. `message` events for **channels + private channels** (`message.channels`, `message.groups`) fan
   out to every connection bridging that `(team_id, channel)` via `ingestExternalMessage` — same
   alias attribution as Teams (display name via cached `users.info`, no ghost accounts). Handled:
   new messages, thread replies (mapped to RC threads when the root is ingested), `message_changed`
   (edit applied to the bridge-inserted message), `message_deleted` (bridge-inserted message
   removed), file/attachment **link-out stubs** (name + Slack permalink appended to the text). DMs
   (`im`/`mpim`) stay poll/backfill-only for now.
5. **Echo prevention** (outbound posts must not ping-pong back): our outbound `chat.postMessage`
   runs on the owner's USER token, so the echo returns as a normal user-authored event — the echo
   set remembers the returned `ts` per connection (checked in the events path AND inside
   `ingestExternalMessage`), the persistent `customFields.connectorBridge.externalId` stamp catches
   echoes after a restart, and `bot_id`/subtype events are skipped wholesale.

**Config (`Slack` admin group):**

| What | Setting | Env fallback |
| --- | --- | --- |
| Master switch | `Slack_Enabled` | — |
| OAuth client id / secret | `Slack_OAuth_Client_Id` / `Slack_OAuth_Client_Secret` | — |
| **Events signing secret** | `Slack_Signing_Secret` (masked, secret) | `SLACK_SIGNING_SECRET` |

**Slack app setup (one-time, at api.slack.com/apps → the MatterChat app):**
1. *Basic Information → Signing Secret* → paste into **Admin → Slack → Signing Secret** (or ship as
   `SLACK_SIGNING_SECRET` env). Do this FIRST — the URL verification below is signature-checked.
2. *Event Subscriptions → Enable*, Request URL: **`https://www.matterchat.com/_slack/events`**
   (per-deploy: `<Site_Url>/_slack/events`, e.g. `https://matterchat.stg-omnisai.io/_slack/events`).
3. *Subscribe to bot events*: **`message.channels`**, **`message.groups`** → Save, reinstall the app
   if prompted. NOTE: bot events only deliver for channels the app's **bot user is a member of** —
   invite the bot (`/invite @MatterChat`) to each bridged channel, or additionally subscribe the
   same event names under *user events* to deliver for everything the OAuth-connected user can see.

### 2.2 TeamsProvider — Microsoft Graph, from scratch

**What exists today:** nothing. Grep is clean of `@azure`, `msgraph`, `@microsoft/microsoft-graph`. All Teams code is new.

**Architecture — mirrors SlackBridge one-to-one but on Graph:** a per-connection `TeamsProvider` implementing `ChatProvider`, talking to a thin `GraphAPI` client. Where SlackBridge has a socket (RTM / Socket Mode), Teams has **change notifications (webhooks)** — there is no Graph socket. Same interface, different transport; that's the whole point of the abstraction.

New directory `apps/meteor/app/external-workspaces/providers/teams/`:
- `TeamsAuth.ts` — server-side OAuth2 **authorization code + PKCE (S256)** against `login.microsoftonline.com/organizations/oauth2/v2.0/{authorize,token}`. **Clone the proven `/_omnisai` PKCE pattern** from `apps/meteor/app/omnisai-oauth/server/index.ts` (server routes via `WebApp.connectHandlers`, state parked in `CredentialTokens` with 60s TTL, `serverFetch` for the token exchange) — *not* RC generic Custom OAuth, which the codebase already abandoned for lacking PKCE.
- `graphClient.ts` — thin `serverFetch` wrapper with auto-refresh on 401, centralized 429/backoff handling, `@odata.nextLink` paging.
- `routes.ts` — `/_teams/authorize` + `/_teams/callback`, plus the webhook routes (below).
- `TeamsBridge.ts` — read/post/real-time mapping (below).
- `subscriptions.ts` + `notifications.ts` + `lifecycle.ts` — the change-notification machinery.

**Token storage:** generalize the verified per-user crypto helper `apps/meteor/app/omnisai-oauth/server/litboxCrypto.ts` (AES-256-GCM, `enc:v1:<iv>:<authTag>:<ciphertext>` format, no-op without an env key, fail-closed decrypt — confirmed at lines 16/42/67) into `apps/meteor/app/external-workspaces/server/tokenCrypto.ts` keyed by a new env `EXTERNAL_TOKEN_ENC_KEY`. Tokens live on the connection record (§4.3), **never raw in Mongo**.

---

## 3. Microsoft Graph specifics (this is the load-bearing detail)

### 3.1 Auth — Entra ID app registration

Register **ONE multi-tenant app** in OmnisAI's Entra tenant:
- **Supported account types:** "Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)". Each MatterChat user signs into *their own external company's* tenant with no guest invite.
- **Use the `/organizations` authorize endpoint, NOT `/common`** — personal Microsoft accounts are unsupported by *every* Teams scope, so `/common` would invite consumer-account failures.
- **Platform:** Web. **Redirect URI:** `https://<matterchat-host>/_teams/callback` (register staging `https://matterchat.stg-omnisai.io/_teams/callback`, prod, and a localhost dev URI).
- **Token version:** v2.0. **Secret:** client secret or (preferred) certificate, stored encrypted in MatterChat secrets.

**Flow:** OAuth2 auth-code + PKCE (S256). `offline_access` is mandatory to receive a refresh token (access tokens ~60–90 min; refresh tokens rotate). Persist per connection: `{ tenantId (from id_token tid), refresh_token (encrypted), homeAccountId, scopes, externalAadUserId }`.

**DELEGATED, not application permissions — throughout.** This is the whole game: delegated lets the bridge act *as the signed-in user*, see exactly what they see, and **send live messages as that real human**. Application permissions can only POST via migration/import mode (`Teamwork.Migrate.All`) — app-only **cannot post live messages as a person**. Delegated also avoids tenant-admin app-grant on the external tenant for the read paths.

### 3.2 Exact delegated scopes (v1.0, verified Jun 2026)

| Capability | Scope | Admin consent? |
|---|---|---|
| List joined teams | `Team.ReadBasic.All` | **YES** |
| List channels | `Channel.ReadBasic.All` | **YES** |
| Read channel messages + subscribe | `ChannelMessage.Read.All` | **YES** |
| Send channel messages | `ChannelMessage.Send` | **NO** (user-consentable) |
| Read/send 1:1 + group DMs (optional) | `Chat.Read` / `Chat.ReadWrite` | **NO** (the un-suffixed delegated forms) |
| Refresh tokens | `offline_access` | n/a |

> Resolve sender display names from the `from.user` block already in each message payload — **avoids** needing `User.ReadBasic.All`.

**The consent reality (flag to founder):** every **read** scope is **admin-consent-required**. A regular external user clicking "Connect Teams" hits the "Need admin approval" wall unless their tenant admin grants tenant-wide consent for our multitenant app once (or enables the admin-consent-request workflow). The **send-only / DM** scopes are user-consentable. **Design implication:** support a degraded **"send-only / chats-only" mode** when admin consent is absent, and surface an explicit "ask your Teams admin to approve OmnisAI MatterChat" link (the `admin_consent` request URL with `prompt=admin_consent`).

### 3.3 Read path — backfill + real-time

**Backfill (REST, paged via `@odata.nextLink`):**
- Teams: `GET /me/joinedTeams`
- Channels: `GET /teams/{id}/channels` (IDs look like `19:...@thread.tacv2`)
- History: `GET /teams/{id}/channels/{id}/messages?$top=50` + per-message `/replies` for threads. Sort by `createdDateTime` (order not guaranteed-stable).
- Durable cursor (preferred over history paging for gap-fill): `GET /teams/{id}/channels/{id}/messages/delta` — persist the `deltaLink` per channel.

**Real-time — change notifications (webhooks), NOT polling, when we choose true real-time:**
```
POST /v1.0/subscriptions
{
  "changeType": "created,updated,deleted",
  "notificationUrl":          "https://<host>/_teams/notifications",
  "lifecycleNotificationUrl": "https://<host>/_teams/lifecycle",
  "resource": "/teams/{team-id}/channels/{channel-id}/messages",
  "includeResourceData": true,
  "encryptionCertificate": "<base64 public cert>",
  "encryptionCertificateId": "tb-key-1",
  "expirationDateTime": "<now + ~2.9 days>",
  "clientState": "<per-sub random secret>"
}
```
This **per-channel** resource supports **delegated** `ChannelMessage.Read.All` — works on a per-user token, no app-only needed. (Optional DMs: subscribe `/chats/{chat-id}/messages` with delegated `Chat.Read`.)

**Limits to design around (verified):**
- Max subscription lifetime **4,320 min (3 days)** for chatMessage/channel/chat/team subs.
- **1 subscription per app+channel** (and per app+chat). → **Multiple MatterChat users bridging the SAME external channel must share ONE subscription.** Key subs by `(tenantId, channelId)` and fan out internally to all subscribing RC rooms. Do **not** create one sub per user or you'll collide/403.
- **10,000 total Teams subscriptions per org** (shared across all Teams sub types) — this cap is per *external* org (the customer's), since subs live in their tenant under the user's delegated token. Confirm we never create subs in our own tenant.
- Latency <10s avg, 1 min max.

**Webhook endpoint requirements (public HTTPS, no auth in front):**
- **Validation handshake** on create/renew: Graph POSTs `?validationToken=...`; reply **200** with that token as **text/plain within 10 seconds**.
- `includeResourceData=true` ⇒ **encrypted** payload: publish an RSA public cert; Graph encrypts a per-notification symmetric key with it; you decrypt `dataKey` with your private key, then AES-decrypt `data` → full `chatMessage` JSON (saves a per-message GET round-trip).
- **Always verify** `validationTokens` (JWT signed by Graph, audience = your appId) **and** `clientState` before trusting a payload.
- Return **202 fast; process async** (queue). Graph retries non-2xx with backoff, then drops.

**Renewal + lifecycle (mandatory for losslessness):**
- A cron renews each sub at **~T-12h** via `PATCH /subscriptions/{id}`.
- Because lifetime >1h, `lifecycleNotificationUrl` is **required** (Graph rejects otherwise).
- Lifecycle events: `reauthorizationRequired` (re-auth / cert rotated), `subscriptionRemoved` (recreate), **`missed`** (Graph couldn't deliver → run a `delta`/history catch-up GET to backfill the gap). **Handling `missed` is what makes the bridge lossless.**

**Polling fallback:** if a tenant blocks subscriptions, you exceed the cap, or you choose the no-licensing MVP path, fall back to per-channel `/messages/delta` polling on a timer (30–60s), persisting `deltaLink`. Slower, more throttle pressure, functionally equivalent. **Keep it a per-connection config toggle.**

### 3.4 Write path — MatterChat → Teams

- `POST /teams/{team-id}/channels/{channel-id}/messages` with delegated `ChannelMessage.Send`. Body: `{ "body": { "contentType": "html"|"text", "content": "<p>...</p>" }, "mentions":[...], "attachments":[...] }`. Returns 201; message attributed to the **real signed-in user** — exactly what we want.
- Threaded reply: `POST .../messages/{message-id}/replies`. DMs: `POST /chats/{chat-id}/messages` (delegated `Chat.ReadWrite`).
- **Hard limitation, state plainly:** Graph **cannot post as an arbitrary user**. Live POST always posts as the token's own user. So **each MatterChat user must connect their OWN Teams identity to send**; messages from RC users who haven't connected Teams cannot be mirrored outbound — show a non-blocking "connect Teams to send to this channel" notice (mirrors how SlackBridge skips unmapped users).

### 3.5 Format mapping (Teams ≠ Slack mrkdwn)

- Teams `body.contentType` is `text` or **`html`** (not markdown). Inbound html→RC markdown: sanitize + convert (`<b>`→`**`, `<a>`, `<br>`, lists, `<blockquote>`, `code/pre`→`` ` ``/```` ``` ````). Mentions arrive as `<at id="0">Name</at>` + a parallel `mentions[]` array → convert to RC `@username` via the ghost map.
- Outbound RC markdown→Teams: send `contentType:"html"`; build the structured `mentions[]` array for @-mentions (Teams requires it, not just text).
- **Adaptive cards / rich attachments:** v1 renders a degraded RC attachment (title + "open in Teams" `webUrl`) rather than re-rendering the card. Outbound cards: out of scope v1.
- **Files:** Teams attachments are SharePoint/OneDrive `driveItem` references. v1 posts the SharePoint link (works only for tenant members — a known gap). Full mirroring (download via `Files.Read.All` → re-upload to RC) is a fast-follow.

### 3.6 The metering / licensing gotcha (the big de-risk)

**Microsoft ENDED metering on the Teams message/membership Graph APIs on Aug 25, 2025.** The historic `model=A/B` pay-per-use gate that blocked `chatMessage` subscriptions is gone; the `model` query param is now ignored. **This removes the single biggest cost/eligibility blocker** for our real-time path.

Two consequences:
1. We **deliberately use the per-channel resource** `/teams/{id}/channels/{id}/messages` (supports delegated tokens; was the right call anyway) and **do NOT architect around** `/teams/getAllMessages` (forces app-only + the old cost gate).
2. Still-metered/licensed APIs we **avoid entirely**: meeting transcript/recording content ($/min), Copilot AI insights (M365 Copilot license), DLP `policyViolation` PATCH. We use none of them.

> Note: one scoping pass framed Graph change-notifications as still metered and recommended polling for MVP to dodge Azure billing. The verified June-2026 position is that **metering on our exact path is off**. Net: webhooks are no longer a *billing* blocker — they remain an *infra* dependency (a public callback + a renewal cron). The MVP recommendation below still ships **polling first** for *infra simplicity and speed*, not cost.

### 3.7 Other Graph gotchas to handle

- **Throttling (verified):** 4 req/s per app per team; **1 req/s per app per tenant per channel/chat**; **1 req/s per user for POST** in a channel/chat. On 429 honor `Retry-After` — but several Teams message endpoints **don't** return it, so implement exponential backoff + jitter as the fallback. Per-channel send queue at ≤1 msg/s/user. Centralize all of this in `graphClient.ts`.
- **Refresh-token death:** external-tenant Conditional Access / admin revoke / password change silently kills refresh tokens. Detect `401 invalid_grant`, mark the connection `needs-reconnect`, and notify the user in RC.
- **Cert rotation** for rich notifications: rotate the encryption cert periodically; `reauthorizationRequired` signals when.
- **External ID / B2C tenants:** change notifications are **not supported** there — detect and force polling.
- **Teams ToU:** "don't use Teams as a log file / only send messages people read." Fine for human chat; means no automated noise relayed outbound.

---

## 4. Per-user vs workspace — the founder decision

### 4.1 Plain-language framing

**WORKSPACE-LEVEL** = "the firm plugs in its Slack/Teams once; every lawyer in MatterChat sees those same channels." This is exactly what the current SlackBridge does. Simplest and fastest. **But:** everyone shares one identity into the outside system, messages post as a bot/alias (not the individual), and one person's connection exposes those channels to the whole firm. That is *wrong* for a law firm, where attorney A and attorney B are on **different** external client channels and confidentiality / ethical walls matter.

**PER-USER** = "each lawyer signs into their own Slack/Teams; they see only THEIR channels and post AS THEMSELVES." This matches how a firm actually operates (per-matter, per-client confidentiality), makes posts attributable to the real person, and is what the org-switcher rail already visually implies (each person's own set of workspaces). It costs more — per-user OAuth, encrypted per-user token storage, token refresh — **but you already own that exact pattern** (`litboxCrypto` AES-256-GCM + tokens on the user doc + the `/_omnisai` PKCE OAuth dance, all verified in the repo).

### 4.2 Recommendation — PER-USER, shipped in two steps

**Per-user is the product.** For a legal product, do **not** normalize a firm-wide shared external identity. But ship in two steps so there's a live demo *this week* without betting the architecture:

1. **MVP keeps the existing workspace-level Slack bridge**, surfaced through the new abstraction (scope `'workspace'`, zero rework, proves the rail end-to-end).
2. **Teams is built per-user from day one** — it's greenfield anyway, and you already own the per-user token pattern.
3. **Per-user Slack OAuth is a fast-follow** (M4) that reuses the same storage + a `/_slack/oauth` route.

The abstraction is designed per-user; **workspace-level is just the degenerate case** (`scope: 'workspace'`, empty `ownerUserId`). A migration seeds one `workspace`-scope `slack` connection from the existing `SlackBridge_*` settings so nothing breaks.

### 4.3 Storage & tagging (the part that doesn't exist today)

**New collection `external_connections`** — model `packages/models/src/models/ExternalConnections.ts`, typing `IExternalConnection` in `packages/core-typings`:
```
{ _id, provider: 'slack'|'teams', scope: 'workspace'|'user', ownerUserId?: string,
  externalTeamId, externalTeamName, status: 'connected'|'error'|'disconnected'|'needs-reconnect',
  credentialsRef,            // handle into the encrypted token store — NEVER a raw token in Mongo
  realtimeMode: 'webhook'|'polling',
  createdAt, lastSyncAt }
```

**Tagging bridged rooms (reuse `importIds`, the verified existing primitive):**
- `importIds` is a real Mongo field with model methods on both collections (`Rooms.findOneByImportId`/`addImportIds`, `Users.findOneByImportId`/`addImportIds`; typed on `IUser`). Slack-specific in spelling, generic in shape. **Keep it as the lookup index.**
- Namespace the stored value as `ext:<connectionId>:<channelExternalId>` so it carries provider + connection.
- Add a small typed field `IRoom.externalSource?: { connectionId: string; provider: ProviderKind }` as the **cheap client-readable tag** the sidebar reads (so a workspace-scope Slack room and a user-scope Teams room coexist, and multiple orgs are supported).

**Users:** keep `Users.addImportIds` for identity resolution. For **user-scope** connections, do **NOT** auto-create RC accounts for every external user (that workspace-bot behavior pollutes the firm directory) — render external authors via the existing **alias** mechanism (`SlackBridge_AliasFormat` generalized to a per-connection alias format), the path `addAliasToMsg` already uses.

### 4.4 Org-switcher rail (generalize the existing branch, minimally)

The rail exists, fully built, on `auto/slack-switcher-complete` (`OrgSwitcherRail.tsx`, `OrgSwitcherContext.ts`, `OrgSwitcherProvider.tsx`, `useOrgSwitcher.ts`), wired into `LayoutWithSidebar.tsx`, and the room-list filter already keys off it. Verified edits:
- `useOrgSwitcher.ts`: change the type `'matterchat' | 'slack'` → `'matterchat' | ProviderKind`. Replace the single `SlackBridge_Enabled` read with a call to a new endpoint `external-workspaces.list` that returns the user's visible connections (all `workspace`-scope + this user's own `user`-scope). Each → a `SwitchableOrg`. De-stub `switchOrg` (it already drives `useRoomList`) and `addWorkspace` (open a real "connect a workspace" modal: choose Slack/Teams → `connectStart` → redirect to `authorizeUrl`).
- `OrgSwitcherRail.tsx`: replace the inline `SlackMark` with a `<ProviderMark kind={org.type}/>` lookup; adding Teams = adding a `TeamsMark` (Teams purple glyph) to one map. No other rail change.
- `useRoomList.ts`: the verified filter today is `apps/meteor/client/sidebar/hooks/useRoomList.ts:88` — `if (selectedOrgId === 'slack' && !(Array.isArray(room.importIds) && room.importIds.length > 0)) return;`. Generalize to:
  ```ts
  if (selectedOrgId !== 'current' && room.externalSource?.connectionId !== selectedOrgId) return;
  ```
  `'current'` keeps the native list (and should hide external rooms — the inverse filter). This deletes the `=== 'slack'` special-case entirely.

---

## 5. Prerequisites the founder / infra must provide

**Slack workspace-level:** NONE new (existing admin-token bridge).

**Slack per-user (later, M4):** a founder-owned Slack app with OAuth — client id/secret, redirect `https://matterchat.stg-omnisai.io/_slack/oauth/callback`, user-token scopes `channels:read, channels:history, chat:write, users:read, reactions:read, reactions:write`.

**Microsoft Teams (required before the Teams track can integration-test; scaffolding can start now against a mock):**

| # | Item | Detail |
|---|---|---|
| a | **Entra ID app registration** | Azure Portal → App registrations → New. Returns Application (client) ID + Directory (tenant) ID. **Decide single-tenant vs multi-tenant** (multi-tenant if client firms bring their own M365 — see §6 decision). |
| b | **Client secret or certificate** | Store as `TEAMS_CLIENT_SECRET` in the same AWS/k8s secret store as `OMNISAI_OIDC_*` / `LITBOX_TOKEN_ENC_KEY`. Certificate preferred over secret. |
| c | **`EXTERNAL_TOKEN_ENC_KEY`** | 32-byte base64, for per-user token encryption at rest (reuses the `litboxCrypto` pattern). |
| d | **Redirect URIs registered on the app** | `https://matterchat.stg-omnisai.io/_teams/callback` (staging) + prod + a localhost dev URI. Web platform. |
| e | **Graph delegated permissions + admin consent** | `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`, `Chat.Read`/`Chat.ReadWrite`, `offline_access`. **The read scopes need a TENANT ADMIN to click "Grant admin consent"** (the founder for his tenant; each client firm's IT for theirs). **This is the single biggest external gate.** Send-only/chats-only works without it (degraded mode). |
| f | **RSA encryption certificate** (public + private) | For rich (`includeResourceData`) notifications, with a rotation plan; private key in MatterChat secrets. Only needed when webhooks are turned on (M3). |
| g | **Public HTTPS webhook endpoint** | The MatterChat host must be internet-reachable for `/_teams/notifications` + `/_teams/lifecycle`, unauthenticated, *when webhooks are enabled*. Confirm staging ingress exposes `/_teams/*` without VPN-only restriction. (Staging is already public.) |

**Recommended infra (either provider):** a durable queue (existing Meteor job runner or Redis) for async webhook processing + per-user send rate limiting at ≤1 msg/s.

---

## 6. The parallel build plan

### 6.1 Workstreams + dependency order

Ship the **interface as a tiny types-only PR first** (hours, not days). Once its types land, the other five run truly in parallel — each on its own feature branch + **git worktree** (per the concurrent-sessions rule: spawned chips share the main checkout, so use `git worktree` per stream).

```
WS-0  Shared abstraction / ChatProvider interface  ── GATES everything (types only)
        │
        ├── WS-1  SlackProvider (wrap existing SlackBridge)        [parallel]
        ├── WS-2  TeamsProvider — Graph auth (OAuth/PKCE + tokens) [parallel]
        ├── WS-3  TeamsProvider — Graph message bridge            depends on WS-2
        ├── WS-4  Switcher UI (de-stub useOrgSwitcher + add-flow)  [parallel, binds WS-5 read API]
        └── WS-5  Per-user connection storage / REST              [parallel, provides WS-4's API]
```

**Dependency truth:**
- WS-0 blocks all (everyone imports its types). Keep it pure-interface → lands same-day.
- WS-1, WS-2, WS-4, WS-5 are mutually independent after WS-0.
- WS-3 needs WS-2's token store + Graph client (auth before you can call Graph). Within the Teams track: WS-2 then WS-3; the **whole** Teams track runs parallel to Slack + UI + storage.
- WS-4↔WS-5 share a thin contract (the "list my connections" read endpoint + the "start connect" action). **Freeze both endpoint shapes in WS-0** so UI codes against a mock until WS-5's endpoint lands, then flips.

### 6.2 Per-workstream: files, effort, control

| WS | Scope | Key files | Effort | Founder gate |
|---|---|---|---|---|
| **WS-0** | `ChatProvider` interface, `ProviderRegistry`, `IExternalConnection`; extend `SwitchableOrg.type` union in one place; generalize `litboxCrypto`→`tokenCrypto`; generalize the `useRoomList` filter | `app/external-workspaces/lib/ChatProvider.ts`, `app/external-workspaces/server/{ProviderRegistry,tokenCrypto}.ts`, `packages/core-typings` additions | **S** (hours) | none |
| **WS-1** | SlackProvider as thin adapter over `SlackBridge`; add `connectOne()` to `slackbridge.ts`; keep settings path | `app/external-workspaces/providers/SlackProvider.ts`, small edit to `app/slackbridge/server/slackbridge.ts` | **M** (~2–3d; risk = the `@ts-nocheck` adapter) | none for workspace-level |
| **WS-2** | Teams OAuth2 auth-code+PKCE; Graph client w/ refresh; clone `/_omnisai` route pattern; token store via `tokenCrypto` | `app/external-workspaces/providers/teams/{TeamsAuth,graphClient,routes}.ts` | **L** (~4–5d) | **BLOCKED on Azure prereqs §5 a–e** (scaffold vs mock now) |
| **WS-3** | Read (`/joinedTeams`, `/channels`, `/messages`) → rooms + `importIds`; post; real-time (polling first, webhooks/subscription lifecycle + renewal cron after); Graph user→RC ghost/alias | `app/external-workspaces/providers/teams/{TeamsBridge,subscriptions,notifications,lifecycle}.ts` | **L** (~5–6d) | webhooks need RSA cert §5f + public endpoint §5g |
| **WS-4** | De-stub `useOrgSwitcher`; `ProviderMark` + `TeamsMark`; real `switchOrg`/`addWorkspace` connect modal | `client/views/root/MainLayout/{useOrgSwitcher.ts,OrgSwitcherRail.tsx}` | **M** (~2–3d) | none |
| **WS-5** | `external_connections` collection + model + `IExternalConnection`; REST `external-workspaces.{list,connect,disconnect}` (RC `API.v1.addRoute`); token encryption | `packages/models/src/models/ExternalConnections.ts`, `app/external-workspaces/server/api.ts` | **M** (~2–3d) | none |

### 6.3 What we reuse vs build (do-not-rebuild discipline)

**Reuse / lift unchanged (MIT):**
- The entire RC-write side of `RocketAdapter.ts` → becomes `BridgeCore` with `SlackAdapter` calls swapped for `provider.*`.
- `importIds` model methods; `slackTs`/`Messages.findOneBySlackTs` (rename to `externalTs` over time, keep alias).
- `SlackAPI.ts` + `SlackAdapter.ts` whole — they *become* `SlackProvider`.
- The org-switcher rail/context/provider/hook scaffolding from `auto/slack-switcher-complete`.
- `litboxCrypto.ts` (AES-256-GCM) + the `/_omnisai` PKCE OAuth-dance route pattern.

**Net-new:**
- `app/external-workspaces/` package (interface, `BridgeCore`, `ProviderRegistry`, `TeamsProvider`).
- `external_connections` collection + `IExternalConnection` + `IRoom.externalSource` typing.
- Teams Graph client, OAuth routes, subscription lifecycle, notification decryption.
- OAuth callback routes + the "Connect a workspace" UI (the `addWorkspace()` stub is where it lands).

### 6.4 Milestones (MVP → full)

- **M0 — Foundation** (1 short PR, gates everything): WS-0 interface + `ProviderRegistry` + `IExternalConnection`; `litboxCrypto`→`tokenCrypto`; generalize the `useRoomList` filter from hard-coded `'slack'` to "selected external connection". Land on the integration base, then all streams branch into worktrees.
- **M1 — MVP: CONNECT + READ.** Slack: WS-1 surfaces the existing workspace bridge through the provider; selecting the Slack tile filters to bridged channels (already wired). Teams: WS-2 (auth) + WS-3 read-only via **polling** + WS-4 connect modal + WS-5 storage/list endpoint. *Exit:* a user connects one Teams org and reads its channels inside MatterChat. *Needs founder Azure prereqs §5 a–e.*
- **M2 — POST.** Outbound to the external org (Slack reuse `SlackBridge_Out_*`; Teams `POST .../messages`). Per-user posting attributes to the real person. *Exit:* a reply from MatterChat lands in Slack/Teams.
- **M3 — REAL-TIME (Teams).** Turn on Graph change-notifications + the T-12h renewal cron + `missed`-backfill (needs RSA cert §5f + public endpoint §5g) — or keep tuned polling. Slack is already real-time (Socket Mode). *Exit:* a message sent in Teams appears in MatterChat within seconds, no refresh.
- **M4 — Multi-provider hardening.** Per-user Slack OAuth (retrofit to match Teams), multiple connections per user in the rail, multi-tenant Teams (client firms bring their own M365 + admin consent), token-refresh resilience, disconnect/reconnect UX, unread/mention badges on tiles, `EXTERNAL_TOKEN_ENC_KEY` enforced in prod. *Exit:* an attorney runs native MatterChat + their own Slack + their own Teams from one rail, each scoped to them.

### 6.5 Effort + critical path

Total **~3–5 weeks** wall-clock if the five streams run in parallel after M0 (~2–3 days solo). The **critical path is the Teams track (WS-2 → WS-3) plus your Azure app registration + admin-consent turnaround** — the real schedule risk is the consent/registration, not the code.

### 6.6 Open questions to resolve at kickoff (engineering, not founder-blocking)

- **Branch base:** `auto/slack-switcher-complete` vs `feature/matterchat-org-switcher` vs `develop` are tangled. Fix the single integration base **before** fan-out to avoid merge hell. (Org-switcher + the `importIds` filter live on `auto/slack-switcher-complete`, *not* `develop`.)
- **Storage shape:** dedicated `external_connections` collection (recommended — clean multi-connection + workspace scope) vs an array on the user doc. Pick before WS-5 starts.
- **Channels-first vs DMs:** recommend channels-first (the `ChannelMessage.*` path); DMs add `Chat.*` + `/chats` subscriptions and a different room mapping.
- **Reaction / edit / delete two-way sync** in v1, or inbound-display-only first? Full bidirectional reactions need the echo-suppression map (SlackBridge has known edge cases).
- **Identity collision:** how to reconcile a ghost Teams user with a real MatterChat user who later connects the same external account (merge vs relink).
- **Native-tile behavior:** `'current'` should HIDE external rooms (true isolation) — confirm the inverse filter.

---

## 7. Hard limits & gotchas — one-page checklist

- **Teams: delegated only.** App-only can't post as a human (migration-mode only).
- **Use `/organizations`, not `/common`** (personal MSAs unsupported by Teams scopes).
- **Per-channel resource, not `getAllMessages`** (delegated-capable; firehose is app-only + old metering).
- **Metering on our path is OFF** (Aug 25, 2025). Webhooks are an infra dependency, not a billing one.
- **One subscription per (tenant, channel)** shared across users; 3-day max lifetime; **renew at T-12h**; `lifecycleNotificationUrl` mandatory; handle **`missed`** for losslessness.
- **Validation handshake**: 200 + token as text/plain within 10s. **Verify `validationTokens` JWT + `clientState`** before trusting any payload. Return **202 fast, process async.**
- **Throttle**: ≤1 msg/s/user POST; honor `Retry-After`, backoff+jitter fallback (some endpoints omit it).
- **Refresh-token death** → detect `invalid_grant`, mark `needs-reconnect`, notify in RC.
- **B2C / External-ID tenants**: no change notifications → force polling.
- **Degraded consent mode**: read scopes need external-admin consent; send/DM scopes don't. Ship send-only/chats-only + an admin-consent request link.
- **Never touch `apps/meteor/ee/`** (proprietary). All work in MIT `apps/meteor/app/`.
- **Re-namespace RC message IDs** `ext-<connectionId>-<channelExternalId>-<ts>` so loop-prevention holds across providers/connections.
- **Echo suppression**: tag outbound-originated messages so the inbound webhook for your own POST doesn't re-insert them (dedupe by external message id); keep a reactions map to stop RC↔external reaction bouncing.