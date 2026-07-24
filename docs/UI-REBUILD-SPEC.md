# MatterChat — UI Build & Extension Spec

> **Audience:** the frontend dev team (human or AI) building out MatterChat's new UI.
> **Goal:** give you a complete map of what MatterChat is, how the frontend talks to the
> backend, every screen that already exists, every backend capability you can build on, and a
> clear, low-risk playbook for adding new UI without breaking upgrades.
>
> Read §0 → §4 first (orientation + the golden rule). §5–§9 are the reference inventories.
> §10–§12 are the "how to actually build" playbook. §13 is the screenshot plan.

---

## 0 · TL;DR — the five things to internalize

1. **MatterChat is a fork of Rocket.Chat.** Web = a Meteor/React app; Mobile = a React Native
   app (fork of Rocket.Chat.ReactNative); Desktop = a thin Electron shell around the hosted web
   app. We own the **source** of all three, so UI customization is effectively **unlimited**.
2. **The cost of customization is upgrade divergence, not capability.** Every edit to an
   *upstream* file is a future merge-conflict when we pull Rocket.Chat's security patches. Every
   file we *add* is basically free. Design accordingly (§4).
3. **The frontend talks to the backend two ways:** a real-time **DDP/WebSocket** stream (Meteor
   methods + live subscriptions) and a **REST API** (`/api/v1/*`). Auth is a login token +
   user id. You rarely hand-roll network code — there are typed SDK hooks/wrappers on both apps.
4. **There's a real design-token system** (`@rocket.chat/fuselage` on web; a semantic color map
   with light/dark/black themes on mobile). Reskinning = changing tokens, not hunting hex codes.
5. **"Chi" is our flagship custom surface** (the AI assistant orb). It is the reference example
   of the right way to extend: a self-contained module that rides on top of the fork. Copy that
   pattern.

---

## 1 · What MatterChat is (product + lineage)

MatterChat is OmnisAI's team-chat product — a **Rocket.Chat fork** re-branded and extended for
Omnis's vertical (legal/professional workflows) and wired to **Chi**, our AI assistant. It ships
on three surfaces that all talk to the same backend:

| Surface | Repo | Tech | Relationship to backend |
|---|---|---|---|
| **Web app** | `OmnisAIOrg/MatterChat` | Meteor + React (`apps/meteor`) | Is the backend + the web client |
| **Mobile app** | `OmnisAIOrg/MatterChat-Mobile` | React Native (fork of Rocket.Chat.ReactNative) | Client → connects to a workspace server |
| **Desktop app** | `OmnisAIOrg/MatterChat-Desktop` | Electron | Thin shell that loads the hosted web app + adds a native Chi window |
| **Chi standalone** | `OmnisAIOrg/Chi-Desktop` | Electron | The Chi orb as its own app (local LLMs / personal subscriptions) |
| **Chi MCP tools** | `OmnisAIOrg/matterchat-mcp-v2` | Node | Deterministic tool server Chi calls (boards/chat tools) |

**Production:** `https://app.matterchat.com` (web). **Staging:** `matterchat.stg-omnisai.io`.
**Branding is done** on onboarding/login/icon/splash (green ensō, "MatterChat" wordmark). The
internal RN module name `RocketChatRN` and the iOS bundle id `chat.rocket.ios` are the last
"rocket" identifiers — see §14 for why they're intentionally unchanged (for now).

---

## 2 · Repos & how to run each

**Web (`MatterChat/apps/meteor`)** — Meteor monorepo (Yarn workspaces, `apps/meteor` is the app;
`packages/*` are shared libs incl. fuselage). Source of truth is the **`staging`** branch (it
auto-deploys). No per-PR previews. The whole Chi feature lives here under
`apps/meteor/client/omnis/` + `apps/meteor/server/lib/chi/` + `apps/meteor/public/omnis-widgets/`.

**Mobile (`MatterChat-Mobile`)** — RN app on branch `matterchat`. `app/views/*` = screens,
`app/containers/*` = reusable UI, `app/lib/*` = data/SDK/methods, `app/stacks/*` = navigation.
Run: `pnpm install` (via corepack), `pnpm start` (Metro), then build in Xcode / `xcodebuild`.
iOS build has quirks (fmt/consteval patch, ad-hoc signing) — documented in the repo.

**Desktop (`MatterChat-Desktop`)** — Electron; `serverUrl` = the hosted web app. Adds the native
always-on-top Chi window + global shortcuts.

Every app is a normal checkout you can edit end-to-end. Nothing is a black box.

---

## 3 · Architecture — how the frontend talks to the backend

Both clients use **two** channels against the same server:

### 3a. Realtime — DDP over WebSocket (Meteor)
The primary channel. The client opens a persistent WebSocket, **calls server methods**
(`Meteor.call('methodName', ...)`) and **subscribes to live data** (rooms, messages, presence,
typing). New messages, edits, reactions, read receipts, presence all arrive as live pushes — you
don't poll. On mobile this is wrapped by the SDK in `app/lib/services/` + a local **WatermelonDB**
cache (rooms/messages are stored offline and reconciled). On web it's the Meteor client +
React-Query-style hooks.

### 3b. Request/response — REST (`/api/v1/*`)
For everything action-shaped (post a message, create a channel, upload a file, admin ops, and all
of Chi). Auth headers: `X-Auth-Token` (login token) + `X-User-Id`. ~70 endpoint modules (§8).

### 3c. Auth
Login → a **login token** + **user id**, persisted client-side. Mobile injects these into the Chi
WebView's localStorage so the orb's REST calls run as the member (same mechanism the desktop Chi
window uses). SSO/OAuth via CentralizedAuth is wired for the Chi standalone app (§9).

### 3d. Data model (know these nouns)
`Users`, `Rooms` (channels `c` / private groups `p` / DMs `d` / discussions / teams / livechat),
`Subscriptions` (a user's membership+unread state per room), `Messages`. Plus Omnis-custom:
**Boards** (Kanban/CRM "matters"), **Firms** / **cross-firm** (multi-tenant), **Docs**, **Media
calls**. Changing *how these work* is the expensive tier (§4); changing how they **look** is cheap.

---

## 4 · The customization strategy (THE most important section)

Three tiers, cheapest → most powerful. **Bias toward the top two.**

### Tier 1 — Config / white-label (free, survives every upgrade)
Rocket.Chat ships a theming layer: logo/favicon assets, a color palette, app name, and **custom
CSS**, all from **Admin → Layout / Settings**. Use this for brand colors, logos, wordmarks, and
small cosmetic tweaks. Zero merge risk.

### Tier 2 — Additive modules (heavy customization, near-zero upgrade cost) ⭐ **default here**
Anything built as **our own files** alongside the fork: new screens, new components, new pages,
new REST endpoints. Because they're not edits to upstream files, they almost never conflict on
upgrade. **The entire Chi experience is Tier 2** and is the reference implementation:
- Web orb: `apps/meteor/public/omnis-widgets/chi-orb.js` (zero-dep web component)
- Web mount: `apps/meteor/client/omnis/widgets/ChiOrbMount.tsx`
- Mobile Chi: `app/views/ChiOrbView/` + `chi-mobile.html/js` (served page) + `ChiFab` button
- Backend: `apps/meteor/server/lib/chi/` + `app/api/server/v1/chi.ts`

New signature screens should follow this: build them as owned modules, hang them off a route or a
button, and keep them out of upstream files.

### Tier 3 — Editing upstream screens (unlimited, but taxed)
Restyling or restructuring Rocket.Chat's own screens (chat list, room view, message bubbles,
composer, login). Fully possible and sometimes necessary — we already restyled onboarding/branding.
The tax: each edited upstream file is a merge-conflict surface on the next upstream pull. Do it
deliberately, keep edits localized, and prefer overriding a component over rewriting a screen.

### The golden rule
> **Reskin via tokens (Tier 1). Build new things as owned modules (Tier 2). Edit upstream
> screens only where it truly matters (Tier 3).** This keeps us pulling Rocket.Chat's security
> patches while looking and feeling 100% like MatterChat.

### Where cost genuinely spikes (approach with care)
The **data + protocol layer**: the message model, rooms/subscriptions, DDP sync, and the core
message-rendering engine. Reskin these freely; **re-architecting** them is expensive and
conflict-heavy. If a future product needs to work fundamentally unlike chat, that's the point to
build fresh on the REST API rather than fork deeper.

---

## 5 · Design system

### Web — `@rocket.chat/fuselage`
The web app is built on Rocket.Chat's own component library + design tokens (`packages/fuselage`,
`packages/ui-*`). Components (`Box`, `Button`, `Modal`, `Tabs`, message primitives, etc.) consume
**theme tokens**, and there's light/dark theming. Reskin by overriding token values and the
palette rather than restyling components individually. Custom CSS is available for the long tail.

### Mobile — semantic color map with 3 themes
`app/lib/constants/colors.ts` defines **light / dark / black** themes over a **semantic** token
set (not raw hex at call sites). Categories: `surface*` (backgrounds), `stroke*` (borders/lines),
`font*` (text), plus status/accent colors. Components read `useTheme().colors`. **To reskin the
whole app: change these token values.** Sample of the light palette:

```
surfaceLight #FFFFFF   surfaceTint #F7F8FA   surfaceRoom #FFFFFF   surfaceNeutral #E4E7EA
strokeLight  #CBCED1   strokeHighlight #156FF5  strokeError #EC0D2A
fontTitlesLabels #1F2329  fontDefault #2F343D  fontSecondaryInfo #6C727A  fontInfo #095AD2
```

**MatterChat brand colors** to fold in: ensō green `#2FA44A` (accent), the darker green
`#148B3B`, brand red `#E1053C` (from the wordmark). Recommend mapping the primary
action/highlight tokens to the green.

**Typography:** system font stack today (SF/Helvetica). If we want a brand typeface, it's a token
+ font-loading change, not per-screen edits.

---

## 6 · Screen inventory — WEB app

Web views live in `apps/meteor/client/views/`. Grouped by area. **★ = Omnis-custom** (ours to
change freely, Tier 2); everything else is stock Rocket.Chat (Tier 3 to restyle).

| Area | What it is | Notes |
|---|---|---|
| `root` | App shell, main layout, left rail, routing | Mounts `<ChiOrbMount/>` ★ |
| `home` | Home/landing, "Desktop apps" card ★ | Post-login landing |
| `room` | The message view: header, message list, composer, threads, actions | Core; restyle = Tier 3 |
| `rooms` | Rooms list / sidebar search | Core |
| `composer` | Message composer primitives | Core |
| `account` | User account & preferences (profile, security, notifications, themes) | Core |
| `admin` | Full admin panel (see below) | Core + ★ sections |
| `directory` | Directory of channels/users/teams | Core |
| `teams` | Teams | Core |
| `marketplace` | Apps marketplace | Core |
| `omnichannel` | Livechat/omnichannel agent UI | Core |
| `boards` ★ | Kanban/CRM "matters" boards | Omnis vertical feature |
| `firms` ★ / `cross-firm` ★ | Multi-tenant firm workspaces + cross-firm | Omnis |
| `litbox` ★ | Litigation workspace | Omnis |
| `docs` ★ | Documents | Omnis |
| `mediaCallHistory` ★ | Media/video call history | Omnis |
| `conference` / `mediaCall` | Video conferencing | Core+ |
| `oauth` / `cloud` / `invite` / `mailer` / `updates` / `banners` / `e2e` / `audit` / `pwa` / `notAuthorized` / `notFound` | Auth flows, cloud, invites, email, update prompts, banners, E2E encryption, audit log, PWA, error pages | Core |

**Admin panel sections** (`client/views/admin/`): `settings`, `users`, `permissions`, `rooms`,
`integrations`, `oauthApps`, `import`, `emailInbox`, `moderation`, `engagementDashboard`,
`deviceManagement`, `customEmoji`, `customSounds`, `customUserStatus`, `featurePreview`,
`invites`, `mailer`, `subscription`, `viewLogs`, `workspace`, **`ABAC` ★** (attribute-based
access control — Omnis). Chi settings live under **Admin → Settings → Chi Assistant**.

---

## 7 · Screen inventory — MOBILE app

RN screens live in `app/views/`. ~70 screens. Registered in `app/stacks/InsideStack.tsx`
(inside/authed) and `OutsideStack.tsx` (auth flow). **★ = Omnis-custom.**

**Onboarding / auth (OutsideStack):** `NewServerView` (Add Workspace — **rebranded**),
`WorkspaceView` (workspace card), `LoginView`, `RegisterView`, `ForgotPasswordView`,
`SendEmailConfirmationView`, `SetUsernameView`, `LegalView`, `AuthenticationWebView`,
`SelectServerView`, `AuthLoadingView`.

**Core chat (InsideStack / ChatsStack):** `RoomsListView` (chat list — hosts **`ChiFab` ★**),
`RoomView` (messages + composer), `RoomActionsView`, `RoomInfoView`, `RoomInfoEditView`,
`RoomMembersView`, `SearchMessagesView`, `ThreadMessagesView`, `MessagesView`, `ForwardMessageView`,
`DiscussionsView`, `TeamChannelsView`, `ReadReceiptView`, `NewMessageView`, `SelectedUsersView`,
`CreateChannelView`, `CreateDiscussionView`, `AddChannelTeamView`, `AddExistingChannelView`,
`DirectoryView`, `AttachmentView`, `AutoTranslateView`, `NotificationPreferencesView`.

**Chi ★:** `ChiOrbView` (WebView hosting the server-side "C into B" orb page).

**Settings / account:** `SettingsView`, `ProfileView`, `UserPreferencesView`,
`UserNotificationPreferencesView`, `DisplayPrefsView`, `ThemeView`, `LanguageView`,
`AccessibilityAndAppearanceView`, `MediaAutoDownloadView`, `DefaultBrowserView`,
`SecurityPrivacyView`, `E2EEncryptionSecurityView` (+ E2E enter/save/how-it-works),
`ScreenLockConfigView` / `ScreenLockedView` / `ChangePasscodeView`, `ChangePasswordView`,
`ChangeAvatarView`, `StatusView`, `AdminPanelView`, `PushTroubleshootView`, `GetHelpView`.

**Livechat/omnichannel:** `CannedResponsesListView`, `CannedResponseDetail`, `LivechatEditView`,
`ForwardLivechatView`, `CloseLivechatView`, `ReportUserView`.

**Calls/misc:** `CallView`, `JitsiMeetView`, `PickerView`, `ModalBlockView`, `SidebarView`,
`ShareView` / `ShareListView` (share extension).

**Reusable containers** (`app/containers/`): `MessageComposer`, `RoomItem`, `RoomHeader`,
`Avatar`, `Header`, `List`, `Button`, `TextInput`, `Chip`, `ActionSheet`, `EmojiPicker`,
`AudioPlayer`, `ImageViewer`, `MessageActions`, `ReactionsList`, `Toast`, `InAppNotification`,
`LoginServices`, `SearchBox`, `Status`, `TabView`, etc. **Restyle these once → the change
propagates everywhere.** This is the highest-leverage place to reskin mobile.

---

## 8 · Backend capabilities — REST API surface

`apps/meteor/app/api/server/v1/` — ~70 modules. This is the menu of what the UI can already do
(and what new UI can call). **★ = Omnis-custom.**

**Messaging & rooms:** `chat` (post/update/react/pin/star/report), `channels`, `groups`, `im`
(DMs), `rooms`, `subscriptions`, `teams`, `chat` threads/discussions, `uploads`, `webdav`,
`autotranslate`, `commands` (slash commands), `emoji-custom`, `custom-sounds`,
`custom-user-status`.

**Users & auth:** `users`, `roles`, `permissions`, `e2e`, `ldap`, `oauthapps`, `presence`,
`external-workspaces`.

**Calls & media:** `videoConference`, `media-calls` ★, `call-history` ★.

**Omnis vertical ★:** **Boards** (a whole suite — `boards`, `boards-ai`, `boards-automations`,
`boards-calendar-sync`, `boards-export-import`, `boards-forms`, `boards-invite-guests`,
`boards-leads`, `boards-matters`, `boards-notification-preferences`, `boards-notifications`,
`boards-reports`, `boards-subtasks`, `boards-views`), `firms` ★, `cross-firm` ★, `firm-feed` ★,
`docs` ★, `rooms-legal-hold` ★, `calendar`, `outlookCalendar`.

**Chi (AI) ★:** `chi` — endpoints: `chi.ask`, `chi.realtime-session`, `chi.transcribe`,
`chi.transcription-config`, `chi.prefs`, `chi.session-exchange` (§9).

**Ops/infra:** `settings`, `assets`, `stats`, `instances`, `cloud`, `import`, `integrations`,
`invites`, `banners`, `moderation`, `email-inbox`, `mailer`, `sms`, `push`, `webpush`,
`connection`, `misc`.

**Takeaway for the FE team:** most "new feature" UI does **not** need new backend — the capability
usually already exists as an endpoint or a DDP method. Check here first.

---

## 9 · Chi (the AI assistant) — the flagship custom surface

Chi is the differentiator. Study it as the model for how we extend MatterChat.

**Surfaces:** web orb (in-app + Document-PiP popout), desktop native window, **mobile "C into B"
page**, and a standalone desktop app. All share the `chi-orb.js` web component.

**Mobile "C into B"** (`public/omnis-widgets/chi-mobile.html` + `chi-mobile.js`), loaded by
`ChiOrbView`'s WebView:
- **State C** — a half-sheet over the chat list (ensō, last reply, action chips, "Ask Chi
  anything…" input + mic).
- **State B** — full-screen voice-first (breathing ensō, live captions, chips, big mic). Swipe up
  from C / tap mic to expand; swipe down to collapse.

**Endpoints** (`app/api/server/v1/chi.ts`):
- `POST chi.ask` — a text turn through Chi's brain (tool-loop; returns reply + navigate actions +
  confirm/park state). Runs with the caller's own permissions.
- `POST chi.realtime-session` — mints a short-lived ephemeral OpenAI Realtime token (server holds
  the real key). Voice uses WebRTC + a data-channel tool loop. **Do not touch the voice wiring.**
- `POST chi.transcribe` / `GET chi.transcription-config` — server-proxied speech-to-text (keys
  server-held, never in the browser).
- `GET/POST chi.prefs` — per-user model override + connector toggles.
- `POST chi.session-exchange` — CentralizedAuth→MatterChat session bridge (for the standalone Chi
  app). Default **off**; enable in admin.

**Admin settings** (Admin → Settings → Chi Assistant): provider + key + model (OpenAI, Anthropic,
Groq, Cerebras, OpenRouter, xAI, DeepSeek, Gemini, and **local**: Ollama / LM Studio / llama.cpp),
realtime voice (key/model/voice), STT (`Chi_STT_*`), MCP connectors (`Chi_MCP_*` — signed member
assertions), session-exchange (`Chi_Session_Exchange_*`). Full detail: **`docs/CHI-ASSISTANT.md`**.

**Integration points for new UI:** the orb emits/consumes custom events (`chi-*`), reads/writes
`chi-*` localStorage keys, and on mobile relays `chi:navigate` / `chi:close` to the native host via
`postMessage`. New Chi entry points = add a button that navigates to `ChiOrbView` (web: dispatch
`chi:summon`).

---

## 10 · What's ours vs. upstream (so you know what's safe to change)

- **100% ours (change freely):** everything under `client/omnis/`, `server/lib/chi/`,
  `public/omnis-widgets/`, the `boards*`/`firms`/`cross-firm`/`docs`/`litbox`/`media-call`/`ABAC`
  views + endpoints, and on mobile: `ChiOrbView`, `ChiFab`, and any new view you add.
- **Upstream Rocket.Chat (restyle carefully, Tier 3):** `room`, `rooms`, `composer`, `account`,
  most of `admin`, the core `app/views/*` chat/settings screens on mobile, and the shared
  containers.
- **Do not rename / re-architect:** the RN module name `RocketChatRN`, the DDP protocol layer, the
  message/subscription data model (§14).

---

## 11 · How to add new UI — the playbook (worked example)

Adding the mobile Chi entry point took ~4 small, upgrade-safe steps — use it as the template:

1. **Build the surface as an owned module.** New screen → `app/views/YourView/` (mobile) or a new
   `client/omnis/` component / `public/omnis-widgets/` page (web).
2. **Register a route.** Mobile: add to the relevant stack in `app/stacks/InsideStack.tsx` + add
   the type to `app/stacks/types.ts`. Web: add to the router.
3. **Add an entry point.** A button/list-item that navigates to it (e.g. `ChiFab` on the chat
   list; web `chi:summon`). Prefer adding an owned component into an existing container over
   editing the container's guts.
4. **Talk to the backend via the existing channels** (§3): a REST endpoint (`/api/v1/*`) or a DDP
   method — usually the capability already exists (§8). Reuse the app's SDK hooks; don't hand-roll
   fetch/auth.
5. **Theme via tokens** (§5), never hardcoded hex.

**Anti-patterns:** rewriting a whole upstream screen when a token change or a wrapping component
would do; hardcoding colors; new bespoke network code when an SDK hook exists; putting custom
logic inside upstream files instead of beside them.

---

## 12 · Reskin opportunities & where to add stuff (idea backlog)

- **Full brand pass:** map primary/action/highlight tokens to MatterChat green across both apps;
  restyle `LoginView`, `RoomsListView` rows, `RoomHeader`, composer, and the tab bar. (Tier 1
  tokens + light Tier 3.)
- **Signature home / dashboard** (Tier 2): an owned landing surfacing Chi, boards/matters, and
  activity — instead of the stock home.
- **Chi everywhere:** contextual Chi actions in `RoomView` (summarize thread, draft reply),
  boards, and docs — all `chi.ask` calls behind owned buttons.
- **Boards/matters mobile UI** (Tier 2): the boards suite has a rich backend (§8) but is
  web-first; a native mobile boards view is greenfield.
- **Onboarding polish** (Tier 3, low-risk): we already own the branding on `NewServerView`.
- **Notifications-in-Chi**, **Flow dictation**, **on-device Whisper** are already built (see
  `docs/CHI-ASSISTANT.md`) — extend rather than rebuild.

---

## 13 · Screenshots — capture plan

The pre-login flow is captured and current (post-rebrand):
- App icon (home screen), launch splash, **Add Workspace** (MatterChat lockup), **Workspace card**,
  **Login** form. (These accompany this doc.)

The logged-in set (chat list + Chi button, room view, composer, Chi orb C & B states, settings,
account, boards, admin, directory, threads) needs an **authenticated session**. Two options:
1. Sign in once on the simulator/web and I capture the full set screen-by-screen (fastest, ~30
   screens), or
2. The FE team captures them against their own login.

The complete **list** of screens to shoot is §6 (web) and §7 (mobile) — every row is one screen.
Recommend one light-theme and one dark-theme pass so the team sees the token system in action.

---

## 14 · Constraints & gotchas (the don't-break list)

- **Never touch the realtime voice/mic wiring** in `chi-window.js` / `chi-mobile.js` (WebRTC +
  data-channel tool loop). It was hard-won; extend around it.
- **`RocketChatRN`** (RN module name, `app.json` "name") must stay — renaming breaks native
  registration. User-facing name is already "MatterChat" (`displayName`).
- **iOS bundle id `chat.rocket.ios`** is the last "rocket" identifier; it becomes the App Store
  App ID. Change it **once**, deliberately (proposed: `com.omnisai.matterchat`), tied to Apple
  enrollment — not casually.
- **i18n:** rebrand display **values**, never the **keys** (keys are code-referenced). Example:
  the key `Allow_push_notifications_for_rocket_chat` stays; its value is "…MatterChat".
- **Upgrade divergence:** every upstream-file edit is a future merge cost. Track them; prefer
  Tier 1/2 (§4).
- **Deploy model:** push to `staging` → auto-deploy; production is a separate promote. No per-PR
  previews. QA on staging.
- **Data/protocol layer** (DDP, message/subscription model) is the expensive tier — reskin, don't
  re-architect.

---

## 15 · Reference docs

- `docs/CHI-ASSISTANT.md` — full Chi feature inventory, admin runbook, roadmap.
- This file — UI build & extension spec.
- Repo READMEs per app for build/run specifics.

---

*Bottom line: MatterChat gives you a full-featured, battle-tested chat backend + three client
apps you own the source of. Reskin via tokens, build signature features as owned modules (Chi is
the model), and edit upstream screens sparingly. That's how we make it unmistakably MatterChat
while still pulling Rocket.Chat's ongoing security and feature updates.*
