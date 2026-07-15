# CLAUDE.md — MatterChat build guide (read this first)

MatterChat is a **Rocket.Chat 8.6 fork** (Meteor 3 + React/Fuselage) we extend into a legal
team‑comms + **cross‑firm** + **project‑management ("Omnis Boards")** product, with an AI assistant
("CHI") powered by the existing OmnisAI AI‑Agents platform. Active branch: `feature/matterchat-cross-firm`.

## ⚠️ Designing or changing ANY UI? Read the customization guide first
Because this is a **fork of Rocket.Chat**, the ceiling on UI customization is "anything" — but the
cost is **upstream mergeability**. Before you design, redesign, restyle, theme, or add any UI/feature,
read **`docs/design/MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md`** and follow its one rule:

> **Additive, in our own files — NOT in-place edits to Rocket.Chat core.** New component in a new
> dir merges clean forever; a line changed inside a core RC file conflicts on every upstream merge.

That guide has the customization ladder (theme → restyle → new feature → core), the map of which
dirs are *ours*, the theming (Fuselage/palette, no hardcoded colors) and branding-asset homes, the
`// MATTERCHAT:` marker for unavoidable core edits, and the PR checklist. It is not optional — it is
what keeps future Rocket.Chat updates cheap to merge.

## Two commands run every session (plain English — this is all you type)
- **"resume matterchat"** → *catch me up and get ready to build.* Reads `CLAUDE.md` → `HANDOFF.md` → `DECISIONS.md` (+ any open PRs), boots or locates the stack, then gives a tight brief and proposes the **single next safest task**. Does not scan the whole repo.
- **"checkpoint matterchat"** → *save & ship before I stop.* Commits everything (clear messages, a feature branch per repo we touched), pushes to **OmnisAIOrg** and opens/refreshes a **PR per repo**, updates `HANDOFF.md` (today's date + what changed + next task), appends dated entries to `DECISIONS.md` (what/why, **no secrets**), refreshes the `matterchat` omnis‑os skill if we learned something, and reports every PR link + what's left. Starts no new work.

> Full protocol lives in the **`matterchat` skill** in omnis‑os. The two phrases above are all you ever need to type.

## Session efficiency rules (follow these)
1. Read **CLAUDE.md → HANDOFF.md → DECISIONS.md** before coding. Do **not** scan the whole repo.
2. Only inspect/modify files **relevant to the current task**. Targeted reads beat broad greps/full scans.
3. Before changing code, say **which files you'll touch and why**. Keep changes narrow; don't refactor unrelated files or regenerate large files.
4. **Update `HANDOFF.md` and append to `DECISIONS.md` before ending a session** (the "checkpoint matterchat" command does this).
5. Usage is metered by **tokens, not minutes** — the real cost is re‑reading large files/context and re‑deriving known facts. Prefer **a fresh session with a good handoff** over one giant session. (A 2,000‑line file read can burn more than an hour of light edits — "minutes elapsed" is a misleading gauge.)

## Fast build/verify loop (use this — NOT a 15‑min prod rebuild per change)
- **Dev server (hot reload):** `bash /tmp/mc-dev.sh` → `cd apps/meteor && yarn dev` on :3100 (or `/tmp/mc-dev-4100.sh` for :4100) against Mongo `matterchat_apex` (rs0 @ :27018). First compile ~1–5 min (warm cache), then edits are live in **seconds**.
- **API test harness:** `MC_BASE=http://localhost:<port>/api/v1 MC_USER_ID=<id> MC_AUTH_TOKEN=<token> node "scripts/boards-api-test.mjs"` — verifies the whole `boards.*` surface in ~2s. Get a token from the browser `localStorage` (`Meteor.userId` / `Meteor.loginToken`) or the DB.
- **CHI MCP server:** `~/matterchat-mcp-v2` — `npm run build`, `npm run start:http`, `npm run smoke`.
- **Prod bundle (for browser/SSO/screenshots):** `preview` "matterchat" runs `~/omnis-counsel/run-apex.sh` (full OmnisAI OIDC env on :3100). Mock OIDC must be up on :9100.

## Critical gotchas (these cost real time if missed)
- **Workspace `packages/*` do NOT auto‑rebuild in a prod `meteor build`** — it imports their stale `dist/`. After editing `packages/core-typings` / `packages/rest-typings` (e.g. an ajv schema), run `yarn turbo run build --filter=@rocket.chat/rest-typings` (~35s) **first**, or the change is silently dropped (`additionalProperties:false` strips the new field). The dev server's watchers handle this.
- **Don't edit source while a `meteor build` runs** — produces a half‑applied (partial) bundle.
- **EADDRINUSE / stale server** — force‑kill the listener before each restart: `kill -9 $(lsof -nP -iTCP:3100 -sTCP:LISTEN -t)` (the listener only, not the browser socket). See `MATTERCHAT-ONBOARDING.md` §5.
- **`rocketchat-version` plugin** can fail the prod build when its signed feed is stale — patched in `apps/meteor/packages/rocketchat-version/plugin/compile-version.js` to degrade to `{}`.

## The product spans three repos (all on GitHub · OmnisAIOrg · private)
- **`~/MatterChat`** ← here. The product: Boards, cross‑firm UI, OmnisAI OIDC + these resume docs. Branch `feature/matterchat-cross-firm`.
- **`~/matterchat-mcp-v2`** — the CHI tool server (MCP; 23 deterministic tools over `boards.*`).
- **`~/omnis-counsel`** — the cross‑firm **CFCS** service + customer KB (`docs/`) + demo scripts (`start-demo.sh`, `run-apex.sh`, `mc-mock-oidc.js`).

## Where things live (deeper map: `MATTERCHAT-ONBOARDING.md`)
- **Boards:** `apps/meteor/client/views/boards/**`, `apps/meteor/server/lib/boards/**`, `apps/meteor/app/api/server/v1/boards*.ts`; types `packages/core-typings/src/IBoard*.ts`, rest `packages/rest-typings/src/v1/boards.ts`.
- **Cross‑firm (CFCS):** `~/omnis-counsel/server.js` (:9200) + `apps/meteor/client/views/cross-firm/**` + `apps/meteor/app/omnisai-oauth/**`.
- **CHI tool server:** `~/matterchat-mcp-v2` (deterministic MCP tools over `boards.*`).
- **Design/roadmap:** `docs/design/*` (vendored). **Customer KB:** `~/omnis-counsel/docs/`.
