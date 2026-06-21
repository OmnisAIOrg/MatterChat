# CLAUDE.md — MatterChat build guide (read this first)

MatterChat is a **Rocket.Chat 8.6 fork** (Meteor 3 + React/Fuselage) we extend into a legal
team‑comms + **cross‑firm** + **project‑management ("Omnis Boards")** product, with an AI assistant
("CHI") powered by the existing OmnisAI AI‑Agents platform. Active branch: `feature/matterchat-cross-firm`.

## Session efficiency rules (follow these)
1. Read **CLAUDE.md → SESSION_HANDOFF.md → docs/current-status.md** before coding. Do **not** scan the whole repo.
2. Only inspect/modify files **relevant to the current task**. Targeted reads beat broad greps/full scans.
3. Before changing code, say **which files you'll touch and why**. Keep changes narrow; don't refactor unrelated files or regenerate large files.
4. **Update SESSION_HANDOFF.md before ending a session.**
5. Usage is metered by **tokens, not minutes** — the real cost is re‑reading large files/context and re‑deriving known facts. Prefer **a fresh session with a good handoff** over one giant session. (A 2,000‑line file read can burn more than an hour of light edits — "minutes elapsed" is a misleading gauge.)

## Fast build/verify loop (use this — NOT a 15‑min prod rebuild per change)
- **Dev server (hot reload):** `bash /tmp/mc-dev.sh` → `cd apps/meteor && yarn dev` on :3100 (or `/tmp/mc-dev-4100.sh` for :4100) against Mongo `matterchat_apex` (rs0 @ :27018). First compile ~1–5 min (warm cache), then edits are live in **seconds**.
- **API test harness:** `MC_BASE=http://localhost:<port>/api/v1 MC_USER_ID=<id> MC_AUTH_TOKEN=<token> node "scripts/boards-api-test.mjs"` — verifies the whole `boards.*` surface in ~2s. Get a token from the browser `localStorage` (`Meteor.userId` / `Meteor.loginToken`) or the DB.
- **CHI MCP server:** `~/matterchat-mcp-v2` — `npm run build`, `npm run start:http`, `npm run smoke`.
- **Prod bundle (for browser/SSO/screenshots):** `preview` "matterchat" runs `~/omnis-counsel/run-apex.sh` (full OmnisAI OIDC env on :3100). Mock OIDC must be up on :9100.

## Critical gotchas (these cost real time if missed)
- **Workspace `packages/*` do NOT auto‑rebuild in a prod `meteor build`** — it imports their stale `dist/`. After editing `packages/core-typings` / `packages/rest-typings` (e.g. an ajv schema), run `yarn turbo run build --filter=@rocket.chat/rest-typings` (~35s) **first**, or the change is silently dropped (`additionalProperties:false` strips the new field). The dev server's watchers handle this.
- **Don't edit source while a `meteor build` runs** — produces a half‑applied (partial) bundle.
- **`rocketchat-version` plugin** can fail the prod build when its signed feed is stale — patched in `apps/meteor/packages/rocketchat-version/plugin/compile-version.js` to degrade to `{}`.

## Where things live
- **Boards:** `apps/meteor/client/views/boards/**`, `apps/meteor/server/lib/boards/**`, `apps/meteor/app/api/server/v1/boards*.ts`; types `packages/core-typings/src/IBoard*.ts`, rest `packages/rest-typings/src/v1/boards.ts`.
- **Cross‑firm (CFCS):** `~/omnis-counsel/server.js` (:9200) + `apps/meteor/client/views/cross-firm/**` + `apps/meteor/app/omnisai-oauth/**`.
- **CHI tool server:** `~/matterchat-mcp-v2` (deterministic MCP tools over `boards.*`).
- **Design/roadmap:** `~/Claude Workspace/*.md` (parity, CHI architecture, AI‑sourcing). **Customer KB:** `~/omnis-counsel/docs/`.
