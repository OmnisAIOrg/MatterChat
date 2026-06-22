# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **The "checkpoint matterchat" command updates this before a session ends.** Standing rules + the two session commands are in `CLAUDE.md`; decisions + their reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-22 · **Branch:** `feature/matterchat-cross-firm`

## The three repos (all on GitHub · OmnisAIOrg · private)
- **`~/MatterChat`** ← here. The product + these resume docs.
- **`~/matterchat-mcp-v2`** — the CHI tool server (MCP; 23 deterministic tools over `boards.*`).
- **`~/omnis-counsel`** — cross‑firm **CFCS** service + customer KB (`docs/`) + demo scripts.
> Resuming needs only THIS repo's docs — they reference the other two by path. This session touched only `~/MatterChat`.

## Running services (local dev)
| Port | What | Notes |
|---|---|---|
| 27018 | MongoDB (rs0) | DB `matterchat_apex` (seeded; Alex @ Apex, user id `ijT939mb6PH9oKxyy`, roles=user) |
| 3100 | **Dev server (HMR)** | This session ran the **dev** server here via `/tmp/mc-dev.sh` (ROOT_URL :3100, OmnisAI sign‑in wired to :3100). Browseable; survives across the same browser session (existing login token). |
| 4100 | Dev server (HMR) alt | `/tmp/mc-dev-4100.sh` — same DB, alternate port |
| 9100 | Mock OmnisAI OIDC | `~/omnis-counsel/mc-mock-oidc.js`; id_token + `/userinfo` |
| 9200 | CFCS (cross‑firm) | `~/omnis-counsel/server.js` |

> **NOTE:** `:3100` is also the prod‑bundle port (`run-apex.sh`). Don't run the dev server and prod bundle on :3100 at once. This session the dev server on :3100 was wrapped in a **self‑heal loop** (`while true; do bash /tmp/mc-dev.sh; done`) so a proxy crash auto‑restarts — see gotchas.

Start the dev loop: `bash /tmp/mc-dev.sh` (:3100) or `/tmp/mc-dev-4100.sh` (:4100). Verify the boards surface in ~2s:
`MC_BASE=http://localhost:3100/api/v1 MC_USER_ID=<id> MC_AUTH_TOKEN=<token> node scripts/boards-api-test.mjs` (token from browser `localStorage.getItem('Meteor.loginToken')`).

## Built + verified this session (committed on `feature/matterchat-cross-firm`, pushed → PR #6)
**Boards server parity — 3 features built in parallel (isolated git worktrees), integrated, and verified 26/26 by `scripts/boards-api-test.mjs` against the live :3100 server:**
1. **Board status updates** — new `boards.setStatus` (POST). `IBoard.status` enum `active | on_hold | completed | archived`; keeps the legacy `archived` flag coherent (status=archived ⇒ archived:true + cascades; re‑activating works on archived boards); rejects invalid values (400).
2. **Bulk card operations** — new `boards.cards.bulk` (POST). `{cardIds[], action: move|complete|archive|setPriority|delete}`, reuses the single‑card server‑lib fns in a loop, per‑card partial‑failure handling → `{results[], updated, failed}`.
3. **List colors** — extended `boards.list.update` with an optional `color` (raw CSS/hex string) on `IBoardList`; persists + returns on read‑back.

## Next safest tasks (pick one, narrow)
1. **Surface the 3 new server features in the Boards UI** (client work in `apps/meteor/client/views/boards/**`): a board **status control**, a **multi‑select → bulk actions** toolbar (calls `boards.cards.bulk`), and a **list color picker** (calls `boards.list.update {patch:{color}}`). The endpoints are done + verified; the UI to drive them is the gap.
2. **More server parity** (fast loop, harness‑verified): list reordering, card labels, board templates.
3. **Gmail/Outlook calendar + email** — 2‑way sync + email‑to‑task (start with an iCal feed off `boards.cards.myDay`).
4. **CHI go‑live:** deploy `matterchat-mcp-v2` → register in Chi (`/api/v1/mcp-servers`) → embed an in‑app CHI chat panel.
5. **Fork hardening** (before selling): strip `ee/`, pin version, own push gateway, audit/retention, custom roles.

## In‑flight gotchas
- **After editing `packages/rest-typings` / `packages/core-typings` (ajv schemas), the DEV server does NOT auto‑pick‑up the rebuilt `dist/`.** CLAUDE.md implies the watcher handles it — it does **not** for a one‑off `turbo` rebuild. Recipe that works: `yarn turbo run build --filter=@rocket.chat/rest-typings --filter=@rocket.chat/core-typings` (~38s) **then bounce the dev server** (kill the meteor process; the self‑heal wrapper warm‑restarts it ~2min). Symptom if you skip it: new fields silently stripped (`must NOT have additional properties`) and enum validation bypassed. This is what made 3 harness tests fail until the bounce. See DECISIONS 2026‑06‑22.
- **Meteor's dev proxy (`run-proxy.js`) crashes on aborted connections** (`ERR_STREAM_WRITE_AFTER_END`) — e.g. curl health‑checks with short `--max-time`, or a browser dropping mid‑load. Don't poll the dev server with aborting curls; verify via the log file + the API harness (complete requests are fine). The self‑heal wrapper makes a crash recover in ~30s. (Patching `run-proxy.js` would fix it permanently but it's outside the repo / toolchain — left unpatched.)
- The **prod bundle on :3100 is behind HEAD** — rebuild it (`run-apex.sh`) to surface the latest features in a browser if you need the no‑dev‑proxy stable path. Remember the `packages/*` rebuild gotcha before any prod build.
