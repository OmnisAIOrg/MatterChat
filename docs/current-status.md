# Omnis Boards / MatterChat — current status

Updated 2026-06-21 · branch `feature/matterchat-cross-firm`. (Resume workflow: `CLAUDE.md`; live handoff: `HANDOFF.md`; decisions: `DECISIONS.md`.)

## Done + verified (committed)
| Area | Feature | Surface | Verified |
|---|---|---|---|
| Personal PM | My Day (`/boards/planner`) | client + `boards.cards.myDay` | browser + harness |
| Personal PM | Calendar (`/boards/calendar`) | client (reuses myDay) | browser |
| Personal PM | Recurring tasks / routines | server + My Day UI | browser + harness |
| Parity | Card completion (`boards.card.complete`) | server | harness |
| Parity | Card copy / Board copy | server | harness |
| Parity | Card‑from‑template | server | harness |
| Parity | Task dependencies (+ inverse edge) | server | harness |
| Parity | Priority (low/med/high/urgent) | server + UI | harness |
| Parity | Milestones | server | harness |
| Parity | Approvals (request → approved/changes/rejected) | server | harness |
| Parity | Global cross‑board search | server | harness |
| AI | CHI tool server — 23 MCP tools | `~/matterchat-mcp-v2` | smoke + live |
| Cross‑firm | CFCS trust core (channel‑hosted, CasePro‑free) | `~/omnis-counsel` + client panel | browser + tests |
| Tooling | Velocity harness (dev server + API test suite) | — | proven |

Pre‑existing in the fork (not rebuilt): matters/leads pipelines, Board/Table/Timeline/Dashboard views, automation engine, reporting, custom fields, checklists, attachments, comments, watch/inbox.

## Next (roadmap)
- **Server parity (fast loop):** board status updates, bulk ops, list colors, card labels mgmt.
- **UI views (need a prod refresh to screenshot):** Gantt/timeline (dependency bars), Forms (intake → card), Inbox/quick‑capture.
- **Integrations:** **Gmail/Outlook calendar 2‑way sync + email‑to‑task** (start with an iCal feed off `boards.cards.myDay`); cloud‑storage attachments.
- **CHI go‑live:** deploy `matterchat-mcp-v2` (`matterchat-mcp-v2.stg-omnisai.io`) → register in Chi (`/api/v1/mcp-servers`) → embed an in‑app CHI chat panel.
- **Productionization (before selling):** strip `ee/` + delete `license` module, pin the RC version, own push gateway, firm‑wide audit/retention, custom roles. Plus the two expert sign‑offs (Rule 4.2 / cross‑firm crypto).
