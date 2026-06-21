# SESSION_HANDOFF.md
> Live state for resuming work. **Update this before ending a session.** Standing rules + workflow are in `CLAUDE.md`; the full feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-21 · **Branch:** `feature/matterchat-cross-firm`

## Running services (local dev)
| Port | What | Notes |
|---|---|---|
| 27018 | MongoDB (rs0) | DB `matterchat_apex` (seeded; Alex @ Apex) |
| 3100 | Prod bundle | Browseable; **"Sign in with OmnisAI"** works (needs :9100) |
| 4100 | Dev server (HMR) | The build/verify loop; same DB |
| 9100 | Mock OmnisAI OIDC | `~/mc-mock-oidc.js`; returns id_token + `/userinfo` |
| 9200 | CFCS (cross-firm) | `~/omnis-counsel/server.js` |

Start the dev loop: `bash /tmp/mc-dev.sh` (or `/tmp/mc-dev-4100.sh`). Verify: `node "scripts/boards-api-test.mjs"` (see CLAUDE.md for the token).

## Built + verified this session (all committed)
**Omnis Boards — personal PM + Trello/Asana parity:** My Day, Calendar, recurring tasks/routines, card completion, card copy, board copy, card‑from‑template, task dependencies (+ inverse edge), priority, milestones, approvals, global search. **CHI:** `matterchat-mcp-v2` — 23 deterministic MCP tools over `boards.*`, verified end‑to‑end. **Cross‑firm:** CFCS trust core (channel‑hosted, CasePro‑free). **Harness + design docs.** (See `git log` + `docs/current-status.md`.)

## Next safest tasks (pick one, narrow)
1. **Server parity** (fast loop, harness‑verified): board status updates, bulk ops, list colors.
2. **UI views** (need a :3100 prod refresh to screenshot): Gantt/timeline, Forms (intake→card), Inbox/quick‑capture.
3. **Gmail/Outlook calendar + email integration** — 2‑way calendar sync + email‑to‑task (start with an iCal feed off the existing `boards.cards.myDay`).
4. **CHI go‑live:** deploy `matterchat-mcp-v2` → register in Chi (`/api/v1/mcp-servers`) → embed an in‑app CHI chat panel (needs MatterChat deployed first).
5. **Fork hardening** (productionization, before selling): strip `ee/`, pin version, own push gateway, audit/retention, custom roles.

## In‑flight gotchas
- The **:3100 prod bundle is behind HEAD** — it has features through the Calendar but **not** the latest (approvals, calendar‑column fix). Rebuild :3100 to surface them.
- **Chrome MCP** here supports navigation only (no JS‑injection / DOM‑read).
- Remember the **`packages/*` rebuild gotcha** (CLAUDE.md) before any prod build after a types/rest‑typings edit.
