# Omnis Boards — Trello/Asana parity, Bring-Your-Own-AI, and the CHI agent

> Engineering design + roadmap. Architecture confirmed against the live tree at `/Users/davidnguyen/MatterChat` (Rocket.Chat 8.6 fork; Meteor 3 + React/Fuselage). Types live in `packages/core-typings/src/IBoard*.ts`, models in `packages/models/src/models/Boards*.ts`, services in `apps/meteor/server/lib/boards/`, REST in `apps/meteor/app/api/server/v1/boards*.ts`, views in `apps/meteor/client/views/boards/`. All file paths below are real and verified.

---

## 1. Executive summary

Omnis Boards is already a standalone, generic project-management core that exceeds vanilla Trello and Asana on automation, the legal-vertical pipelines (leads/matters), reporting depth, and AI. The vision is to make Omnis Boards a credibly complete Trello+Asana competitor that is also natively AI-first: a board where users bring their own AI provider (workspace or per-user key, multi-model, cost-guarded) and where a conversational agent — **CHI** — can plan a day, summarize a board, and create/move/complete work on the user's behalf, every action authorized under the user's own identity and written to the activity feed and an append-only audit log. Three workstreams deliver this: **(1) Trello/Asana PARITY** — close the handful of generic-PM primitives (subtasks, dependencies, recurrence, milestones, Calendar/Gantt, Forms, My Tasks sections) the competitors ship; **(2) BRING-YOUR-OWN-AI** — promote the existing narrow Boards AI seam into a shared, multi-provider, tool-calling, cost-guarded `server/lib/ai/` gateway; **(3) THE CHI AGENT** — an agent loop above that gateway that proposes actions and executes them through the existing boards services under the caller's permissions.

The three workstreams are mutually reinforcing: the BYO-AI gateway is the substrate CHI runs on, CHI is the showcase consumer that proves the gateway, and the parity primitives (especially card completion, recurrence, and dependencies) are both table-stakes features and the read/write surface CHI's tool catalog operates against.

---

## 2. Where Omnis Boards stands today

Omnis Boards is already a fully standalone, generic PM core with a rich type system (`IBoardCard` is a superset of a Trello card / Asana task), full CRUD services (`apps/meteor/server/lib/boards/service.ts`, 12 exported functions), four working views (Board/Kanban, Table, Timeline, Dashboard), saved views with filter/sort/group, a complete automation engine (rules, card/board buttons, scheduled commands, drip sequences, template gallery, run logs), watch/subscribe + an in-app inbox with email digests, custom fields, deep CasePro/LitBox integration, a domain report library (funnel, financial, aging, caseload, source-to-settlement, overview), and a working but narrow single-shot AI seam at `apps/meteor/server/lib/boards/ai/`. It is genuinely ahead of both competitors on automation, the leads/matters legal pipelines, reporting, and AI; the remaining gaps cluster in generic-PM primitives, personal-productivity surfaces, planning surfaces, intake forms, and the long tail of third-party integrations and admin/governance.

---

## 3. Trello/Asana PARITY — gap matrix + roadmap

### 3.0 Legend

- **HAVE** — shipped and substantively equivalent.
- **PARTIAL** — a related primitive exists but is missing a sub-capability the competitor ships.
- **MISSING** — no equivalent.
- **N/A‑plan** — a competitor billing/plan-gating row with no product analog (noted, not roadmapped).

Effort key (roadmap): **S** ≈ ≤2 days, **M** ≈ 3–7 days, **L** ≈ 1.5+ weeks.

### 3.1 GAP MATRIX

#### A. Cards / Tasks — the work unit

| # | Feature (Trello / Asana) | Status | Notes |
|---|---|---|---|
| A1 | Card / Task core (title, desc, assignee, dates, metadata) | **HAVE** | `IBoardCard` is a superset. |
| A2 | Card / Task **description** (rich-text / Markdown) | **HAVE** | `IBoardCard.description` (markdown). |
| A3 | **Subtasks** (Asana: nested, own assignee/date/comments, multi-level) | **PARTIAL** | Checklists w/ per-item assignee+dueDate+convert-to-card (`IChecklistItem`) cover the 80% case, but checklist items are not first-class cards (no own comments/description/activity, no nesting). Asana-grade subtasks missing. |
| A4 | **Checklists** (Trello, basic) | **HAVE** | `IChecklist`. |
| A5 | **Advanced checklists** (assignee + due date on item) | **HAVE** | `IChecklistItem.assignee` / `.dueDate`. |
| A6 | **Due dates** (+reminder) | **HAVE** | `dueDate`, cron `card.dueSoon`/`card.overdue` in `events.ts`. |
| A7 | **Due times** (time-of-day) | **PARTIAL** | `dueDate` is a `Date` so a time is storable, but no UI/semantics treat it as time-bound; reminders are day-grained. |
| A8 | **Start dates** | **HAVE** | `startDate`. |
| A9 | **Due-complete toggle** | **HAVE** | `dueComplete`. |
| A10 | **Members / Assignees** (multi) | **HAVE** | `assignees[]` (multi — exceeds Asana's single-assignee). |
| A11 | Single-assignee + **Collaborators** split (Asana) | **PARTIAL** | We have `assignees[]` + `watchers[]`; Asana's "one accountable assignee vs collaborators" distinction isn't modeled (everyone in `assignees[]` is equal). Low value for legal vertical. |
| A12 | **Attachments** (file/link/cloud) | **HAVE** | `IAttachment` (litbox/local/url). |
| A13 | **Cover** images / colors | **HAVE** | `ICardCover`. |
| A14 | **Comments** (Markdown, @mention, attach) | **HAVE** | `ICardComment` w/ mentions. |
| A15 | **Reactions / emoji** on comments | **HAVE** | `ICardComment.reactions`. |
| A16 | **Likes / reactions on tasks** (Asana, task-level) | **PARTIAL** | Reactions exist on comments only, not on the card itself. Trivial gap. |
| A17 | **Activity feed** (card + board) | **HAVE** | `IBoardActivity`, route `boards.activities`. |
| A18 | **Card aging** (Power-Up: fade/cracks stale) | **MISSING** | No "days since last touched" decay visual. |
| A19 | **Voting** (Power-Up) | **MISSING** | No vote model. |
| A20 | **Stickers** | **MISSING** | Decorative; very low priority. |
| A21 | **Card numbers / short links** | **HAVE** | `cardNumber` + `cardCounter`. |
| A22 | **Card links & @card-mentions** (paste URL → linked ref) | **PARTIAL** | `relations[]` links cards explicitly; pasting a card URL into a comment/desc does not auto-render a rich card chip. |
| A23 | **Card mirroring / multi-homing** (Trello mirror, Asana multi-home) | **PARTIAL** | `mirrorOf` field + `card.mirrored` verb exist in the type, but there is no service to create/sync a mirror and no multi-project membership (a card has exactly one `boardId`/`listId`). True multi-home missing. |
| A24 | **Archive** card / list | **HAVE** | `archiveCard`/`archiveList`, `archived` flag. |
| A25 | **Delete** (permanent) | **PARTIAL** | Archive exists; no hard-delete + restore-from-trash flow surfaced. |
| A26 | **Card / Task templates** (template list, prefill) | **PARTIAL** | Stage **playbooks** prefill checklists/tasks/deadlines on stage entry (`IPlaybookTemplate`), and automation `createCard` can clone structure — but there's no "mark this card as a template / New from template" UX. |
| A27 | **Milestones** (Asana diamond checkpoint) | **MISSING** | No milestone card-type/flag; Timeline can't render diamonds. |
| A28 | **Task dependencies** (waiting-on / blocking, notify on unblock) | **PARTIAL** | `relations[].type` already includes `blocks`/`blocked-by`/`parent`/`child` — the **data model is there** — but no dependency UI, no "blocked" indicator on tile, no notify-on-blocker-complete logic, no Timeline dependency lines. |
| A29 | **Recurring tasks** (repeat schedule, auto-regenerate) | **PARTIAL** | `kind:'scheduled'` automations + `createCard` action can synthesize recurring cards board-wide, but there's no per-card "repeat" config that regenerates the card itself on completion/schedule. |
| A30 | **Convert task→project / subtask promotion** (Asana) | **PARTIAL** | `checklistItem → card` conversion (`convertedCardId`) exists; card→board promotion does not. |
| A31 | **Copy / duplicate** task with chosen attributes | **PARTIAL** | `card.copied` verb exists in activity vocab; no `copyCard` service/endpoint/UI. |
| A32 | **Mark complete / incomplete** (task-level, distinct from archive) | **PARTIAL** | `dueComplete` marks the *due date* done; there's no card-level "completed" state independent of archive (Asana's core completion checkbox). |

#### B. Lists / Sections / Columns

| # | Feature | Status | Notes |
|---|---|---|---|
| B1 | **Lists / Columns** (add, reorder, archive) | **HAVE** | `IBoardList`, `createList`/`moveList`/`archiveList`. |
| B2 | **List colors** (header color) | **MISSING** | `IBoardList` has no `color`. |
| B3 | **Collapsible lists** | **HAVE** | `IBoardList.collapsed`. |
| B4 | **WIP limits** | **HAVE** (beyond Trello) | `IBoardList.wipLimit`. |
| B5 | **Move all / sort all cards in a list** | **PARTIAL** | `moveCard` is per-card; no bulk "move/sort all cards" board-button equivalent surfaced (Butler has it; our automation could, but no prebuilt action). |
| B6 | **Copy list / move list to another board** | **PARTIAL** | `moveList` reorders within a board; cross-board move + list-copy not implemented. |
| B7 | **Sections** (Asana grouping within a project, List + Board) | **HAVE** (≈) | Lists are columns; Table view has grouping sections; `subStatuses` add intra-list grouping. Equivalent. |

#### C. Boards / Projects

| # | Feature | Status | Notes |
|---|---|---|---|
| C1 | **Boards / Projects** container | **HAVE** | `IBoard`. |
| C2 | Star / rename / background / icon | **HAVE** | `starredBy`, `background`, `icon`. |
| C3 | **Unsplash / photo backgrounds** | **PARTIAL** | `IBoardBackground.kind:'image'` stores a value, but no Unsplash picker UI. |
| C4 | **Copy / duplicate board** | **MISSING** | No `copyBoard`. |
| C5 | Close / archive board | **HAVE** | `archiveBoard`. |
| C6 | **Project Overview tab** (Asana: desc, roles, resources, status) | **MISSING** | Boards have a header but no Overview landing tab. |
| C7 | **Project Brief** (rich-text doc) | **MISSING** | No brief doc per board. |
| C8 | **Project Status Updates** (color + narrative + rollups) | **PARTIAL** | Dashboard view shows metrics; no posted "on track / at risk" status-update object with history. |
| C9 | **Project messages / conversations** (board-level, non-task) | **PARTIAL** | A board can bind a Rocket.Chat channel (`IBoard.rid`) — chat exists — but no in-Boards message board object. |
| C10 | **Project files view** (all attachments gallery) | **MISSING** | No consolidated per-board file gallery. |
| C11 | **Project custom-field settings** (which fields show/order) | **HAVE** (≈) | `fieldDefs[].showOnFront`/`.position` + saved-view `visibleFields`. |
| C12 | **Project color & icon** | **HAVE** | `icon`; color via background. |
| C13 | **Project roles / key resources** | **MISSING** | No named-roles-with-resources block. |
| C14 | **Project export & print** (CSV/JSON) | **MISSING** | No board/data export endpoint. |
| C15 | **Duplicate / convert project → template** | **MISSING** | No board-template authoring. |

#### D. Views

| # | Feature | Status | Notes |
|---|---|---|---|
| D1 | **Board / Kanban view** | **HAVE** | `BoardView.tsx`. |
| D2 | **Table / List view** (spreadsheet) | **HAVE** | `TableView.tsx`. |
| D3 | **Timeline view** (chronological) | **PARTIAL** | `TimelineView.tsx` buckets by month on a date field — it is *not* a Gantt (no per-card bars across start→due, no dependency lines, no drag-to-reschedule). |
| D4 | **Gantt view** (bars + critical path + deps) | **MISSING** | See D3; true Gantt absent. |
| D5 | **Calendar view** | **MISSING (generic)** / PARTIAL (matters) | A *matters* deadline calendar exists (`MattersCalendar.tsx`), but no generic board Calendar plotting card start/due, drag-to-reschedule, iCal. |
| D6 | **Dashboard view** (charts) | **PARTIAL** | `DashboardView.tsx` gives per-board tiles + one distribution bar; not the multi-chart (per member/label/due) configurable dashboard. |
| D7 | **Map view** (geo) | **MISSING** | No location field / map. |
| D8 | **Workspace / cross-board views** (aggregate Table/Calendar) | **PARTIAL** | `MyDayPlanner` aggregates *assigned-to-me* cross-board; no general cross-board Table/Calendar over arbitrary boards. |
| D9 | **Saved views** (filter/sort/group/fields/dateField) | **HAVE** | `ISavedView`, full CRUD. |
| D10 | **Sort / filter / group-by** in any view | **HAVE** | `OmnisCardQuery` + saved-view config. |

#### E. My Tasks / Planner / Inbox (personal surfaces)

| # | Feature | Status | Notes |
|---|---|---|---|
| E1 | **My Tasks / Cards view** (everything assigned to me) | **HAVE** | `MyDayPlanner.tsx`, `boards.cards.myDay`. |
| E2 | **My Tasks sections** (Recently Assigned / Today / Upcoming / Later) | **PARTIAL** | MyDay buckets Overdue/Today/Week/Later by due date — close — but sections aren't user-editable/persisted and there's no "Recently Assigned" intake bucket. |
| E3 | **Auto-promote rules** (move between time sections as due nears) | **MISSING** | No auto-promotion engine for the personal list. |
| E4 | **Mark-for-today / manual prioritization** | **PARTIAL** | Mark-done exists; no "pin to Today" personal flag. |
| E5 | **My Tasks privacy** | **HAVE** (≈) | MyDay is inherently per-user. |
| E6 | **Inbox / notification feed** | **HAVE** | `NotificationsInbox.tsx`, `IBoardNotification`. |
| E7 | **Inbox filtering** (by type/project/@me) | **PARTIAL** | List + unread exist; no faceted filter UI. |
| E8 | **Archive & snooze notifications** | **PARTIAL** | markRead/markAllRead exist; no snooze/resurface. |
| E9 | **Inbox actions** (comment/complete/like from feed) | **MISSING** | Inbox is read+deep-link only; no inline actions. |
| E10 | **Activity digest / bundled / AI-summarized notifications** | **PARTIAL** | Email digest of unread exists (`deliver.ts`); no bundling or AI Smart Digest. |
| E11 | **Notification settings** (granular per-event/channel) | **PARTIAL** | Subscriptions narrow events per target; no per-user global notification-preference matrix (in-app/email/push toggles per event type). |
| E12 | **Planner** (time-blocking, drag cards into calendar slots) | **MISSING** | MyDay is a list, not a time-block calendar. |
| E13 | **Inbox capture** (collect from email/Slack into triage) | **PARTIAL** | Lead capture handles intake; no personal capture inbox that turns arbitrary items into cards. |

#### F. Collaboration / Sharing / Roles

| # | Feature | Status | Notes |
|---|---|---|---|
| F1 | **@mentions** (comments/desc/checklist) | **PARTIAL** | Comment mentions modeled (`ICardComment.mentions`); description/checklist mentions not parsed. |
| F2 | **Watch / subscribe** (card/list/board) | **HAVE** | `IBoardSubscription`, `WatchToggle.tsx`. |
| F3 | **Notifications** (in-app/email/desktop/mobile push) | **PARTIAL** | In-app + email digest shipped; desktop/mobile push not wired (RC push exists to leverage). |
| F4 | **Sharing & invites** (email/link, public/private) | **PARTIAL** | `visibility` private/team/shared + `members[]` roles; no shareable-link / join-link / public-board flow. |
| F5 | **Observers** (read-only / comment-only role) | **HAVE** | `IBoardMember.role:'observer'`. |
| F6 | **Comment-only vs edit access** (Asana per-member) | **PARTIAL** | observer (read) vs member (edit) exists; no dedicated comment-only tier. |
| F7 | **Guests / multi-board guests** | **MISSING** | No external-guest scoping distinct from members. |

#### G. Automation

| # | Feature | Status | Notes |
|---|---|---|---|
| G1 | **Rules** (trigger→actions, board-wide) | **HAVE** | `IAutomation kind:'rule'`. |
| G2 | **Card buttons** | **HAVE** | `kind:'card-button'`, `CardButtonsRow.tsx`. |
| G3 | **Board buttons** | **HAVE** | `kind:'board-button'`, `BoardButtonsMenu.tsx`. |
| G4 | **Scheduled / calendar commands** | **HAVE** | `kind:'scheduled'`, `IBoardAutomationSchedule`. |
| G5 | **Due-date commands** (relative to due) | **HAVE** | deadline event triggers + `setDue`/`completeDue`. |
| G6 | **Multi-action rules** | **HAVE** | ordered action union. |
| G7 | **Conditions / branching** | **PARTIAL** | AND-combined conditions exist; no OR / if-then **branching** within a rule. |
| G8 | **Custom rule builder UI** | **HAVE** | `AutomationBuilder.tsx`. |
| G9 | **Rule templates / library** | **HAVE** | `TemplateGallery.tsx`, `isTemplate`. |
| G10 | **Bundles** (reusable rules+fields+sections applied across projects) | **PARTIAL** | Template install clones rules to a board; no bundle that also carries fields/sections and updates centrally. |
| G11 | **Cross-tool / integration rules** (Slack/Teams/Jira actions) | **PARTIAL** | `comment` can fan out to the bound RC channel; `notify`/`notifyEmail`/`notifySms` exist — but no Slack/Teams/Jira action targets. |
| G12 | **Rule activity log** | **HAVE** | `IAutomationRun`, `AutomationActivity.tsx`. |
| G13 | **Enable / disable rules** | **HAVE** | enabled flag (template-vs-live). |
| G14 | **Workflow Builder** (visual intake→stages→rules canvas) | **PARTIAL** | Builder + playbooks + sequences cover much; no single visual end-to-end canvas incl. forms. |
| G15 | **Command run limits** (plan quota) | **N/A‑plan** | Not metered. |
| G16 | **Drip sequences** (multi-step enrollment) | **HAVE** (beyond both) | `ISequence`. |

#### H. Custom Fields

| # | Feature | Status | Notes |
|---|---|---|---|
| H1 | Custom fields (text/number/date/checkbox/dropdown) | **HAVE** | `IBoardFieldDef` (+ currency/phone/email/url/member). |
| H2 | **Single-select dropdown** | **HAVE** | `type:'dropdown'`. |
| H3 | **Multi-select field** | **MISSING** | No multi-value field type. |
| H4 | **People field** (≥1 stakeholders beyond assignee) | **PARTIAL** | `type:'member'` is single-value (one id), not multi-people. |
| H5 | **Formula field** (computed) | **MISSING** | No computed field type. |
| H6 | **Dependent / conditional fields** | **MISSING** | No field-visibility-depends-on-field. |
| H7 | **Field library / global custom fields** (org-wide reusable) | **MISSING** | Fields are board-local only. |
| H8 | **Color-coding & formatting** | **PARTIAL** | dropdown options carry color; number/currency formatting is implicit, no per-field format config. |
| H9 | **Locked custom fields** (admin lock) | **MISSING** | No lock. |
| H10 | Show-on-front | **HAVE** | `showOnFront`. |

#### I. Intake / Forms

| # | Feature | Status | Notes |
|---|---|---|---|
| I1 | **Forms** (intake → creates card, maps to fields) | **PARTIAL** | `LeadCaptureModal` + `capturedChannel:'web-form'` handle *lead* intake; no generic per-board Form builder that creates a card with field mapping. |
| I2 | Form field types / required / conditional / branding / routing / multi-form / public sharing | **MISSING** | None of the generic form-builder surface exists. |
| I3 | Public / external form sharing | **MISSING** | No public form endpoint. |

#### J. Portfolios / Goals (Asana)

| # | Feature | Status | Notes |
|---|---|---|---|
| J1 | **Portfolios** (bundle projects, status rollup) | **MISSING** | No portfolio object. |
| J2 | Portfolio custom fields / nesting / workload / timeline / dashboard / progress / messages | **MISSING** | — |
| J3 | **Goals / OKRs** (+ sub-goals, owners, auto/manual progress, connect projects, updates, periods, hierarchy, My Goals, privacy) | **MISSING** | No goals subsystem. (Closest analog: reporting overview, but not goal-shaped.) |

#### K. Workload / Capacity (Asana)

| # | Feature | Status | Notes |
|---|---|---|---|
| K1 | **Workload** (assignments on a timeline, overload detection) | **PARTIAL** | Caseload report groups open matters by assignee with avg days-in-stage — workload-adjacent for matters — but no capacity-bar timeline across all cards. |
| K2 | Capacity limits / effort fields / drag-rebalance / capacity planning / filtering | **MISSING** | No effort field, no capacity limit. |

#### L. Proofing / Approvals (Asana)

| # | Feature | Status | Notes |
|---|---|---|---|
| L1 | **Approvals** (task type w/ Approved/Changes/Rejected) | **PARTIAL** | Sign-up packets are a domain-specific approval state machine (`ISignUpPacket`); no generic per-card approval type. |
| L2 | **Proofing / image+PDF annotation** | **MISSING** | Attachments aren't annotatable (LitBox/OnlyOffice may cover externally). |
| L3 | Multi-approver workflows | **MISSING** | — |

#### M. Reporting (Asana)

| # | Feature | Status | Notes |
|---|---|---|---|
| M1 | **Reporting dashboards** (chart widgets, real-time) | **PARTIAL** | Rich domain reports exist (funnel, financial, aging, caseload, source-to-settlement, overview); no generic build-your-own chart-widget dashboard. |
| M2 | Chart types (column/line/burn-up/donut/number/lollipop) | **PARTIAL** | Distribution bars + metric tiles; not a chart-type library. |
| M3 | Project / portfolio dashboards | **PARTIAL** (project) / MISSING (portfolio) | DashboardView is per-board. |
| M4 | **Universal reporting** (cross-source) | **PARTIAL** | `boards.reports.overview` + source-to-settlement are cross-pipeline; not arbitrary cross-board chart building. |
| M5 | Interactive drill-down / chart filters / sharing / templates | **MISSING** | Reports aren't drill-through chart widgets. |

#### N. Search

| # | Feature | Status | Notes |
|---|---|---|---|
| N1 | **Search & filtering** (operators) | **PARTIAL** | `OmnisCardQuery` powers board/table filtering; no *global* cross-board search bar with operators. |
| N2 | **Advanced search** (combine filters) | **PARTIAL** | Query struct supports rich filters; no advanced-search UI/AND-OR builder. |
| N3 | **Saved searches / saved reports** (dynamic, pinned) | **PARTIAL** | Saved *views* exist (per board/pipeline/personal); not cross-board saved searches pinned in sidebar. |
| N4 | Recent / quick search / type-ahead | **MISSING** | — |
| N5 | **Saved filters / highlight** (Trello highlight matching) | **PARTIAL** | Filtering hides non-matches; no "highlight in place" mode. |

#### O. Time Tracking (Asana)

| # | Feature | Status | Notes |
|---|---|---|---|
| O1 | Time tracking (timer/manual), estimated, actual, timesheets, reporting, budgets | **MISSING** | No time/effort model. (Adjacent: matters financial report tracks $ not hours.) |

#### P. AI

| # | Feature | Status | Notes |
|---|---|---|---|
| P1 | **Generate / rewrite / summarize card content** | **HAVE** | `boards.ai.generate` + `AiAssistSection.tsx`. |
| P2 | **Summarize matter / draft demand** | **HAVE** (beyond both) | `summarizeMatter`, `draftDemand`. |
| P3 | **Smart status** (AI project status) | **MISSING** | Tied to C8. |
| P4 | **Smart fields** (suggest fields) | **MISSING** | — |
| P5 | **Smart summaries** (thread/notification) | **PARTIAL** | Card/matter context summarization exists; not applied to comment threads / inbox. |
| P6 | **Smart editor** (tone/rewrite) | **PARTIAL** | Generic `generate` can rewrite; no dedicated inline editor affordance. |
| P7 | **Smart goals / projects / workflows** | **MISSING** | Depends on Goals/Workflow-builder subsystems. |
| P8 | **AI teammates / Studio / Dash / Smart chat / MCP connectors** | **MISSING / addressed by CHI** | CHI agent (§5) is the Omnis answer to AI teammates / smart chat. |

#### Q. Integrations

| # | Feature | Status | Notes |
|---|---|---|---|
| Q1 | **Power-Up framework** (pluggable add-ons) | **MISSING** | No extension framework; Omnis composes via automation actions instead. |
| Q2 | **Slack / Teams** | **PARTIAL** | Native to Rocket.Chat channel binding (`rid`) for chat; no Slack/Teams card-share. |
| Q3 | **CasePro** (CRM) | **BUILT** (beyond both) | Deep read + write-back integration is built and merged, deployed **dark** on staging; live pending enablement + first-run verification (needs a provisioned MCP key). Not carrying live traffic yet. |
| Q4 | **LitBox** (files) | **HAVE** | Attachment source `litbox`. |
| Q5 | **Google Drive / Dropbox / OneDrive / Box** | **MISSING** | Only litbox/local/url attachment sources. |
| Q6 | **Jira / GitHub / GitLab / Bitbucket** (dev tools) | **MISSING** | — |
| Q7 | **Confluence / Miro / Figma** | **MISSING** | — |
| Q8 | **Email-to-board / Outlook / Gmail** | **PARTIAL** | Lead capture `email-parse`; no per-board email address that creates a card. |
| Q9 | **Zapier / Make / Workato** (connectors) | **MISSING** | No outbound webhook/connector surface. |
| Q10 | **Calendar sync (iCal/Google/Outlook)** | **MISSING** | No iCal feed. |
| Q11 | **BI connectors (Tableau/PowerBI/Looker)** | **MISSING** | — |
| Q12 | **Developer API + webhooks** | **PARTIAL** | Full REST exists (`boards*.ts`); no outbound webhooks / public API surface for third parties. |

#### R. Admin / Workspace / Governance

| # | Feature | Status | Notes |
|---|---|---|---|
| R1 | **Workspaces / Teams** (group boards) | **PARTIAL** | `IBoard.teamId` ties a board to an RC Team; no Boards-native workspace container with its own settings/members. |
| R2 | **Members & roles** (admin/member/observer) | **HAVE** | board-level; RC handles org roles. |
| R3 | **Permissions & visibility** | **HAVE** | `boards-*` permission set + `visibility`. |
| R4 | **Admin console** | **PARTIAL** | `AdminAutomationsPage` (automation only); no Boards admin home for members/security/export. |
| R5 | **SSO / SAML / SCIM / 2FA** | **HAVE (inherited)** | Via Rocket.Chat + CentralizedAuth. |
| R6 | **Audit log / audit API** | **PARTIAL** | `IBoardActivity` is an audit feed; no streaming audit API / SIEM export. |
| R7 | **Data export** (JSON/CSV) | **MISSING** | Tied to C14. |
| R8 | **Power-Up administration** | **MISSING** | No Power-Ups → N/A. |
| R9 | **Admin announcements** | **MISSING (Boards)** | RC has announcements. |
| R10 | **Service accounts** | **HAVE (inherited)** | KeyGate / RC bots. |
| R11 | **Billing tiers / plan gating** | **N/A‑plan** | Single-tier internal product. |
| R12 | **Mobile / desktop / offline apps** | **PARTIAL (inherited)** | RC mobile/desktop apps exist; Boards views aren't built for them. |
| R13 | **Keyboard shortcuts** | **MISSING (Boards)** | No board/card shortcuts. |
| R14 | **Theme / dark mode** | **HAVE (inherited)** | Fuselage theming. |

### 3.2 PRIORITIZED ROADMAP (PARTIAL + MISSING)

Each item gives the `IBoardCard`/type change, model touch, service function, REST endpoint, and client component.

#### P0 — Table-stakes parity (you cannot credibly say "we match Trello/Asana" without these)

These convert *existing data-model hooks* into real features. Most are S/M because the types already anticipate them.

**P0.1 — Task dependencies (blocking / waiting-on, notify-on-unblock) · Value: High · Effort: M**
The `relations[].type` union **already has** `blocks`/`blocked-by`. Make it real.
- **Type:** no field add needed; optionally add `relations[].createdBy`/`createdAt` to `IBoardCard.relations` (`IBoardCard.ts`).
- **Service:** `addRelation(uid, cardId, type, targetCardId)` / `removeRelation` in `service.ts`; auto-create the inverse edge (`blocks`↔`blocked-by`). In `updateCard`/`moveCard` completion path, when a card becomes complete, find cards with `blocked-by → thisCard`, emit `card.unblocked`, and fire a `notify` via `notifications/deliver.ts`.
- **Events:** add `card.blocked`/`card.unblocked` to `IBoardActivity.ts` verbs and the automation trigger vocabulary in `IAutomation.ts`.
- **REST:** `boards.card.relations.add` / `.remove` in `app/api/server/v1/boards.ts`.
- **Client:** "Dependencies" block in `card/CardDetail.tsx`; a blocked badge on `board/CardTile.tsx` (reuse the overdue-badge slot).

**P0.2 — Recurring cards (per-card repeat that regenerates on completion/schedule) · Value: High · Effort: M**
- **Type:** add `recurrence?: { freq: 'daily'|'weekly'|'monthly'|'custom'; interval: number; weekdays?: number[]; basis: 'dueDate'|'completion'; nextRunAt?: Date; endsAt?: Date }` to `IBoardCard` (`IBoardCard.ts`).
- **Model:** index `{ 'recurrence.nextRunAt': 1 }` in `BoardsCards.ts`.
- **Service:** `setRecurrence(uid, cardId, rule)` + `materializeRecurrence(card)` (clones title/desc/checklists/labels/assignees into a fresh card, advances `nextRunAt`) in `service.ts`. Drive it from the existing automation cron in `events.ts` (reuse the `card.dueSoon` sweep loop).
- **REST:** `boards.card.recurrence.set` in `boards.ts`.
- **Client:** repeat control in the due-date popover within `card/CardDetail.tsx`; a small ↻ glyph on `CardTile.tsx`.

**P0.3 — Generic Calendar view (card start/due, drag-to-reschedule, iCal feed) · Value: High · Effort: M**
Matters calendar exists (`matters/calendar/MattersCalendar.tsx`); generalize it.
- **Type:** `ISavedView.viewType` already enumerates `calendar` — wire it.
- **Service:** reuse `views/savedViews.ts` `queryBoardCards`; add `boards.views.cards` date-window support (it already groups; add a `dateField` month/range query). Add `buildIcalFeed(boardId, token)` in a new `server/lib/boards/views/ical.ts`.
- **REST:** `boards.views.calendar` (cards in a date window) in `boards-views.ts`; unauthenticated `boards.ical/:token.ics` feed route.
- **Client:** new `client/views/boards/views/CalendarView.tsx` (month/week grid, drag a card → PATCH `dueDate` via `updateCard`); register in `views/index.ts` + `ViewSwitcher.tsx`.

**P0.4 — Card-level completion state (independent of archive) · Value: High · Effort: S**
Asana's single most fundamental primitive; we conflate "done" with archive.
- **Type:** add `completed?: boolean` + `completedAt?: Date` + `completedBy?` to `IBoardCard` (`IBoardCard.ts`). Add `due: 'incomplete'|'complete'` already in `OmnisCardQuery` — extend filter to read `completed`.
- **Service:** `completeCard(uid, cardId, value)` in `service.ts`; emit `card.completed`/`card.reopened` (`IBoardActivity.ts`) and feed automation triggers (`IAutomation.ts`).
- **REST:** `boards.card.complete` in `boards.ts`.
- **Client:** completion checkbox on `CardTile.tsx` (left of title) + header of `CardDetail.tsx`; strike-through + dim when complete. Feeds My Tasks/dependencies (P0.1).

**P0.5 — My Tasks editable sections + auto-promote · Value: High · Effort: M**
Upgrade `MyDayPlanner.tsx` from fixed buckets to Asana-grade sections.
- **Type:** new `IMyTasksLayout` (per-user: ordered sections, per-card section assignment, `markedForToday[]`) — store on a new tiny model `BoardsMyTasks.ts` (or on `IUser` settings).
- **Service:** `getMyTasks(uid)` / `setSection` / `markForToday` / auto-promote sweep (Upcoming→Today as `dueDate` crosses) in a new `server/lib/boards/planner/myTasks.ts`; drive auto-promote from `events.ts` cron.
- **REST:** `boards.cards.myDay` exists — add `boards.myTasks.layout.get/set`, `.markForToday` in `boards.ts`.
- **Client:** extend `planner/MyDayPlanner.tsx` with reorderable sections + a "Today" pin.

**P0.6 — Multi-select & multi-people custom field types · Value: Med-High · Effort: S**
- **Type:** add `'multiselect'` and `'multimember'` to `BoardsFieldType` (`IBoard.ts`); allow `BoardsFieldValue` to be `string[]` (widen the union in `IBoardCard.ts`).
- **Service:** `updateCard` field-value validation in `service.ts` accepts arrays for these types.
- **Client:** multi-chip editors in `views/TableView.tsx` and the fields block in `CardDetail.tsx`; render multi-chips on `CardTile.tsx`.

**P0.7 — Generic Forms (intake → card, field mapping, public link) · Value: High · Effort: L**
Lead capture proves the pattern; generalize to any board.
- **Type:** new `IBoardForm` (boardId, targetListId, fields[{label, type, required, mapsToFieldDefId}], branding, conditional rules, publicToken) → new model `BoardsForms.ts`.
- **Service:** `server/lib/boards/forms/service.ts`: `createForm`/`updateForm`/`submitForm` (creates a card via `createCard`, maps answers → `fieldValues`).
- **REST:** authenticated `boards.forms.create/update/list` in a new `boards-forms.ts`; **public** unauthenticated `boards.forms.submit/:token` + `boards.forms.render/:token`.
- **Client:** `client/views/boards/forms/FormBuilder.tsx` + a public `FormRenderRoute.tsx` (new route in `routes.tsx`).

**P0.8 — Card copy/duplicate · Value: Med · Effort: S**
`card.copied` verb already exists.
- **Service:** `copyCard(uid, cardId, opts:{checklists,labels,assignees,attachments,dueDate})` in `service.ts`.
- **REST:** `boards.card.copy` in `boards.ts`.
- **Client:** "Copy card" in the card actions menu (`CardDetail.tsx`).

**P0.9 — Notification preferences + push + inbox actions · Value: High · Effort: M**
- **Type:** `IBoardNotificationPrefs` (per-user per-event channel matrix: inApp/email/push, frequency) on a new model or `IUser` settings.
- **Service:** read prefs in `notifications/deliver.ts` before fan-out; add Rocket.Chat **push** delivery (RC already has push infra) alongside in-app/email. Add `snooze`/`mute` to `BoardsNotifications.ts`.
- **REST:** `boards.notifications.prefs.get/set`, `.snooze` in `boards-notifications.ts`; `boards.notifications.action` (comment/complete from inbox).
- **Client:** prefs panel; add inline action buttons + snooze to `notifications/NotificationsInbox.tsx`.

**P0.10 — Description/checklist @mentions · Value: Med · Effort: S**
- **Service:** in `updateCard`, parse `@user` tokens in `description` (and checklist item text) → notify via `deliver.ts`, same path as comment mentions.
- **Client:** mention autocomplete in the description editor in `CardDetail.tsx`.

#### P1 — Competitive parity (clearly expected, not day-one blockers)

**P1.1 — Gantt / true Timeline (bars start→due, dependency lines, drag-reschedule) · Value: High · Effort: L**
Builds on P0.1 (deps) + start/due already present.
- **Client:** new `views/GanttView.tsx` (SVG bars, dependency edges from `relations`, drag handles → `updateCard` start/due). Register in `ViewSwitcher.tsx`/`index.ts`; `ISavedView.viewType` add `'gantt'`.
- **Service:** reuse `queryBoardCards`; add critical-path helper in `views/`.

**P1.2 — Milestones · Value: Med · Effort: S**
- **Type:** add `'milestone'` to `BoardsCardType` (or `isMilestone?: boolean`) in `IBoardCard.ts`.
- **Client:** diamond glyph on `CardTile.tsx`, Gantt (P1.1), and Calendar (P0.3); milestone filter in `OmnisCardQuery`.

**P1.3 — First-class subtasks (Asana-grade) · Value: High · Effort: L**
Beyond checklists.
- **Type:** add `parentCardId?: string` to `IBoardCard` (`IBoardCard.ts`) (already have `relations parent/child` as the lighter analog).
- **Service:** `createSubtask`/`promoteSubtask` in `service.ts`; roll subtask completion into parent progress.
- **Client:** subtask tree in `CardDetail.tsx` with own assignee/due/comments.

**P1.4 — Card templates (mark-as-template + New-from-template) · Value: Med · Effort: M**
- **Type:** `isTemplate?: boolean` on `IBoardCard`; optional Templates pseudo-list.
- **Service:** `createCardFromTemplate(uid, templateCardId, listId)` (reuses `copyCard`).
- **REST:** `boards.card.templates.list`, `boards.card.fromTemplate` in `boards.ts`.
- **Client:** template picker in `QuickAddCard.tsx`.

**P1.5 — Card mirroring / multi-home · Value: Med-High · Effort: L**
`mirrorOf` + `card.mirrored` exist; build the sync.
- **Type:** add `homes?: { boardId; listId; position }[]` to support true multi-home (Asana) vs single `mirrorOf` (Trello).
- **Service:** `mirrorCard`/`multiHomeCard` in `service.ts`; on `updateCard`, propagate field changes to mirrors/homes (skip per-home position).
- **Client:** "Add to other board" in `CardDetail.tsx`; mirror indicator on `CardTile.tsx`.

**P1.6 — Configurable Dashboard / chart-widget reporting · Value: High · Effort: L**
Generalize `DashboardView.tsx` + the report library.
- **Type:** `IDashboardWidget` (chart type, source query, group-by) saved alongside `ISavedView` (`viewType:'dashboard'` exists).
- **Service:** `computeWidget(query, groupBy, agg)` in `server/lib/boards/reports/`.
- **REST:** `boards.reports.widget` in `boards-reports.ts`.
- **Client:** widget grid + chart components (column/donut/number/line) in `views/DashboardView.tsx`; drill-through to filtered Table.

**P1.7 — Global cross-board search + saved searches · Value: High · Effort: M**
- **Service:** `globalSearch(uid, OmnisCardQuery, boardScope?)` in `server/lib/boards/reads.ts` (Mongo text index across `BoardsCards`).
- **REST:** `boards.search` in `boards.ts`; `boards.searches.save/list` (reuse `ISavedView scope:'personal'`).
- **Client:** search bar in `BoardsLayout.tsx`/sidebar with operators + type-ahead; results route.

**P1.8 — Generic per-card Approvals · Value: Med · Effort: M**
Generalize the signup-packet state machine.
- **Type:** `approval?: { approvers: string[]; status: 'pending'|'approved'|'changes'|'rejected'; decidedBy?; decidedAt? }` on `IBoardCard`.
- **Service:** `requestApproval`/`decideApproval` in `service.ts`; events `card.approved` etc. + automation triggers.
- **Client:** approval block in `CardDetail.tsx`; status badge on tile.

**P1.9 — Project Overview + Status Updates (+ Smart Status AI) · Value: Med-High · Effort: M**
- **Type:** `IBoardStatusUpdate` (color on-track/at-risk/off-track, narrative, ts, author) → new model `BoardsStatusUpdates.ts`; `IBoard.brief?: string`.
- **Service:** `postStatusUpdate`/`listStatusUpdates`; AI variant calls `ai/index.ts` `generate` for Smart Status.
- **REST:** `boards.status.post/list` in `boards.ts`.
- **Client:** Overview tab in `BoardHeader.tsx`/new `board/OverviewTab.tsx`.

**P1.10 — List colors + bulk list ops + cross-board list move · Value: Low-Med · Effort: S**
- **Type:** add `color?: string` to `IBoardList` (`IBoardList.ts`).
- **Service:** `updateList` accepts color; `sortListCards(listId, by)` + `moveAllCards(listId, targetListId)`; `moveListToBoard`.
- **Client:** color picker + "sort/move all" in `board/Column.tsx` header.

**P1.11 — Board copy / board templates / Unsplash backgrounds · Value: Med · Effort: M**
- **Service:** `copyBoard(uid, boardId, opts)` (deep-clone lists/fieldDefs/labelDefs/automations) + `saveBoardAsTemplate` in `service.ts`.
- **REST:** `boards.copy`, `boards.templates.list/install` in `boards.ts`.
- **Client:** "Duplicate / Save as template" in `BoardHeader.tsx`; Unsplash picker in `NewBoardModal.tsx`.

**P1.12 — Data export (CSV/JSON) + board files gallery · Value: Med · Effort: S**
- **Service:** `exportBoard(uid, boardId, format)` in `reports/`; `listBoardAttachments` aggregation over `BoardsCards.attachments`.
- **REST:** `boards.export` + `boards.files` in `boards.ts`.
- **Client:** Export menu item + `board/FilesTab.tsx`.

**P1.13 — Card aging + voting · Value: Low · Effort: S**
- **Type:** `votes?: string[]` on `IBoardCard`; aging is computed from last activity (`updatedAt`).
- **Client:** fade/vote-badge on `CardTile.tsx`; toggle in board settings.

**P1.14 — OR / branching conditions in automation · Value: Med · Effort: M**
- **Type:** extend `IAutomation` conditions to a nested `{ all:[], any:[] }` tree + an `if/else` action group (`IAutomation.ts`).
- **Service:** update the evaluator in `service.ts`/`events.ts`.
- **Client:** branch UI in `automation/builder/ConditionRows.tsx` + `ActionRows.tsx`.

#### P2 — Differentiators, enterprise & long-tail

**P2.1 — Goals / OKRs subsystem · Value: Med (enterprise) · Effort: L**
New `IGoal`/`ISubGoal` types, `BoardsGoals.ts`, `server/lib/boards/goals/`, `boards-goals.ts`, `client/views/boards/goals/`. Connect boards→goals; auto-progress from card completion %. Pairs with Smart Goals AI.

**P2.2 — Portfolios · Value: Med (enterprise) · Effort: L**
`IPortfolio` (member boards, rollup), `BoardsPortfolios.ts`, status/progress/timeline rollup reading per-board metrics, `client/views/boards/portfolios/`.

**P2.3 — Workload & capacity · Value: Med · Effort: L**
Add `effort?: number` to `IBoardCard`; per-user `capacityLimit`; `computeWorkload` in `reports/`; `client/views/boards/workload/WorkloadView.tsx` with drag-rebalance (→ `updateCard.assignees`).

**P2.4 — Time tracking · Value: Med (legal billing) · Effort: M**
`timeEntries?: { userId, minutes, note, ts }[]` + `estimateMinutes?` on `IBoardCard`; timer + manual entry in `CardDetail.tsx`; timesheet report in `reports/`. High strategic value given the legal vertical (billable hours).

**P2.5 — Formula / dependent / locked / global custom fields · Value: Med · Effort: M-L**
Add `'formula'` field type with an expression evaluator (server-computed, read-only) in `service.ts`; `dependsOn` for conditional visibility; an org-level field library model `BoardsFieldLibrary.ts` with admin lock.

**P2.6 — Outbound webhooks + Zapier/Make connector surface · Value: High (ecosystem) · Effort: M**
`addWebhook` action in `IAutomation.ts` action union + `server/lib/boards/automation` HTTP dispatch; outbound event webhooks registry model. Unlocks Zapier/Make/Workato without per-tool work.

**P2.7 — Cloud-storage attachment sources (Drive/Dropbox/OneDrive/Box) · Value: Med · Effort: M**
Widen `IAttachment.source` union + OAuth pickers; per-provider preview resolvers alongside the existing litbox resolver in `CardTile.tsx`.

**P2.8 — Dev-tool & design integrations (GitHub/Jira/Figma/Miro) · Value: Low (legal vertical) · Effort: L each**
Attachment + status-sync adapters; likely lowest ROI for OmnisAI's audience.

**P2.9 — Email-to-board (per-board inbound address) · Value: Med · Effort: M**
Inbound-mail parser (reuse lead `email-parse`) → `createCard`; per-board address in board settings.

**P2.10 — Calendar sync (iCal/Google/Outlook two-way) · Value: Med · Effort: M**
Extends P0.3 iCal feed to subscribed two-way sync.

**P2.11 — Map view · Value: Low · Effort: M**
`location?: { lat; lng; label }` field-type; `client/views/boards/views/MapView.tsx`.

**P2.12 — Planner (time-blocking) · Value: Med · Effort: L**
Calendar-grid personal planner that drags cards into time slots, syncing external calendar; extends `MyDayPlanner.tsx` + P0.3.

**P2.13 — Proofing / PDF annotation · Value: Low-Med · Effort: L**
Likely delegate to LitBox/OnlyOffice rather than build in Boards.

**P2.14 — Boards admin console + audit export + workspaces + keyboard shortcuts · Value: Med · Effort: M each**
Generalize `AdminAutomationsPage.tsx` into a Boards admin home (members/security/export); audit-stream endpoint over `IBoardActivity`; a Boards-native workspace container over `teamId`; a keyboard-shortcut layer in `BoardView.tsx`/`CardDetail.tsx`.

**P2.15 — Sharing links / public boards / guests / comment-only role · Value: Med · Effort: M**
Add `'comment'` to `IBoardMember.role`; shareable-link tokens + `'public'` to `IBoard.visibility`; guest scoping distinct from members.

**P2.16 — Bundles (reusable rules+fields+sections, centrally updated) · Value: Med · Effort: M**
Extend the automation template-install to package `fieldDefs`+`labelDefs`+lists+rules and keep a link for central updates.

### 3.3 Sequencing rationale (parity workstream)

1. **P0.1, P0.4, P0.2** first — dependencies, card completion, and recurrence are the three Asana/Trello primitives whose **data model already exists or is one field away**, yet whose absence is most obvious to any evaluator. Highest value-to-effort ratio in the whole roadmap.
2. **P0.3 + P0.5 + P0.9** next — Calendar view, My Tasks sections, and notification prefs/push are the personal-productivity surfaces users hit daily; they also unblock P1.1 (Gantt) and P2.12 (Planner).
3. **P0.7 (Forms)** is the one P0 that's L-effort, but it is genuinely table-stakes for Asana parity and reuses the proven lead-capture pattern — worth front-loading.
4. **P1** delivers the "looks complete" layer (Gantt, milestones, subtasks, dashboards, global search, approvals, status updates).
5. **P2** is where OmnisAI should be selective: **time tracking (P2.4)** and **webhooks/Zapier (P2.6)** are high-leverage for a legal SaaS; Goals/Portfolios/Workload matter only if you sell into larger firms; dev-tool/design/map integrations are the safest to defer indefinitely given the personal-injury-law audience.

**Net:** Closing P0 (≈6–8 weeks of focused work, mostly S/M because the types anticipate it) reaches credible Trello+Asana parity; P1 reaches "obviously competitive"; P2 is strategic, with time-tracking and the webhook/connector surface being the two highest-ROI differentiators for the legal vertical.

**Key verified source files for parity implementation:** `packages/core-typings/src/IBoardCard.ts` (lines 91–130 hold `relations`/`mirrorOf` — the dependency & mirror hooks), `IBoard.ts` (`BoardsFieldType` union lines 6–16, `IBoardFieldDef` line 29), `IBoardList.ts` (15 lines — add `color`), `apps/meteor/server/lib/boards/service.ts` (12 exported CRUD functions, lines 30–424), `apps/meteor/server/lib/boards/events.ts` (cron sweep to reuse for recurrence/auto-promote), `apps/meteor/client/views/boards/views/` (add `CalendarView.tsx`/`GanttView.tsx` beside the existing 4), and `apps/meteor/app/api/server/v1/boards.ts` (where new card-level routes attach).

---

## 4. BRING-YOUR-OWN-AI provider architecture

### 4.0 Design thesis & relationship to the existing Boards AI seam

The repo already contains a *working, narrow* BYO-AI seam at `apps/meteor/server/lib/boards/ai/`. It is single-shot, two-provider (Claude + LitDraft), and scoped to the `Boards_Reporting` settings group. The CHI agent and any product-wide AI feature need something broader: **multi-provider, multi-model, tool-calling, streaming, cost-guarded, and admin-scoped at the workspace level**.

Rather than fork or duplicate that logic, this design **promotes the seam into a shared `server/lib/ai/` gateway** and makes the existing Boards code a *thin caller* of it. The hard contract that makes the Boards seam reliable — **nothing throws; every failure returns a degraded result** — is preserved and elevated to a system-wide invariant.

```
                    ┌─────────────────────────────────────────────┐
   CHI agent ──────▶│                                             │
   Boards AI ──────▶│   server/lib/ai/   (the BYO-AI GATEWAY)     │──▶ OpenAI
   /ai command ────▶│   gateway + registry + guards + adapters    │──▶ Anthropic
   future feats ───▶│                                             │──▶ Azure OpenAI
                    └─────────────────────────────────────────────┘──▶ OpenAI-compatible
                                                                        (Ollama / vLLM / LiteLLM)
```

The two load-bearing invariants carried over from the existing seam: **(1) the API key is `public:false` + `secret:true` so it never reaches the browser**, and **(2) nothing in the gateway throws — every failure returns `{ ok:false, note }`** so all callers degrade cleanly.

### 4.1 Settings

#### 4.1.1 New top-level settings group

New file: **`/Users/davidnguyen/MatterChat/apps/meteor/server/settings/ai.ts`**, registered alongside the existing settings modules. This creates a product-wide `AI` group (distinct from the Boards-scoped `Boards_Reporting` group), so AI config is no longer buried under Boards.

Every key follows the proven repo idiom confirmed in `boardsReporting.ts`: the API key is `public: false` **and** `secret: true`, gated by an `enableQuery` on the provider. That combination is what keeps it off the browser publication (`public-settings/get` only serves `findNotHiddenPublic()`).

```typescript
// apps/meteor/server/settings/ai.ts
import { settingsRegistry } from '../../app/settings/server';

export const createAiSettings = () =>
  settingsRegistry.addGroup('AI', async function () {
    // ── Section: General ──────────────────────────────────────────────
    await this.section('AI_General', async function () {
      await this.add('AI_Enabled', false, {
        type: 'boolean',
        public: true,                  // clients may know AI is on (to show UI); not the key
        i18nLabel: 'AI_Enabled',
        i18nDescription: 'AI_Enabled_Description',
      });

      await this.add('AI_Provider', 'anthropic', {
        type: 'select',
        public: false,
        i18nLabel: 'AI_Provider',
        values: [
          { key: 'anthropic',          i18nLabel: 'AI_Provider_Anthropic' },
          { key: 'openai',             i18nLabel: 'AI_Provider_OpenAI' },
          { key: 'azure-openai',       i18nLabel: 'AI_Provider_AzureOpenAI' },
          { key: 'openai-compatible',  i18nLabel: 'AI_Provider_OpenAICompatible' }, // Ollama/vLLM/LiteLLM
        ],
        enableQuery: { _id: 'AI_Enabled', value: true },
      });

      await this.add('AI_Model', 'claude-opus-4-8', {
        type: 'string',
        public: false,
        i18nLabel: 'AI_Model',
        placeholder: 'claude-opus-4-8 | gpt-4o | llama3.1:70b',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
    });

    // ── Section: Credentials (SECRET) ─────────────────────────────────
    await this.section('AI_Credentials', async function () {
      // The ONE setting that must never reach a browser. public:false + secret:true.
      await this.add('AI_Api_Key', '', {
        type: 'string',
        public: false,
        secret: true,                  // redacted in admin export; server-only
        i18nLabel: 'AI_Api_Key',
        i18nDescription: 'AI_Api_Key_Description',
        // OpenAI-compatible self-host (e.g. local Ollama) often needs no key.
        enableQuery: {
          $or: [
            { _id: 'AI_Provider', value: 'anthropic' },
            { _id: 'AI_Provider', value: 'openai' },
            { _id: 'AI_Provider', value: 'azure-openai' },
          ],
        },
      });

      // Self-host / Azure / proxy endpoint. Empty → adapter uses the provider default host.
      await this.add('AI_Base_Url', '', {
        type: 'string',
        public: false,
        i18nLabel: 'AI_Base_Url',
        placeholder: 'http://localhost:11434/v1  |  https://my-vllm:8000/v1',
        enableQuery: {
          $or: [
            { _id: 'AI_Provider', value: 'azure-openai' },
            { _id: 'AI_Provider', value: 'openai-compatible' },
          ],
        },
      });

      // Azure deployment-name + api-version (Azure routes by deployment, not model id).
      await this.add('AI_Azure_Deployment', '', {
        type: 'string', public: false, i18nLabel: 'AI_Azure_Deployment',
        enableQuery: { _id: 'AI_Provider', value: 'azure-openai' },
      });
      await this.add('AI_Azure_Api_Version', '2024-10-21', {
        type: 'string', public: false, i18nLabel: 'AI_Azure_Api_Version',
        enableQuery: { _id: 'AI_Provider', value: 'azure-openai' },
      });
    });

    // ── Section: Generation parameters ────────────────────────────────
    await this.section('AI_Parameters', async function () {
      await this.add('AI_Max_Tokens', 4096, {
        type: 'int', public: false, i18nLabel: 'AI_Max_Tokens',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
      await this.add('AI_Temperature', 0.2, {       // stored as string + parseFloat; see note
        type: 'string', public: false, i18nLabel: 'AI_Temperature', placeholder: '0.0 – 1.0',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
      await this.add('AI_Request_Timeout_Ms', 60000, {
        type: 'int', public: false, i18nLabel: 'AI_Request_Timeout_Ms',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
      await this.add('AI_Max_Retries', 2, {
        type: 'int', public: false, i18nLabel: 'AI_Max_Retries',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
    });

    // ── Section: Cost / rate guardrails ───────────────────────────────
    await this.section('AI_Limits', async function () {
      await this.add('AI_Monthly_Token_Cap', 0, {    // 0 = unlimited
        type: 'int', public: false, i18nLabel: 'AI_Monthly_Token_Cap',
        i18nDescription: 'AI_Monthly_Token_Cap_Description',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
      await this.add('AI_Monthly_Cost_Cap_USD', 0, {  // 0 = unlimited
        type: 'int', public: false, i18nLabel: 'AI_Monthly_Cost_Cap_USD',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
      await this.add('AI_Rate_Limit_Per_Min', 30, {   // per-workspace request ceiling
        type: 'int', public: false, i18nLabel: 'AI_Rate_Limit_Per_Min',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
    });

    // ── Section: Scope ────────────────────────────────────────────────
    await this.section('AI_Scope', async function () {
      // Workspace-wide today. Flip on to ALLOW (not require) per-user keys.
      await this.add('AI_Allow_Per_User_Keys', false, {
        type: 'boolean', public: true, i18nLabel: 'AI_Allow_Per_User_Keys',
        i18nDescription: 'AI_Allow_Per_User_Keys_Description',
        enableQuery: { _id: 'AI_Enabled', value: true },
      });
    });
  });
```

#### 4.1.2 Settings key summary

| Key | Type | public | secret | Purpose |
|---|---|---|---|---|
| `AI_Enabled` | boolean | ✅ | — | Master gate; clients may read to show/hide UI |
| `AI_Provider` | select | ❌ | — | `openai` \| `anthropic` \| `azure-openai` \| `openai-compatible` |
| `AI_Model` | string | ❌ | — | Model id / Ollama tag |
| **`AI_Api_Key`** | string | ❌ | **✅** | **The secret. Never published to browser.** |
| `AI_Base_Url` | string | ❌ | — | Self-host / Azure / proxy endpoint |
| `AI_Azure_Deployment` / `AI_Azure_Api_Version` | string | ❌ | — | Azure routing |
| `AI_Max_Tokens` / `AI_Temperature` | int/string | ❌ | — | Generation params |
| `AI_Request_Timeout_Ms` / `AI_Max_Retries` | int | ❌ | — | Transport resilience |
| `AI_Monthly_Token_Cap` / `AI_Monthly_Cost_Cap_USD` / `AI_Rate_Limit_Per_Min` | int | ❌ | — | Guardrails (0 = unlimited) |
| `AI_Allow_Per_User_Keys` | boolean | ✅ | — | Scope toggle |

> **Note on `AI_Temperature` / per-user keys.** Rocket.Chat settings have no float type; store temperature as a string and `parseFloat` in the gateway (the Boards code already reads settings defensively). **Per-user keys** must *not* be Rocket.Chat settings (those are global). When `AI_Allow_Per_User_Keys` is on, store a user's encrypted key on a private field of their user document or a dedicated `rocketchat_ai_user_credentials` collection, never as a setting — see §4.4.

Wire the registration where the other settings modules are initialized (the same place `createBoardsReportingSettings()` is called during server startup).

### 4.2 The server-side LLM gateway

#### 4.2.1 Module layout — exact paths

```
apps/meteor/server/lib/ai/
├── index.ts                  # public entry: chatComplete(), streamChatComplete(), getGateway()
├── types.ts                  # shared normalized schema (messages, tools, tool calls, usage)
├── gateway.ts                # provider selection + guard pipeline (rate/cost/timeout/retry/redaction)
├── config.ts                 # reads AI_* settings → typed AiConfig (defensive, never throws)
├── errors.ts                 # AiError taxonomy (all caught → degraded result)
├── redact.ts                 # key/secret redaction for logs
├── usage.ts                  # token accounting + monthly cap ledger (Mongo-backed)
├── ratelimit.ts              # per-workspace sliding-window limiter
└── adapters/
    ├── base.ts               # IAiAdapter interface + shared HTTP helper (server-fetch)
    ├── anthropic.ts          # Anthropic Messages API (promotes ClaudeProvider)
    ├── openai.ts             # OpenAI Chat Completions
    ├── azureOpenai.ts        # Azure OpenAI (deployment routing, api-version)
    └── openaiCompatible.ts   # Ollama / vLLM / LiteLLM (OpenAI-shaped, optional key)
```

#### 4.2.2 The normalized schema (`types.ts`)

Modeled on the union of Anthropic tool-use and OpenAI function-calling so every adapter maps cleanly in both directions.

```typescript
// apps/meteor/server/lib/ai/types.ts

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

/** A tool/function the model may call. JSON-Schema params (shared by OpenAI & Anthropic). */
export interface AiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

/** A model-emitted request to invoke a tool (normalized across both providers). */
export interface AiToolCall {
  id: string;                 // provider call id, echoed back on the tool result
  name: string;
  arguments: Record<string, unknown>;
}

/** One message in the normalized conversation. */
export interface AiMessage {
  role: AiRole;
  content: string;            // text content (empty allowed when toolCalls present)
  /** assistant turn that requested tools */
  toolCalls?: AiToolCall[];
  /** when role==='tool': which call this answers + the result payload */
  toolCallId?: string;
  toolName?: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD when the adapter can price the model; else undefined. */
  estimatedCostUsd?: number;
}

export type AiFinishReason = 'stop' | 'length' | 'tool_use' | 'refusal' | 'error';

/** Inbound request to the gateway. */
export interface AiChatRequest {
  messages: AiMessage[];
  tools?: AiTool[];
  /** Force/allow tool use. 'auto' (default), 'none', or a specific tool name. */
  toolChoice?: 'auto' | 'none' | { name: string };
  /** Per-call overrides; fall back to AI_* settings. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Audit/scope context — drives usage ledger + rate bucket. */
  caller: { feature: string; userId?: string; workspaceScope?: string };
}

/**
 * HARD CONTRACT (inherited from the Boards seam): the gateway NEVER throws.
 * Transport/config/guard failures all return ok:false with a human note.
 */
export interface AiChatResult {
  ok: boolean;
  text: string;
  toolCalls?: AiToolCall[];
  finishReason: AiFinishReason;
  provider: 'anthropic' | 'openai' | 'azure-openai' | 'openai-compatible' | 'none';
  model: string;
  usage?: AiUsage;
  /** Present when ok:false (degraded) — e.g. "AI not configured", "rate limit", "provider 502". */
  note?: string;
}

/** Streaming variant: a normalized event stream. */
export type AiStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCall: AiToolCall }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'done'; finishReason: AiFinishReason }
  | { type: 'error'; note: string };
```

#### 4.2.3 The adapter interface (`adapters/base.ts`)

```typescript
// apps/meteor/server/lib/ai/adapters/base.ts
import type { AiChatRequest, AiChatResult, AiStreamEvent } from '../types';
import type { AiConfig } from '../config';

/**
 * One adapter per provider. MUST NOT throw — translate every failure into a
 * degraded AiChatResult (ok:false, note) exactly like the Boards ClaudeProvider.
 * The gateway wraps these with timeout/retry/usage/rate guards, so adapters
 * stay transport-only.
 */
export interface IAiAdapter {
  readonly id: AiChatResult['provider'];

  /** Single-shot (may return toolCalls when finishReason==='tool_use'). */
  chatComplete(req: AiChatRequest, cfg: AiConfig): Promise<AiChatResult>;

  /** Optional streaming. Adapters without it are driven via chatComplete by the gateway. */
  streamChatComplete?(req: AiChatRequest, cfg: AiConfig): AsyncIterable<AiStreamEvent>;
}
```

#### 4.2.4 Adapter shape — Anthropic (promotes the existing `ClaudeProvider`)

The current `ClaudeProvider` is the template. The adapter adds tool mapping and reuses the same raw-HTTP transport via `@rocket.chat/server-fetch` (no SDK dependency added — consistent with the documented gap).

```typescript
// apps/meteor/server/lib/ai/adapters/anthropic.ts
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import type { IAiAdapter } from './base';
import type { AiChatRequest, AiChatResult, AiToolCall } from '../types';
import type { AiConfig } from '../config';

const DEFAULT_HOST = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export const anthropicAdapter: IAiAdapter = {
  id: 'anthropic',

  async chatComplete(req, cfg): Promise<AiChatResult> {
    if (!cfg.apiKey) {
      return degraded('AI not configured (no API key)', 'anthropic', cfg.model);
    }
    const host = (cfg.baseUrl || DEFAULT_HOST).replace(/\/+$/, '');

    // ── map normalized → Anthropic ──────────────────────────────────
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => toAnthropicMessage(m));        // assistant tool_use / user tool_result blocks
    const tools = req.tools?.map((t) => ({
      name: t.name, description: t.description, input_schema: t.parameters,
    }));

    try {
      const res = await fetch(`${host}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,                // never logged — see redact.ts
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: req.model ?? cfg.model,
          max_tokens: req.maxTokens ?? cfg.maxTokens,
          temperature: req.temperature ?? cfg.temperature,
          system: system || undefined,
          messages,
          ...(tools ? { tools } : {}),
          ...(req.toolChoice && req.toolChoice !== 'auto'
            ? { tool_choice: mapToolChoice(req.toolChoice) } : {}),
        }),
        ignoreSsrfValidation: true,               // matches CasePro/Boards transport precedent
      });

      if (!res.ok) return degraded(`Anthropic request failed (${res.status})`, 'anthropic', req.model ?? cfg.model);
      const json = await res.json();
      if (json.error)             return degraded(`Anthropic error: ${json.error?.type ?? 'unknown'}`, 'anthropic', req.model ?? cfg.model);
      if (json.stop_reason === 'refusal') return { ...degraded('Model declined the request', 'anthropic', req.model ?? cfg.model), finishReason: 'refusal' };

      const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
      const toolCalls: AiToolCall[] = (json.content ?? [])
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ id: b.id, name: b.name, arguments: b.input ?? {} }));

      return {
        ok: true, text, toolCalls: toolCalls.length ? toolCalls : undefined,
        finishReason: json.stop_reason === 'tool_use' ? 'tool_use' : 'stop',
        provider: 'anthropic', model: req.model ?? cfg.model,
        usage: json.usage
          ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
          : undefined,
      };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return degraded(`Anthropic unavailable: ${m}`, 'anthropic', req.model ?? cfg.model);
    }
  },

  // streamChatComplete?: SSE parse of /v1/messages?stream=true → AiStreamEvent (omitted for brevity)
};

function degraded(note: string, provider: AiChatResult['provider'], model: string): AiChatResult {
  return { ok: false, text: '', finishReason: 'error', provider, model, note };
}
// toAnthropicMessage / mapToolChoice: map normalized tool turns to content blocks.
```

**OpenAI adapter** (`adapters/openai.ts`) is the same shape against `POST {baseUrl||https://api.openai.com/v1}/chat/completions`, mapping:
- normalized `messages` → OpenAI `messages` (`tool` role + `tool_call_id`),
- `tools` → `[{ type:'function', function:{ name, description, parameters } }]`,
- response `choices[0].message.tool_calls[]` → `AiToolCall[]` (parsing `arguments` JSON string),
- `usage.prompt_tokens`/`completion_tokens` → `AiUsage`.

**Azure adapter** (`adapters/azureOpenai.ts`) reuses the OpenAI mapping but routes to `{AI_Base_Url}/openai/deployments/{AI_Azure_Deployment}/chat/completions?api-version={AI_Azure_Api_Version}` with the `api-key` header.

**OpenAI-compatible adapter** (`adapters/openaiCompatible.ts`) is the OpenAI adapter with `cfg.apiKey` optional (Ollama/vLLM frequently need none) and a mandatory `cfg.baseUrl` (e.g. `http://localhost:11434/v1`). This single adapter covers Ollama, vLLM, LiteLLM, and any OpenAI-shaped endpoint.

#### 4.2.5 Gateway selection + guard pipeline (`gateway.ts`)

```typescript
// apps/meteor/server/lib/ai/gateway.ts  (sketch)
export async function chatComplete(req: AiChatRequest): Promise<AiChatResult> {
  const cfg = readAiConfig();                       // config.ts — never throws
  if (!cfg.enabled)            return offResult(cfg.model, 'AI disabled (AI_Enabled = false)');

  // 1. RATE GUARD (per workspace, sliding window) — degrade, don't throw.
  if (!rateLimiter.tryAcquire(req.caller))   return degraded(cfg, 'Rate limit exceeded; try again shortly');

  // 2. COST/TOKEN CAP GUARD (monthly ledger) — pre-check projected, hard-stop if over.
  if (usageLedger.isOverCap(cfg))            return degraded(cfg, 'Monthly AI usage cap reached');

  const adapter = selectAdapter(cfg.provider);      // anthropic|openai|azure-openai|openai-compatible
  if (!adapter)                return offResult(cfg.model, `Unknown provider "${cfg.provider}"`);

  // 3. TIMEOUT + RETRY around the adapter call.
  const result = await withRetry(cfg.maxRetries, () =>
    withTimeout(cfg.timeoutMs, () => adapter.chatComplete(req, cfg)),
  );

  // 4. USAGE ACCOUNTING (best-effort; tolerates missing usage).
  if (result.ok && result.usage) usageLedger.record(req.caller, result.usage, cfg);

  return result;                                    // always a well-formed AiChatResult
}
```

`selectAdapter` is the multi-provider equivalent of the Boards `resolveAiProvider(task)` — but keyed on `AI_Provider`, not task. (Boards keeps its own task routing and simply calls this gateway underneath.)

#### 4.2.6 Public entry (`index.ts`)

```typescript
// apps/meteor/server/lib/ai/index.ts
export { chatComplete } from './gateway';
export { streamChatComplete } from './gateway';   // returns AsyncIterable<AiStreamEvent>
export type {
  AiMessage, AiTool, AiToolCall, AiChatRequest, AiChatResult, AiStreamEvent, AiUsage,
} from './types';
```

**Agent loop note (CHI).** The gateway is single-call by design. The CHI agent loop lives *above* it: call `chatComplete` → if `finishReason === 'tool_use'`, run each `toolCall` (CasePro reads/writes, board actions), append `role:'tool'` results, and call again until `finishReason==='stop'`. This closes the documented "no tools/agent loop" gap without putting orchestration inside the transport layer. See §5.

### 4.3 Security

1. **Key is server-only.** `AI_Api_Key` is `public:false` + `secret:true`. Per the confirmed publication model, `public-settings/get` only serves `Settings.findNotHiddenPublic()`, so a `public:false` setting is *never* sent to anonymous or regular clients. `private-settings/get` additionally requires admin setting-view permissions. The browser never receives the key.

2. **All model calls are server-side.** Adapters live under `server/lib/ai/` and use `@rocket.chat/server-fetch`. There is no client transport. Client UI talks only to the REST/method surface in §4.5, which runs the gateway on the server.

3. **Key redaction in logs (`redact.ts`).** A single `redactSecrets(obj|string)` helper strips `x-api-key`, `Authorization`, `api-key`, and any value matching `cfg.apiKey` before anything reaches `SystemLogger`. Adapters log status codes and notes, **never headers or bodies containing the key**. (The Boards seam already avoids logging the key; this makes it a reusable, enforced helper.)

4. **Rate + cost guard.** `ratelimit.ts` (sliding window, `AI_Rate_Limit_Per_Min`, per workspace) and `usage.ts` (Mongo `rocketchat_ai_usage` ledger keyed by `YYYY-MM`, enforcing `AI_Monthly_Token_Cap` / `AI_Monthly_Cost_Cap_USD`). Both **degrade** (return `ok:false, note`) rather than throw, so callers render a clean "cap reached" callout.

5. **Timeout + retry.** `withTimeout(AI_Request_Timeout_Ms)` aborts hung calls; `withRetry(AI_Max_Retries)` retries only idempotent transport failures (network errors, 429, 5xx) with backoff — **never** retries a 4xx auth error (would just burn the key) or a `refusal`.

6. **SSRF posture for self-host.** Self-host endpoints (`AI_Base_Url`) legitimately point at internal hosts (Ollama on `localhost`, vLLM in-cluster), so `ignoreSsrfValidation: true` matches the CasePro/Boards precedent. **Harden it:** validate `AI_Base_Url` against an admin-set allow-list (or at minimum require `http(s)` + reject link-local/metadata IPs like `169.254.169.254`) in `config.ts` before the adapter is allowed to use it.

7. **Per-user key encryption.** If `AI_Allow_Per_User_Keys` is enabled, user keys are stored encrypted-at-rest (AES-GCM with a server-held key), not as global settings, and are decrypted only inside the gateway request — never returned to the client.

### 4.4 Secret-storage & scope notes

- **Workspace-wide (default):** one `AI_Api_Key` for the whole workspace, exactly the Boards pattern — admin-gated, secret, server-only.
- **Per-user (opt-in):** gated by `AI_Allow_Per_User_Keys`. Stored in a dedicated `rocketchat_ai_user_credentials` collection (`{ userId, provider, encryptedKey, baseUrl }`), **encrypted**, resolved in `config.ts` by precedence: *valid per-user key → workspace key → degrade*. The gateway's `caller.userId` drives this lookup. This keeps per-user secrets out of the global settings system (which is broadcast-shaped and wrong for per-user data).

### 4.5 Where it lives — REST / Meteor-method surface

New REST file: **`/Users/davidnguyen/MatterChat/apps/meteor/app/api/server/v1/ai.ts`**, mirroring the structure of the existing `boards-ai.ts`. Validators go in **`/Users/davidnguyen/MatterChat/packages/rest-typings/src/v1/ai.ts`** (mirroring `boards-ai.ts` validators).

| Endpoint | Method | Body | Gate |
|---|---|---|---|
| `ai.chat` | POST | `{ messages, tools?, toolChoice?, model?, feature }` | `ai-use` permission |
| `ai.stream` | POST (SSE) | same as `ai.chat` | `ai-use` |
| `ai.status` | GET | — | `ai-use` |

**Permission.** Add a sibling to the existing `boards-ai-generate` constant in `/Users/davidnguyen/MatterChat/apps/meteor/app/authorization/server/constant/permissions.ts`:

```typescript
{ _id: 'ai-use',          roles: ['admin', 'attorney', 'case-manager'] },
{ _id: 'manage-ai-settings', roles: ['admin'] },   // gates the AI settings group edit
```

Each endpoint calls `chatComplete(...)` / `streamChatComplete(...)` from `server/lib/ai` and returns the normalized `AiChatResult`. Because the gateway never throws, the endpoint always returns `200` with `ok:true|false`, and the client renders the degraded `note` in a neutral Callout — the exact pattern `AiAssistSection.tsx` already implements.

**Boards refactor (non-breaking).** `server/lib/boards/ai/provider.ts` keeps its `IAiProvider` / task routing, but `ClaudeProvider.generate` becomes a thin wrapper that builds `AiMessage[]` from `systemPromptFor`/`userMessageFor` and calls `chatComplete({ caller:{ feature:'boards' }, ... })`. Boards behavior is unchanged; it just stops owning transport. Regression-test the 17/17 Boards path.

### 4.6 BYO-AI key files (all absolute)

- New gateway: `/Users/davidnguyen/MatterChat/apps/meteor/server/lib/ai/` (index, types, gateway, config, errors, redact, usage, ratelimit, adapters/*)
- New settings: `/Users/davidnguyen/MatterChat/apps/meteor/server/settings/ai.ts`
- New REST: `/Users/davidnguyen/MatterChat/apps/meteor/app/api/server/v1/ai.ts`
- New validators: `/Users/davidnguyen/MatterChat/packages/rest-typings/src/v1/ai.ts`
- Edit permissions: `/Users/davidnguyen/MatterChat/apps/meteor/app/authorization/server/constant/permissions.ts` (after line 298)
- Refactor (non-breaking): `/Users/davidnguyen/MatterChat/apps/meteor/server/lib/boards/ai/provider.ts`
- Pattern references: `/Users/davidnguyen/MatterChat/apps/meteor/server/settings/boardsReporting.ts` (secret-setting idiom), `/Users/davidnguyen/MatterChat/apps/meteor/server/settings/oauth.ts` (secret precedent), `/Users/davidnguyen/MatterChat/apps/meteor/client/views/boards/card/AiAssistSection.tsx` (degraded-state client UI template)

---

## 5. THE CHI AGENT architecture

CHI is a conversational agent that runs *above* the BYO-AI gateway (§4). A user turn flows from the panel → the streamed `boards.chi.turn` endpoint → the agent loop (which holds the system prompt, permission-filtered tools, and guardrails) → the BYO-AI gateway adapter and back, with tool calls executed against the **existing** boards services under the caller's identity. Every write lands in the activity feed as actor `chi:<userId>` and in the append-only `ChiAuditLog`.

### 5.1 Runtime — the agent loop

The loop sits on top of the gateway's single-call `chatComplete`:

1. Build the message list: system prompt (§5.3) + conversation history + the new user turn.
2. Attach the permission-filtered tool catalog (§5.2) as `tools`.
3. Call `chatComplete({ tools, toolChoice:'auto', caller:{ feature:'chi', userId } })` and stream text deltas to the panel.
4. If `finishReason === 'tool_use'`: for each `toolCall`, **authorize on the server** under the caller's identity (re-run the real route guards), execute the existing service method or read route, append a `role:'tool'` result message, and loop back to step 3.
5. If a tool is write-class and not pre-approved, **pause and emit an inline approval gate** to the panel; resume on approval, abort on reject.
6. Stop when `finishReason === 'stop'`; persist the turn + every tool call to `ChiAuditLog`.

**Why this design holds up:**
- **Reuses everything.** No new business logic — every CHI write is an existing service method (`createCard`, `moveCard`, `updateCard`, `archiveCard`) and every read is an existing route (`boards.cards.myDay`, `boards.views.cards`, `boards.activities`). CHI inherits permissions, activity logging, notifications, automation triggers, and CasePro gating for free.
- **Security is not in the prompt.** The model only *proposes*; the server *authorizes* under the caller's identity and re-runs the real route guards, so a jailbreak can never exceed the user's actual permissions.
- **No fabricated ids.** An id-provenance tracker rejects any id the model didn't first obtain from a read tool in the same turn.
- **Trust is visible.** Streaming + a live tool-call trace + an inline approval gate make every action observable and reversible before it lands.
- **Genuinely BYO / multi-model.** The loop and tools are provider-agnostic; only the thin `GatewayAdapter` differs across OpenAI / Anthropic / self-host, and the user can switch models per turn.

### 5.2 Tool catalog (MVP — 6 tools)

Each tool is a thin wrapper over an existing service method or read route. The catalog is **permission-filtered per caller** before being handed to the model, so the model never sees a tool the user can't use.

| Tool | Class | Backed by | Approval |
|---|---|---|---|
| `planMyDay` | read | `boards.cards.myDay` | none |
| `summarizeBoard` | read | `boards.views.cards` + `boards.activities` | none |
| `searchCards` | read | board card query | none |
| `createCard` | write | `createCard` service | inline gate |
| `moveCard` | write | `moveCard` service | inline gate |
| `completeCard` / `markDone` | write | `updateCard` / `completeCard` service | inline gate |

Growth path beyond MVP: composers (`generateTasks`, `scaffoldBoard`), `archiveCard`, automation authoring, and CasePro read/write tools (gated by the existing CasePro permissions).

### 5.3 System prompt / guardrails

- **System prompt** establishes CHI's role (a project-management copilot for Omnis Boards), the available tools, and the hard rules: never invent ids, always read before you write, prefer the smallest action, surface uncertainty.
- **Guardrails (enforced in code, not the prompt):**
  - *Server-side authorization.* Every tool call re-runs the real route guard under `caller.userId`. The prompt is advisory; the guard is binding.
  - *Id-provenance tracking.* The loop records every id returned by a read tool this turn; a write tool whose target id was not previously read is rejected before execution.
  - *Write approval gate.* Write-class tools pause for inline user approval unless pre-approved for the session.
  - *Audit.* Every proposed and executed tool call is appended to `ChiAuditLog` (append-only) and the executed writes also land in `IBoardActivity` as actor `chi:<userId>`.
  - *Cost/rate.* Inherited from the gateway guards (§4.3) since CHI calls `chatComplete`.

### 5.4 UI surface

- **MVP:** one **contextual-bar panel** — `ChiContextualBar.tsx` — with streamed assistant text, a live tool-call trace (each call shows tool name, args, and result), an inline approval gate for write actions, and a per-turn model switcher (BYO multi-model).
- **Growth:** a full `/boards/chi` view and an `@chi` bot user that can be @-mentioned in board-bound channels.

### 5.5 MVP slice

~14 files, one streamed endpoint, 6 tools, one contextual-bar panel — a real round-trip you can demo end to end: **plan my day → summarize this board → create a card (with approval) → mark done**. Then grow into composers (`generateTasks`, `scaffoldBoard`), the `/boards/chi` view, and the `@chi` bot user.

### 5.6 CHI key file anchors (all absolute)

- Server loop: `/Users/davidnguyen/MatterChat/apps/meteor/server/lib/boards/chi/loop.ts`
- Tool registry: `/Users/davidnguyen/MatterChat/apps/meteor/server/lib/boards/chi/registry.ts`
- Streamed endpoint: `/Users/davidnguyen/MatterChat/apps/meteor/app/api/server/v1/boards-chi.ts` (`boards.chi.turn`)
- Panel: `/Users/davidnguyen/MatterChat/apps/meteor/client/views/boards/chi/ChiContextualBar.tsx`
- New permission `boards-use-chi`: `/Users/davidnguyen/MatterChat/apps/meteor/server/lib/boards/permissions.ts`
- Audit model: `/Users/davidnguyen/MatterChat/apps/meteor/server/models/BoardsChiAudit.ts`
- Consumes the gateway: `/Users/davidnguyen/MatterChat/apps/meteor/server/lib/ai/index.ts` (`chatComplete` with `tools` + `tool_use` iteration)

---

## 6. RECOMMENDED BUILD ORDER (next implementation phase)

Lead with the BYO-AI gateway and the CHI MVP (they unlock the AI-first differentiation and are mostly net-new, low-regression-risk code), interleaved with the top P0 parity items whose data model already exists. Ordered checklist:

**Phase A — BYO-AI gateway foundation**
1. `server/settings/ai.ts` + register it where `createBoardsReportingSettings()` is called; add i18n keys; add `ai-use` / `manage-ai-settings` permissions in `app/authorization/server/constant/permissions.ts` (after line 298).
   - Files: `apps/meteor/server/settings/ai.ts`, `apps/meteor/app/authorization/server/constant/permissions.ts`
2. `server/lib/ai/{types,config,errors,redact}.ts` (no transport yet).
   - Files: `apps/meteor/server/lib/ai/types.ts`, `config.ts`, `errors.ts`, `redact.ts`
3. `adapters/{base,anthropic}.ts` — port `ClaudeProvider`, add tool mapping; unit-test against existing Boards behavior.
   - Files: `apps/meteor/server/lib/ai/adapters/base.ts`, `adapters/anthropic.ts`
4. `adapters/{openai,azureOpenai,openaiCompatible}.ts`.
   - Files: `apps/meteor/server/lib/ai/adapters/openai.ts`, `azureOpenai.ts`, `openaiCompatible.ts`
5. `gateway.ts` + `usage.ts` + `ratelimit.ts` (guards) + `index.ts`.
   - Files: `apps/meteor/server/lib/ai/gateway.ts`, `usage.ts`, `ratelimit.ts`, `index.ts`
6. REST surface + validators.
   - Files: `apps/meteor/app/api/server/v1/ai.ts`, `packages/rest-typings/src/v1/ai.ts`
7. Refactor Boards `ClaudeProvider` to call the gateway; regression-test the 17/17 Boards path.
   - Files: `apps/meteor/server/lib/boards/ai/provider.ts`

**Phase B — CHI MVP** (consumes Phase A)
8. New `boards-use-chi` permission + audit model.
   - Files: `apps/meteor/server/lib/boards/permissions.ts`, `apps/meteor/server/models/BoardsChiAudit.ts`
9. Tool registry (6 MVP tools wrapping existing services/reads) + agent loop (id-provenance, approval gate, audit write).
   - Files: `apps/meteor/server/lib/boards/chi/registry.ts`, `apps/meteor/server/lib/boards/chi/loop.ts`
10. Streamed endpoint `boards.chi.turn`.
    - Files: `apps/meteor/app/api/server/v1/boards-chi.ts`
11. Contextual-bar panel (streamed text, tool-call trace, approval gate, per-turn model switcher).
    - Files: `apps/meteor/client/views/boards/chi/ChiContextualBar.tsx`
12. Demo the round-trip: plan my day → summarize board → create card (approval) → mark done.

**Phase C — Top P0 parity items** (interleave with B where team capacity allows; these are the highest value-to-effort and several also enrich CHI's tool catalog)
13. **P0.4 Card-level completion** (S) — the single most fundamental missing primitive; also the backing for CHI's `markDone` tool.
    - Files: `packages/core-typings/src/IBoardCard.ts`, `IBoardActivity.ts`, `IAutomation.ts`, `apps/meteor/server/lib/boards/service.ts`, `apps/meteor/app/api/server/v1/boards.ts`, `client/views/boards/board/CardTile.tsx`, `card/CardDetail.tsx`
14. **P0.1 Task dependencies** (M) — data model already present in `relations[]`.
    - Files: `IBoardCard.ts`, `IBoardActivity.ts`, `IAutomation.ts`, `service.ts`, `notifications/deliver.ts`, `app/api/server/v1/boards.ts`, `card/CardDetail.tsx`, `board/CardTile.tsx`
15. **P0.2 Recurring cards** (M) — reuse the `events.ts` cron sweep.
    - Files: `IBoardCard.ts`, `packages/models/src/models/BoardsCards.ts`, `server/lib/boards/service.ts`, `server/lib/boards/events.ts`, `app/api/server/v1/boards.ts`, `card/CardDetail.tsx`, `board/CardTile.tsx`
16. **P0.3 Generic Calendar view + iCal** (M) — generalize `MattersCalendar.tsx`.
    - Files: `server/lib/boards/views/savedViews.ts`, new `server/lib/boards/views/ical.ts`, `app/api/server/v1/boards-views.ts`, new `client/views/boards/views/CalendarView.tsx`, `views/index.ts`, `ViewSwitcher.tsx`
17. **P0.5 My Tasks sections + auto-promote** (M) — also upgrades CHI's `planMyDay` substrate.
    - Files: new `server/lib/boards/planner/myTasks.ts`, new `packages/models/src/models/BoardsMyTasks.ts`, `server/lib/boards/events.ts`, `app/api/server/v1/boards.ts`, `client/views/boards/planner/MyDayPlanner.tsx`
18. **P0.9 Notification prefs + push + inbox actions** (M).
    - Files: `server/lib/boards/notifications/deliver.ts`, `packages/models/src/models/BoardsNotifications.ts`, `app/api/server/v1/boards-notifications.ts`, `client/views/boards/notifications/NotificationsInbox.tsx`
19. **P0.6 Multi-select / multi-people fields** (S), **P0.8 Card copy** (S), **P0.10 desc/checklist @mentions** (S) — quick wins.
    - Files: `IBoard.ts`, `IBoardCard.ts`, `service.ts`, `app/api/server/v1/boards.ts`, `views/TableView.tsx`, `card/CardDetail.tsx`, `board/CardTile.tsx`
20. **P0.7 Generic Forms** (L) — front-load as the one large P0; reuses the lead-capture pattern.
    - Files: new `packages/models/src/models/BoardsForms.ts`, new `server/lib/boards/forms/service.ts`, new `app/api/server/v1/boards-forms.ts`, new `client/views/boards/forms/FormBuilder.tsx` + `FormRenderRoute.tsx`, `routes.tsx`

After Phase C, proceed to P1 (Gantt, milestones, subtasks, configurable dashboards, global search, approvals, status updates) per §3.2, and selectively to P2 (lead with time-tracking P2.4 and webhooks/Zapier P2.6 for the legal vertical).

---

## 7. Open product decisions to flag for the founder

1. **Self-host an OSS model vs BYO-key-only.** The architecture supports both today: `openai-compatible` adapter + `AI_Base_Url` already covers a self-hosted Ollama/vLLM endpoint with no per-token cost, while the workspace `AI_Api_Key` covers managed OpenAI/Anthropic. Decision: do we *operate* an OSS model as a default (infra + GPU cost, ongoing ops) or ship BYO-key-only and let firms point at their own endpoint? Recommendation leans BYO-key-only first (zero infra), with self-host as a documented option, but this is a cost/positioning call.

2. **Per-user keys vs workspace key.** `AI_Allow_Per_User_Keys` is off by default (workspace-wide key, the Boards precedent). Turning it on adds the encrypted `rocketchat_ai_user_credentials` collection and per-user secret management. Decision: do firms want one firm-paid key (simpler, central cost control) or per-attorney keys (attribution, BYO billing)? This affects onboarding UX and the cost-attribution story.

3. **Cost controls — caps, defaults, and who sets them.** `AI_Monthly_Token_Cap`, `AI_Monthly_Cost_Cap_USD`, and `AI_Rate_Limit_Per_Min` default to unlimited / 30 rpm. Decisions: ship with conservative non-zero defaults to prevent bill shock? Expose per-user/per-feature sub-caps (e.g. cap CHI separately from Boards summarization)? Surface a usage dashboard to admins? The ledger (`usage.ts`) makes all of these cheap to add but the *policy* is a founder call.

4. **CHI write-approval default.** Should write-class tools (`createCard`, `moveCard`, `markDone`) require inline approval every time, be pre-approvable per session, or be auto-approved for trusted roles? Stricter is safer for launch and demos; looser is faster for power users. Recommendation: inline approval on by default, with a per-session "approve all" toggle.

5. **Which roles get `ai-use` / `boards-use-chi`.** The draft grants `ai-use` to `admin`/`attorney`/`case-manager`. Decision: is AI a firm-wide capability or a gated premium one? This also interacts with the cost-control decision (#3).

6. **Parity scope ceiling for the legal vertical.** Several P2 items (Goals/OKRs, Portfolios, Workload, dev-tool/design/map integrations) primarily matter for larger/general-purpose buyers. Decision: how far up-market does Omnis Boards intend to sell? If the audience stays personal-injury firms, time-tracking (billable hours) and the webhook/Zapier connector surface are the high-ROI P2s and the enterprise-planning items can be deferred indefinitely.
