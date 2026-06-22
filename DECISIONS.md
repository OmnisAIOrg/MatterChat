# DECISIONS.md — why we built it this way
> Append‑only. One dated entry per meaningful decision: what we chose, what we rejected, and **why** (the trade‑off). Never rewrite past entries. **No secrets** (no keys, passwords, tokens) — reasoning only. The "checkpoint matterchat" command appends here.

---

### 2026-06-22 — Built 3 boards‑parity features in parallel via isolated git worktrees
**Chose:** build board‑status / bulk‑card‑ops / list‑colors **concurrently** — three parallel sub‑agents, each in its own `git worktree` + branch off `feature/matterchat-cross-firm` — then integrate sequentially and verify once with the API harness (26/26).
**Rejected:** building the three one at a time on the live dev server.
**Why:** independent, additive server features parallelize cleanly, and worktrees stop the agents stomping each other's edits to the shared files (`rest-typings/boards.ts`, `server/lib/boards/service.ts`, the harness). The only integration conflicts were additive test‑block overlaps (kept all). Caveat learned: a fresh worktree has **no `node_modules`**, so agents can write code but cannot build/verify — verification is a single harness pass after integration, not per‑agent.

### 2026-06-22 — After a typings edit, rebuild `dist/` AND bounce the dev server
**Chose:** after editing `packages/rest-typings` / `packages/core-typings`, run `yarn turbo run build --filter=@rocket.chat/rest-typings --filter=@rocket.chat/core-typings` (~38s) **then bounce the meteor dev process** (the self‑heal wrapper warm‑restarts it).
**Rejected:** trusting the dev watcher to hot‑reload the rebuilt `dist/` (CLAUDE.md implies it does).
**Why:** the dev server imports each workspace package's built `dist/`, and its watcher did **not** pick up a one‑off `turbo` dist rebuild — 3 harness tests failed (new `color` field stripped by `additionalProperties:false`, status enum bypassed) until the process was bounced, which reloads `dist/` fresh on boot. Symptom to recognize: `must NOT have additional properties` in the server log + validation that should reject silently passing.

### 2026-06-22 — Dev server on :3100 under a self‑heal wrapper (don't patch the toolchain)
**Chose:** run the **dev** server (not the prod bundle) on the founder's familiar **:3100** via `/tmp/mc-dev.sh`, wrapped in `while true; do bash /tmp/mc-dev.sh; done` so a crash auto‑recovers in ~30s.
**Rejected:** (a) a ~15‑min prod build per change; (b) patching Meteor's `run-proxy.js` to swallow the error.
**Why:** Meteor's dev proxy crashes on aborted connections (`ERR_STREAM_WRITE_AFTER_END`) — triggered by curl health‑checks with short `--max-time` or a browser dropping mid‑load. The wrapper keeps the fast HMR loop AND auto‑heals without editing the global toolchain (patching `~/.meteor/.../run-proxy.js` is outside the repo and was deliberately left alone). Lesson: verify the dev server via its **log file + the API harness**, never by polling it with aborting curls.

### 2026-06-20 — Session resume = repo + skill, not personal memory
**Chose:** in‑repo `CLAUDE.md` (rules + the two commands) + `HANDOFF.md` (state) + `DECISIONS.md` (this file) + an `omnis-os:matterchat` skill, driven by two plain‑English commands ("resume matterchat" / "checkpoint matterchat").
**Rejected:** relying on Claude's personal memory for continuity.
**Why:** personal memory does not transfer to teammates or fresh machines — only what's in the repo/skill does. Also: usage is metered by tokens, not minutes, so a tight handoff + fresh sessions beat one giant session.

### 2026-06-20 — Backed all work to GitHub (OmnisAIOrg)
**Chose:** push all three repos — `MatterChat` (branch `feature/matterchat-cross-firm`), and new private repos `matterchat-mcp-v2` + `omnis-counsel`. Vendored the loose harness + design docs into the repos.
**Why:** committed‑locally is safe for same‑machine resume, but only pushed‑to‑remote survives a lost machine or a teammate handoff.

### 2026-06-20 — CHI is the existing AI‑Agents platform; integrate via an MCP tool server
**Chose:** build `matterchat-mcp-v2` — a deterministic MCP tool server over `boards.*`/chat — and plug it into the existing OmnisAI AI‑Agents (CHI) platform.
**Rejected:** building a new agent/chat loop inside MatterChat.
**Why:** CHI already does the reasoning/agent orchestration; duplicating it wastes effort. MatterChat only needs to expose tools. The server copies **CasePro's** HTTP/JSON‑RPC + API‑key plumbing and **CarePro's** deterministic static‑tool style (no in‑server LLM — the agent reasons).

### 2026-06-20 — AI sourcing for CHI: self‑hosted OSS is the default for legal
**Chose:** treat AI sourcing as a Chi‑platform decision with three models — (a) MCP connector to the user's own Claude/ChatGPT plan, (b) BYO commercial API key under DPA/ZDR, (c) self‑hosted open‑source (e.g. gpt‑oss‑120b on vLLM). Default for legal = **(c) self‑hosted**.
**Rejected:** programmatically driving a consumer Plus/Pro subscription as a free API.
**Why:** that's ToS‑prohibited (Anthropic banned it Feb 2026) and gives weak confidentiality. Self‑hosting avoids per‑token API charges (the founder's constraint) and keeps privileged legal data in‑house.

### 2026-06-20 — Omnis Boards must be a full standalone PM suite (Trello/Asana parity)
**Chose:** build personal‑PM + full PM parity on the generic board/list/card core, fully functional **without** CasePro/OmnisAI; CasePro matters/leads are an additive, setting‑gated layer.
**Why:** the founder wants Boards to run anyone's day/routine/projects, and — like cross‑firm — opposing counsel / non‑PI firms won't have CasePro, so it can never be load‑bearing.

### 2026-06-20 — Calendar/email integrate with the user's Gmail / Microsoft
**Chose:** roadmap the Boards Calendar + email toward **2‑way Google/Outlook calendar sync + email‑to‑task** via the user's own account; start with an iCal feed off `boards.cards.myDay`.
**Why:** real‑world calendars/email live in Gmail/Outlook; the internal calendar is only the base layer.

### 2026-06-20 — Velocity harness over per‑change prod rebuilds
**Chose:** a Meteor dev server (HMR, seconds) + a Node API test suite (`scripts/boards-api-test.mjs`, ~2s) as the build/verify loop.
**Rejected:** a ~15‑min `meteor build` per change.
**Why:** ~10× faster cycles and the API suite catches schema‑strip bugs a browser wouldn't (it caught the `priority` field being dropped). Note the prod‑build gotcha: a prod build does NOT rebuild workspace `packages/*` — rebuild them first.

### earlier — Cross‑firm chat lives inside the matter
**Chose:** fold cross‑firm (opposing‑counsel) messaging into the matter surface; removed the standalone cross‑firm view.
**Why:** keeps the feature in context and additive; CFCS trust core is channel‑hosted and CasePro‑free so it stands alone.
