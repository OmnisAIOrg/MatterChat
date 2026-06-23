# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **The "checkpoint matterchat" command updates this before a session ends.** Standing rules + the two session commands are in `CLAUDE.md`; decisions + their reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-22 · **Branch:** `feature/matterchat-cross-firm`

## The three repos (all on GitHub · OmnisAIOrg · private)
- **`~/MatterChat`** ← here. The product + these resume docs.
- **`~/matterchat-mcp-v2`** — the CHI tool server (MCP; 23 deterministic tools over `boards.*`).
- **`~/omnis-counsel`** — cross‑firm **CFCS** service + customer KB (`docs/`) + demo scripts.
> Resuming needs only THIS repo's docs. This session touched only `~/MatterChat`.

## Running services (local dev)
| Port | What | Notes |
|---|---|---|
| 27018 | MongoDB (rs0) | DB `matterchat_apex` (seeded; sign in as **alex**, a regular user) |
| 3100 | **Dev server (HMR)** | `/tmp/mc-dev.sh` (ROOT_URL :3100, OmnisAI sign‑in wired to :3100). The browseable app + fast loop. |
| 4100 | Dev server (HMR) alt | `/tmp/mc-dev-4100.sh` — same DB, alternate port |
| 9100 | Mock OmnisAI OIDC | `~/omnis-counsel/mc-mock-oidc.js` |
| 9200 | CFCS (cross‑firm) | `~/omnis-counsel/server.js` |

**Run the dev loop two ways:** (a) self‑heal wrapper `while true; do bash /tmp/mc-dev.sh; done` (survives the dev‑proxy crash, see gotchas); or (b) hand it to the **preview tool** — register `matterchat`→`/tmp/mc-dev.sh` port 3100 in the workspace `.claude/launch.json`, then `preview_start` owns it and gives a browser you can screenshot. **Board view route = `/boards/board/:id/:view?`** (e.g. `/boards/board/<id>/board` for the kanban) — NOT `/boards/:id`.

**Verify the boards API in ~2s:** `MC_BASE=http://localhost:3100/api/v1 MC_USER_ID=<id> MC_AUTH_TOKEN=<token> node scripts/boards-api-test.mjs` (token from the browser console: `localStorage.getItem('Meteor.loginToken')`, id from `localStorage.getItem('Meteor.userId')` — never commit these).

## Built + verified this session (committed on `feature/matterchat-cross-firm`, PR #6)
**Two parallel build waves over the Boards surface — 49/49 harness green + UI eyeballed in the browser.**

**Wave 1 — server parity (3):** `boards.setStatus` (status enum + archive coherence), `boards.cards.bulk` (multi‑card ops), list `color` on `boards.list.update`.
**Wave 2 — 7 at once:**
- **UI (verified live in the board view):** board **status control** ("Active" tag + menu), **multi‑select bulk‑actions** toolbar (checkbox → Complete/Archive/Delete/priority/move), **list color picker** (palette → swatches).
- **Server (harness‑verified):** card **labels/tags** (`boards.label.*`, `boards.card.labels.set`), **list reorder** (`boards.list.reorder`), card **checklists** (`boards.card.checklist.add|toggle|remove`), **iCal feed** (`GET boards.cards.ical`, authenticated).
- Several of these (labels, checklists, list `position`) already existed at the **model** layer — only the API/UI was missing.
**Bug found + fixed by the harness:** re‑activating an archived board now **un‑archives its lists/cards** (was: `error-list-not-found` on card create after re‑activate). See DECISIONS 2026‑06‑22.

## Next safest task (pick one, narrow)
1. **UI for the 4 new server features** (client work in `apps/meteor/client/views/boards/**`): label chips + a label manager on cards, a checklist panel on the card detail, **drag‑to‑reorder** lists (wire `boards.list.reorder`), and a "**Subscribe in your calendar**" link exposing the iCal feed.
2. **Tokenized public iCal URL** — the feed is currently auth‑only; calendar apps can't send headers. Add a per‑user `icalToken` (+ an `authRequired:false` `?token=` resolver) so a feed URL can be subscribed. (Touches the shared Users model — treat as a small cross‑cutting change.)
3. **More server parity:** card cover images, board templates (distinct from `boards.copy`), saved filters.
4. **CHI go‑live:** deploy `matterchat-mcp-v2` → register in Chi → embed an in‑app CHI panel.
5. **Fork hardening** (before selling): strip `ee/`, pin version, own push gateway, audit/retention, custom roles.

## In‑flight gotchas
- **After editing `packages/rest-typings` / `packages/core-typings` (ajv schemas), rebuild `dist/` AND bounce the dev server.** The dev watcher does NOT pick up a one‑off `turbo` dist rebuild. Recipe: `yarn turbo run build --filter=@rocket.chat/rest-typings --filter=@rocket.chat/core-typings` (~15–40s) **then** kill the meteor process so it warm‑restarts. Symptom if skipped: new fields stripped (`must NOT have additional properties`) + enum validation bypassed (this bit 3 then 8 harness tests until the bounce). App code under `apps/meteor/**` (e.g. `server/lib/boards/service.ts`) does NOT need this — Meteor recompiles it itself.
- **Meteor's dev proxy crashes on aborted connections** (`ERR_STREAM_WRITE_AFTER_END`) — e.g. curl health‑checks with short `--max-time`, or a browser dropping mid‑load. Verify via the **log file + the API harness** (complete requests are fine), never by polling with aborting curls. The self‑heal wrapper recovers in ~30s.
- **`localhost` is not affected by VPN** (it never leaves the machine) — a "site can't be reached" on :3100 means the dev server crashed, not networking.
- The **prod bundle (`run-apex.sh`) on :3100 is behind HEAD** — rebuild it if you need the no‑dev‑proxy stable path; mind the `packages/*` rebuild gotcha first.
