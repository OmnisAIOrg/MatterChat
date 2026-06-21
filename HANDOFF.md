# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **The "checkpoint matterchat" command updates this before a session ends.** Standing rules + the two session commands are in `CLAUDE.md`; decisions + their reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-20 · **Branch:** `feature/matterchat-cross-firm`

## The three repos (all on GitHub · OmnisAIOrg · private)
- **`~/MatterChat`** ← here. The product + these resume docs.
- **`~/matterchat-mcp-v2`** — the CHI tool server (MCP; 23 deterministic tools over `boards.*`).
- **`~/omnis-counsel`** — cross‑firm **CFCS** service + customer KB (`docs/`) + demo scripts.
> Resuming needs only THIS repo's docs — they reference the other two by path.

## Running services (local dev)
| Port | What | Notes |
|---|---|---|
| 27018 | MongoDB (rs0) | DB `matterchat_apex` (seeded; Alex @ Apex) |
| 3100 | Prod bundle | Browseable; **"Sign in with OmnisAI"** works (needs :9100) |
| 4100 | Dev server (HMR) | The build/verify loop; same DB |
| 9100 | Mock OmnisAI OIDC | `~/omnis-counsel/mc-mock-oidc.js`; returns id_token + `/userinfo` |
| 9200 | CFCS (cross‑firm) | `~/omnis-counsel/server.js` |

Start the dev loop: `bash /tmp/mc-dev.sh` (or `/tmp/mc-dev-4100.sh`). Verify: `node "scripts/boards-api-test.mjs"` (token: see CLAUDE.md).

## Built + verified this session (all committed + pushed)
**Omnis Boards — personal PM + Trello/Asana parity:** My Day, Calendar, recurring tasks/routines, card completion, card copy, board copy, card‑from‑template, task dependencies (+ inverse edge), priority, milestones, approvals, global search. **CHI:** `matterchat-mcp-v2` — 23 deterministic MCP tools, verified end‑to‑end. **Cross‑firm:** CFCS trust core (channel‑hosted, CasePro‑free). **Velocity harness** (dev server + API test suite). See `git log` + `docs/current-status.md`.

## Next safest tasks (pick one, narrow)
1. **Server parity** (fast loop, harness‑verified): board status updates, bulk ops, list colors.
2. **UI views** (need a :3100 prod refresh to screenshot): Gantt/timeline, Forms (intake→card), Inbox/quick‑capture.
3. **Gmail/Outlook calendar + email integration** — 2‑way sync + email‑to‑task (start with an iCal feed off `boards.cards.myDay`).
4. **CHI go‑live:** deploy `matterchat-mcp-v2` → register in Chi (`/api/v1/mcp-servers`) → embed an in‑app CHI chat panel.
5. **Fork hardening** (before selling): strip `ee/`, pin version, own push gateway, audit/retention, custom roles.

## In‑flight gotchas
- The **:3100 prod bundle is behind HEAD** — it has features through the Calendar but **not** the latest (approvals, calendar fix). Rebuild :3100 to surface them.
- Remember the **`packages/*` rebuild gotcha** (CLAUDE.md) before any prod build after a types/rest‑typings edit.
