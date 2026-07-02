# MatterChat — Developer Onboarding

> Hand this to anyone in the org who's going to build on MatterChat. It takes you from zero →
> running it locally → making your first change → knowing where everything lives → and the
> fork-specific traps that will otherwise eat a day. ~30–60 min to a running instance.

---

## 1. What you're building

**MatterChat = "Slack + Trello for the legal niche"** (an OmnisAI suite product). It's ONE app with two halves on one codebase:

- **The "Slack" half** — a fork of **Rocket.Chat** (chat, channels, DMs, teams, search, threads). This is the comms baseline; it comes with the fork.
- **The "Trello" half** — **Omnis Boards**, a kanban + pipeline feature *we* built natively inside the fork: a **Leads/Intake pipeline**, a **Matters pipeline**, an automation engine, and reporting. It is native Rocket.Chat code (React/Fuselage views + Meteor methods/REST + MongoDB collections) — NOT a separate app.
- **The "Fusion" layer** — the tie-ins that make it feel like one product: a Slack-style left rail, a "My Day" home, an org Team roster, Trello-grade cards, and turning a chat message into a task card.

The **legal angle** comes from the **CasePro CRM integration**: Matters/Leads mirror CasePro records (stages, statute-of-limitations dates, demand/settlement amounts) as read-through snapshots.

> ⚠️ It is a **Rocket.Chat fork**, so it does **NOT** use the OmnisAI shared `@OmnisAIOrg/component-library-new`. The UI is built with Rocket.Chat's own **Fuselage** design system. Don't try to import the shared component library here.

---

## 2. Get the code

```bash
git clone https://github.com/OmnisAIOrg/MatterChat.git
cd MatterChat
git checkout feature/omnis-boards     # all the Omnis Boards + Fusion work lives here
```

- Active branch: **`feature/omnis-boards`** (base = **`develop`** — this fork has NO `staging-*` branches like other OmnisAI products).
- The app itself is the **`apps/meteor`** workspace inside the monorepo. ~95% of your work happens under `apps/meteor`.
- Open PR: **#1** (`feature/omnis-boards` → `develop`).

---

## 3. Prerequisites (toolchain)

This is a Rocket.Chat 8.6 monorepo (Yarn 4 workspaces + Turborepo, Meteor app). You need:

| Tool | Version (known-good) | Install |
|---|---|---|
| **Node** | 22.x (22.22.3) | `nvm install 22 && nvm use 22` |
| **Yarn** | 4.x (4.12) | `corepack enable` (Yarn version is pinned by the repo) |
| **Deno** | 2.x (2.3.1) | `curl -fsSL https://deno.land/install.sh \| sh` |
| **Meteor** | **3.4.1** | `npx meteor@3.4.1` or `curl https://install.meteor.com/?release=3.4.1 \| sh` |
| **MongoDB** | 5–7 ideal (8.x works with a flag, see §4) | Homebrew / Docker |

> Verify exact versions against the repo: Node from `.nvmrc`/`package.json` `engines`, Meteor from `apps/meteor/.meteor/release`, Yarn from `package.json` `packageManager`.

Then install JS deps from the repo root:

```bash
corepack enable
yarn        # installs all workspace deps (takes a while the first time)
```

---

## 4. MongoDB — a replica set is REQUIRED

Rocket.Chat needs the **oplog**, so a single-node mongod will **not** boot. Run a dedicated replica-set mongod (separate from any plain :27017 mongo you already have):

```bash
mkdir -p ~/matterchat-mongo
mongod --dbpath ~/matterchat-mongo --replSet rs0 --port 27018 --bind_ip 127.0.0.1 &
# initiate the replica set ONCE:
mongosh --port 27018 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})'
```

- `--fork` is unsupported on macOS — run it as a background process (`&`).
- Local Mongo 8.x is newer than RC's officially-supported 5–7. If boot complains, set `BYPASS_OPLOG_VALIDATION=true` (see §5).

---

## 5. Run it locally — two paths

### Path A (recommended): production bundle on :3100
This is the **stable** way to run it and what we test against. Dev mode (`yarn dev`) has a flaky http-proxy bug (`ERR_STREAM_WRITE_AFTER_END`) that only affects dev.

```bash
# 1. prebuild the workspace deps (also runs the i18n codegen — see §8)
yarn build --filter=@rocket.chat/meteor^...

# 2. build the server bundle
cd apps/meteor
METEOR_DISABLE_OPTIMISTIC_CACHING=1 meteor build --server-only --directory /tmp/matterchat-prod

# 3. install the bundle's server deps
cd /tmp/matterchat-prod/bundle/programs/server && npm install && cd /tmp/matterchat-prod/bundle

# 4. run it
export MONGO_URL="mongodb://127.0.0.1:27018/matterchat_prod?replicaSet=rs0"
export MONGO_OPLOG_URL="mongodb://127.0.0.1:27018/local?replicaSet=rs0"
export ROOT_URL="http://localhost:3100"
export PORT=3100
export BYPASS_OPLOG_VALIDATION=true
export OVERWRITE_SETTING_Accounts_TwoFactorAuthentication_By_Email_Enabled=false   # no SMTP locally
node main.js
```

→ open **http://localhost:3100**. First build is slow (~10–20 min cold); **incremental rebuilds are ~2–3 min** because `.meteor/local` stays warm. Re-run steps 2–4 to pick up code changes. Judge a build "green" by **`grep -c "error TS"` == 0** in the build output (the meteor exit code is unreliable) plus a `SERVER RUNNING` banner.

> 💀 **Free the port before each restart.** RC's `node main.js` traps `SIGTERM`, so a plain `kill` lingers and the next run hits `EADDRINUSE` — the OLD server keeps serving stale code (you'll see an "application error" / reconnect loop in the browser, and your build looks "up" but isn't your new code). Force-kill the **listener** first:
> ```bash
> kill -9 $(lsof -nP -iTCP:3100 -sTCP:LISTEN -t)
> ```
> Kill the **listener only** — `lsof -ti tcp:3100` also returns your browser's client socket; don't kill that. If a browser tab shows "application error" after a server swap, **hard-refresh** (Cmd+Shift+R) or open a fresh tab (client/server version mismatch).

### Path B: dev mode on :3000 (faster HMR, but flaky)
```bash
yarn build --filter=@rocket.chat/meteor^...                       # prebuild deps (incl. i18n) ONCE
yarn workspace @rocket.chat/livechat run build                    # build the livechat widget ONCE
ROOT_URL=http://localhost:3000 MONGO_URL="mongodb://127.0.0.1:27018/matterchat?replicaSet=rs0" \
MONGO_OPLOG_URL="mongodb://127.0.0.1:27018/local?replicaSet=rs0" \
yarn dev --concurrency=80 --filter='!@rocket.chat/livechat'
```
Three boot gotchas (all handled by the flags above):
1. **Turbo concurrency** — stock `yarn dev` deadlocks at the default concurrency (≈63 dep packages run persistent `tsc -w` watchers and starve the meteor task). Use `--concurrency=80`.
2. **i18n prebuild** — `packages/i18n` has no `dev` script, so `turbo run dev` skips it and a symlink dangles → meteor dies on `rocketchat-i18n/i18n`. Run the `yarn build --filter=...^...` prebuild once.
3. **livechat widget race** — its `dev` watcher wipes `dist` mid-build → `ENOENT index.html`. Build it once, then exclude it with `--filter='!@rocket.chat/livechat'`.

### First login
Fresh DB shows the setup wizard once — create the admin user. Keep **2FA-by-email OFF** locally (no SMTP) and do **not** force `Show_Setup_Wizard` (forcing it resets the wizard every restart = login loop).

---

## 6. The lay of the land (everything is under `apps/meteor`)

**Omnis Boards — client** (`client/views/boards/`):
- `BoardsHome`, `BoardRouter`, `BoardsLayout`
- `board/` → `BoardView` (kanban, @dnd-kit), `Column`, `CardTile`, `QuickAddCard`
- `card/` → `CardDetail`, `MatterPanel`, `LeadPanel`
- `views/` → `ViewSwitcher`, `TableView`, `TimelineView`, `DashboardView`, `SaveViewModal`
- `leads/`, `automations/`, `NewBoardModal`

**Omnis Boards — server**:
- `server/lib/boards/` — `service.ts`, `reads.ts`, `permissions.ts`, `events.ts`, `casepro/`, automations engine, `reports/`, `ai/`, `notifications/`
- `server/methods/boards/*` — Meteor methods (`boards.cardCreate`, `cardUpdate`, `cardMove`, …)
- `server/models/raw/Boards*.ts` — Mongo models (registered in `server/models.ts`)
- `app/api/server/v1/boards*.ts` — REST endpoints, imported by the side-effect barrel **`app/api/server/index.ts`** (NOT `v1/index.ts` — that doesn't exist in this fork)
- `packages/core-typings/src/IBoard*.ts` — the types (`IBoard`, `IBoardList`, `IBoardCard`)
- `packages/rest-typings/src/v1/boards*.ts` — endpoint types + ajv validators

**Fusion / chrome** (added on top of the fork):
- `client/views/root/MainLayout/AppLeftRail.tsx` — the dark left rail (wired in `LayoutWithSidebar.tsx`)
- `client/sidebar/footer/SidebarFooterDefault.tsx` — the "MatterChat" wordmark + "Powered by Omnis AI"
- `client/views/home/MyDayHomePage.tsx` — the "My Day" home (rendered by `HomePage.tsx`)
- `client/components/message/toolbar/useCreateCardFromMessageAction.tsx` + `CreateCardFromMessageModal.tsx` — "Create task" message→card (registered in `MessageToolbarActionMenu.tsx`)

**Data model (Mongo, prefix `boards_`):** `Boards` (`boards_boards`), `BoardsLists`, `BoardsCards`, plus leads/automation/reporting collections (`boards_leads`, `boards_automations`, `boards_notifications`, `boards_saved_views`, …). An `IBoardCard` has a `cardType` (`task`/`lead`/`matter`/…) and a polymorphic `link` — the `matter` arm carries a `link.snapshot` (the CasePro read-through cache: `stageName`, `solDate`, `practiceArea`, demand/settlement, …).

**REST:** everything is `GET/POST /v1/boards.*` — e.g. `boards.list`, `boards.cards`, `boards.card.create`, `boards.matters.*`, `boards.leads.*`, `boards.automations.*`, `boards.reports.*`, `boards.notifications.*`, `boards.ai.*`. Standard RC endpoints (`/v1/directory`, `/v1/login`, …) are unchanged.

---

## 7. Make your first change (the loop)

For a typical Omnis Boards change, touch these in order:

1. **Schema?** add/extend a type in `packages/core-typings/src/IBoard*.ts` → the raw model in `server/models/raw/Boards*.ts` → register in `server/models.ts`.
2. **Server logic** in `server/lib/boards/*`, exposed via a Meteor method (`server/methods/boards/`) and/or a REST endpoint (`app/api/server/v1/boards*.ts` + its type in `packages/rest-typings/src/v1/boards*.ts`, imported in `app/api/server/index.ts`).
3. **Permissions** — add `boards-*` entries to the permissions seed.
4. **Client** — a Fuselage view/component under `client/views/boards/`. Use the hooks `useEndpoint`, `useMethod`, `useQuery`.
5. **i18n** — add keys to `packages/i18n/src/locales/en.i18n.json` (see §8).
6. **Build + verify** — rebuild (§5 Path A), confirm `grep -c "error TS"` == 0 and `SERVER RUNNING`, then **load `:3100` in a fresh tab** and confirm it renders. *A green compile does NOT prove the client renders — always look.*

Mirror an existing example rather than inventing patterns: a form modal → copy `client/views/boards/NewBoardModal.tsx`; a message action → copy `useNewDiscussionMessageAction.tsx`; a REST endpoint → copy an existing `/v1/boards.card` handler.

---

## 8. Gotchas that will bite you (read before you build)

- **EADDRINUSE / stale server** — see the warning in §5. The #1 time-waster. Force-kill the listener before each restart.
- **i18n typed keys** — `packages/i18n/src/resources.ts` is a **dummy stub**; the real key union (`RocketchatI18nKeys`) is generated by `build.mts` from the locale JSON during the i18n package build. So: add your key to `en.i18n.json`, then the prebuild/prod build regenerates the type. `t()` and `MessageActionConfig.label` are typed to known keys — a missing key **fails the build**. A standalone `tsc` sees stale keys; rely on the prod build.
- **Icon set** (`@rocket.chat/icons`) — a fixed webfont, NOT Tabler/FontAwesome. VALID names include: `squares, folder, team, user, bell, balloons, magnifier, circle, circle-check, clock, chevron-right, dashboard, plus, discussion, at`. **INVALID (will fail the build): `kanban`, `checklist`.** Verify a name before using it.
- **Fuselage pitfalls** — `<Box is='img' height='x28'>` silently drops the height (use a native `<img>` or render text); size-token props like `flexBasis='x320'` / `minWidth='0'` may not typecheck (use inline `style`).
- **Rebrand rules** — user-facing "Rocket.Chat" is rebranded to "MatterChat" (i18n values, setting defaults, manifests). **NEVER rebrand:** the `RocketChat` code namespace, `@rocket.chat/*` npm packages, `rocketchat:*` Meteor packages, or server logs/tests. The browser `<title>` reads `Site_Name` from the DB, not code.
- **CasePro `aggregate_data` GROUP BY is broken server-side** — always query-then-sum in JS. Money fields come back as numeric strings.
- **Dev-mode flakiness** (`ERR_STREAM_WRITE_AFTER_END`) is dev-only — use the prod bundle (Path A) for anything you're demoing.

---

## 9. CasePro integration (the legal layer)

Matters/Leads mirror CasePro: a read-through **`MatterSnapshot`** cache on matter cards + write-through sync for intake (work leads in MatterChat's kanban, and — **once enabled** — it syncs back to CasePro). CasePro is the system of record; the board is a synced working view. **Status (2026-07-02):** the live wire (JSON-RPC over the casepro-mcp-v2 gateway) and the write-through paths are built, merged, and deployed **dark** on staging — they run against a built-in stub and stay dark until `CasePro_Enabled` + the `CASEPRO_*` env are set and a real MCP key is provisioned. The full CasePro schema discovery (13 matter stages, 8 intake stages, 12 practice areas, field mappings) is documented in the design assets. See `docs/features/casepro-integration.md` for the honest stub-vs-live breakdown and the enablement checklist.

---

## 10. Deploy / environments

- **Branch model:** feature branch → `develop` (no `staging-*` branches). Production = a normal RC instance built via `apps/meteor/.docker/Dockerfile.debian` or `yarn build:ci` (= `meteor build --server-only`). The one non-obvious prod requirement is the Mongo **replica set** (`MONGO_URL=…?replicaSet=rs0` + `MONGO_OPLOG_URL=…/local`).
- **Alpha (per-PR preview):** MatterChat is being onboarded into the OmnisAI Alpha Environment (AlphaEnvironment PR #13 adds a Meteor compose template with its own replica-set mongo). Until that's merged, preview locally via Path A.

---

## 11. Where it stands + what's next

**Built & on `feature/omnis-boards` (green, committed):** all of the Omnis Boards milestones M0–M8 (kanban, Leads + Matters pipelines, CasePro read + intake sync, automations, reporting, notifications, AI seams), the full Rocket.Chat→MatterChat rebrand, and the Fusion UI layer (left rail, My Day home, org Team roster, Trello-grade cards, message→card "Create task"). Runs as a stable prod bundle on `:3100`.

**Next up:** the **channel↔matter link** (bind a chat channel to a matter card — the keystone that unlocks a real "Matters" sidebar folder, a linked-matter side panel, and `/matter` slash commands), then slash commands (`/task`, `/lead`, `/matter`), channel folders, and huddles.

---

## 12. Going deeper / who to ask

- **For Claude Code users:** there's an `omnis-os:matterchat` skill (architecture + how-to-change guide) — load it and Claude knows this whole codebase. There's also `casepro-crm` for the CRM side.
- **Design docs & CasePro schema discovery:** in the Omnis Boards design assets (ask the maintainer for the `omnis-boards-build/` folder).
- **Ops / alpha / deploy help:** Slack channel `C095WAWD3EZ`.
- **Questions on the build:** ping the maintainer (Chi).

Welcome aboard — clone it, get it running on :3100, poke the boards, then pick a task from §11.
