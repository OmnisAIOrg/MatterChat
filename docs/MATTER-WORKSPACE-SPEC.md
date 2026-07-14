# Matter Workspace — the legal-staff matter panel in MatterChat Boards

Status: shipped with `feature/matter-workspace` (stacked on `fix/matter-panel-usesetting-import`).
Surface: `apps/meteor/client/views/boards/card/MatterPanel.tsx` + `card/matter/**`, rendered by `card/CardDetail.tsx` for every `cardType: 'matter'` board card, inside the Contextualbar.

---

## Plain-language explainer (what legal staff can do from a matter card)

Click any matter card on the Matters board and the right-hand panel is now a working
matter file, not just a data dump:

- **See the matter at a glance** — matter name, matter number, client, current stage and
  sub-stage, practice area, and whether the CasePro data you are looking at is fresh or
  stale (a yellow "Stale" tag appears when it is old, with a Refresh button to re-pull it).
- **Watch the clock** — date of incident, the statute of limitations as a live risk chip
  (gray when far out, yellow inside 90 days, red inside 30 days or past), and the demand
  expiration chip when a demand is outstanding.
- **Read the money** — a financial card with total billed, outstanding balance, last
  demand, top offer, settlement amount, and the provider count.
- **Know the case posture** — cause number, liability status, and the matter team
  (attorney and case manager first).
- **Work deadlines** — the full deadline list with status (open / acknowledged /
  satisfied / waived / missed), red escalation on near or overdue high-risk items,
  one-click Acknowledge (required on high-risk deadlines before they can be resolved),
  Mark-satisfied, and an inline "Add deadline" form (kind, due date, label, high-risk flag).
- **Run playbooks** — progress bars for every checklist a stage playbook created, and a
  picker to apply another playbook (which adds its checklist items and deadlines).
- **See sibling products** — tags showing the matter already exists in LitBox and/or
  MedChron (informational for now; they become deep links once web-URL settings exist).
- **Use AI** — one-click AI matter summary and AI Stowers demand draft (permission-gated,
  copy-out only, gracefully degrades when no AI is configured).
- **Live in chat** — create a dedicated matter channel, jump straight into it, see
  whether the channel is logging its messages back to CasePro, or unlink it.
- **Jump out** — "Open in CasePro" goes straight to the matter in the CasePro web app
  (hidden unless an admin configured `CasePro_Web_URL`).

Everything CasePro owns is **read-only** here — the panel is a window into the system of
record, never a second place to edit it. Card-level work (title, description, labels,
checklists, subtasks, time tracking, comments, activity) stays in the card detail that
hosts the panel; nothing is duplicated.

And the bug that used to white-screen the whole app when you clicked a matter card is
fixed **and fenced**: every card panel now renders inside a local error boundary, so any
future panel bug degrades to an inline error with a Retry button instead of taking down
the client.

---

## Dev spec

### Architecture

- **Host**: `card/CardDetail.tsx` renders `MatterPanel` for `cardType === 'matter'`
  inside the Contextualbar. CardDetail already provides for every card: title/description
  editing, labels, card-button automations, checklists, subtasks, time tracking,
  comments, and the Activity tab. MatterPanel intentionally renders none of those.
- **Error containment**: `card/CardErrorBoundary.tsx` (react-error-boundary +
  `QueryErrorResetBoundary`, Callout fallback with Retry) wraps both `MatterPanel` and
  `LeadPanel` in CardDetail. A panel render crash no longer reaches the app-root
  `OutermostErrorBoundary`.
- **Data model**: `card.link` is
  `{ kind: 'matter'; matterId; roomId?; snapshot?: IMatterSnapshot; snapshotAt? }`.
  CasePro is the system of record; `IMatterSnapshot` is a denormalized render cache.
  The panel reads live via `GET /v1/boards.casepro.matterSnapshot`; if that read fails it
  falls back to the card's cached `link.snapshot`, flagged Stale, with a soft warning
  callout instead of a dead error state.
- **Refresh**: re-runs the live read; for holders of `boards-casepro-sync` it first calls
  `POST /v1/boards.matters.refreshSnapshot` so the card's cached copy (everyone else's
  fallback) is rewritten too.
- **Staleness**: `snapshot.stale`, a cached-fallback render, or `fetchedAt` older than
  24h (`SNAPSHOT_STALE_MS`) shows the warning tag.

### File map (all new files under `client/views/boards/card/`)

| File | Responsibility |
| --- | --- |
| `MatterPanel.tsx` | Assembler: snapshot query + refresh mutation + section order |
| `CardErrorBoundary.tsx` | Local error boundary for card panels (matter + lead) |
| `matter/MatterHeader.tsx` | Eyebrow + name/number/client + stage/practice/stale chips + Open-in-CasePro / Jump-to-channel + freshness caption |
| `matter/KeyDatesStrip.tsx` | DOI chip, SOL risk chip, demand-expiration chip (client-side date math) |
| `matter/FinancialSummaryCard.tsx` | Tinted money card: billed / balance / demand / offer / settlement + provider count |
| `matter/MoneyRow.tsx` | Currency row (tabular numerals, emphasis variant for settlement) |
| `matter/LitigationSection.tsx` | Cause #, liability, team roster (attorney / case manager first) |
| `matter/DeadlinesSection.tsx` | Deadline list w/ status tags + inline create + acknowledge + mark-satisfied |
| `matter/PlaybooksSection.tsx` | Checklist progress bars + apply-playbook picker |
| `matter/IntegrationsSection.tsx` | LitBox / MedChron presence tags (ids in tooltips; no invented URLs) |
| `matter/ChannelSection.tsx` | Create/unlink matter channel, comms-log status, jump |
| `matter/MatterSection.tsx` | Shared section shell (icon + title + optional action) |
| `matter/MatterField.tsx` | Label/value row, renders nothing when empty |
| `matter/useMatterChannel.ts` | Shared rooms.info read + jump (private-group route resolves by name) |
| `matter/matterFormatters.ts` | Currency/date/risk helpers + thresholds |

### Endpoints used (all pre-existing; registered in `app/api/server/v1/boards-matters.ts`, `boards.ts`, `boards-ai.ts`)

- `GET  /v1/boards.casepro.matterSnapshot` — live read-through (perm `boards-casepro-view`)
- `POST /v1/boards.matters.refreshSnapshot` — rewrite cached snapshot (perm `boards-casepro-sync`)
- `GET  /v1/boards.matters.deadlines.list` (perm `boards-matters-view`)
- `POST /v1/boards.matters.deadlines.create` (perm `boards-matters-deadlines-manage`)
- `POST /v1/boards.matters.deadlines.acknowledge` (perm `boards-matters-deadlines-acknowledge`)
- `POST /v1/boards.matters.deadlines.setStatus` (perm `boards-matters-deadlines-manage`; server enforces ack-before-resolve on high-risk)
- `GET  /v1/boards.matters.playbooks.list` / `POST /v1/boards.matters.playbooks.apply` (perm `boards-matters-playbooks-manage` on apply)
- `POST /v1/boards.matters.linkChannel` / `POST /v1/boards.matters.unlinkChannel` (perm `boards-matters-edit`)
- `POST /v1/boards.ai.summarizeMatter` / `POST /v1/boards.ai.draftDemand` (perm `boards-ai-generate`; unchanged `AiAssistSection`)
- `GET  /v1/rooms.info` — linked-channel name/type/comms-log flag

No new server endpoints. No schema changes. No settings changes.

### Client-side UI permission gates (server still enforces)

- Add-deadline form + Mark-satisfied: `boards-matters-deadlines-manage`
- Acknowledge: `boards-matters-deadlines-acknowledge`
- Cached-snapshot rewrite on Refresh: `boards-casepro-sync` (others still re-read live)
- AI section hidden without `boards-ai-generate` (pre-existing behavior)

### Risk thresholds (client-side date math, `matterFormatters.ts`)

- SOL / deadline: danger ≤ 30 days or passed; warning ≤ 90 days (high-risk kinds); else neutral
- Demand expiration: danger when passed; warning ≤ 14 days
- Snapshot staleness: `stale` flag, cached fallback, or `fetchedAt` > 24h

### Design language

Fuselage only (`Box`, `Button`, `Tag`, `Chip`, `Callout`, `Select`, `InputBox`,
`ProgressBar`, `Icon`, `Throbber`, `CheckBox`); token props (`fontScale`, `color='hint'`,
`bg='tint'`, logical spacing props); no raw CSS, no hex colors. Icons restricted to the
shipped icon set (`bag`, `calendar`, `clock`, `stopwatch`, `card`, `shield`, `book`,
`clip`, `hash`, `arrow-jump`, `new-window`, …). New i18n strings ship with
`defaultValue` fallbacks (keys can be promoted into `packages/i18n` in a follow-up).

### Honest scope limits

- CasePro matter fields are read-only by design — there is no CasePro field-edit endpoint,
  so the panel never fakes editability.
- LitBox / MedChron tags are informational: no `LitBox_Web_URL` / `MedChron_Web_URL`
  settings exist, and we do not invent URLs (the previous `/admin/litbox/...` hrefs were
  dead routes and were removed).
- The panel remains a Contextualbar panel; a full-page matter route is out of scope here.
- "Jump to channel" needs `rooms.info` to resolve the private group's route name; the
  button stays disabled until that read lands.
