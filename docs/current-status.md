# Omnis Boards / MatterChat — current status

Updated 2026-07-01 · branch `staging`. (Resume workflow: `CLAUDE.md`; live handoff: `HANDOFF.md`; decisions: `DECISIONS.md`.)

## 2026-07-01 feature wave (verified against code; KB pages in `docs/features/`, marketing blurbs in `docs/marketing/feature-blurbs.md`)

| Feature | Status | Where | KB page |
|---|---|---|---|
| Legal roles (partner/attorney/paralegal + 4 boards roles) | **live** (staging, `c734efae42`) | permissions.ts, upsertPermissions.ts, v337 migration | `features/legal-roles.md` |
| Channel folders (`/folder` + collapsible sidebar groups) | **live** (staging, `bf93ea5614`) | setRoomFolder method, useRoomList, slashcommands-omnis | `features/channel-folders.md` |
| Audit logging — privilege trail + legal hold + 7y audit TTL | **live** (staging, `24e40f042f`); legal-hold set/clear admin method, `manage-legal-hold` perm, manual-purge guard **deferred** | server_events model, Rooms legal-hold, retention cron | `features/audit-logging.md` |
| Org auto-provision (admin OIDC login → roster import) | **live on MatterChat side** (staging, `987553c97d`, PR #11); **E2E pending** CentralizedAuth PR #352 (roster endpoint unmerged). Accounts only — no channels/teams mirrored | omnisai-oauth/orgProvision.ts; needs `MATTERCHAT_PROVISION_KEY` + issuer/API base | `features/org-auto-provision.md` |
| External connectors — Slack + Teams connect/browse/read/send + unread badges (30s polling) | **live** (staging) | app/connectors/*, external-workspaces API, ExternalSidebar | `features/external-workspace-connectors.md` |
| Connector real-time (subscribe) + identity resolve | **in progress** (stubbed `not_implemented`) | providers | — |
| Teams live message bridge (sync into RC rooms) | **in progress** (local branch `auto/teams-message-bridge` only; NOT pushed, nothing on staging) | — | — |
| Cross-firm secure messaging (panel, `/_crossfirm` proxy, export w/ integrity, legal hold, screening) | **live** (staging). Attorney bar-verification, Rule 4.2 server enforcement, matter-room content encryption = CFCS service side (pending verification here). Two-firm demo **in progress** (staging is single-firm) | client/views/cross-firm, omnisai-oauth/crossFirmProxy.ts | `features/cross-firm-messaging.md` |
| LitBox hardening — token encryption at rest (AES-256-GCM, `LITBOX_TOKEN_ENC_KEY`) + loginToken-expiry enforcement + refresh-on-401 | **live** (staging, `904089298b` + `2ab98fbe40`) | omnisai-oauth/litboxCrypto.ts, litboxProxy.ts | `features/litbox-file-security.md` |
| Read receipts (MIT-core reimplementation; 2 settings, Store_Users privacy gate) | **landing** (branch `auto/read-receipts`, unmerged) | server/lib/message-read-receipt | `features/read-receipts.md` |
| Boards server-side pagination + >100-card truncation fix | **landing** (branch `auto/boards-pagination` pushed; rebased `auto/boards-pagination-2` local-only) | server/lib/boards/reads.ts, boards API, BoardView | `features/boards-pagination.md` |

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
| Notifications | Board push notifications (VAPID web-push + in-app bell) | `app/web-push`, `boards/notifications` | code + parsecheck |
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
