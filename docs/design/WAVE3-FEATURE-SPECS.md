# Wave 3 Feature Specifications — MatterChat

**Build Phase:** Q3 2026 roadmap expansion. Eleven features spanning board templates, data portability, notifications, knowledge base, calendar sync, guest access, subtasks, SMS, async meetings, and AI knowledge agents.

---

## 1. Board Templates

### Problem & User Story

Legal firms standardize their workflows into repeatable templates: PI intake checklists, discovery stage gates, settlement negotiations. MatterChat boards are built manually each matter, replicating structure every time. This blocks velocity for paralegal ops and prevents firm-wide process capture.

**User story:** "As a managing partner, I need to capture our PI intake workflow as a reusable template so that every new matter starts with the same gate structure and field defaults without manual rebuild."

### UX Flow

1. **Save as Template:** Open any board → Menu → "Save as Template" → Name + description + choose scope (private/team/firm gallery) → saves snapshot with all lists, fields, labels, permissions.
2. **New from Template:** Boards list → "+ New" → "From Template" → browse/search gallery → select → name new board + select team → creates new board with all copied structure; card data (if any) excluded.
3. **Firm Template Gallery:** Admin panel → "Board Templates" → browse published templates by pipeline type (matters/leads/general) with previews (list/field schema), usage count, last-updated date, duplicate/edit/deprecate actions.
4. **Seed Templates:** Ship 3 built-in templates (PI Intake Checklist, Discovery Phase Tasks, Settlement Negotiations) pre-loaded in firm gallery.

### Data Model

**New collection: `BoardTemplates`** (stored in Rocket.Chat MongoDB)
```typescript
interface IBoardTemplate extends IRocketChatRecord {
  name: string; // e.g. "PI Intake Checklist"
  description?: string;
  pipelineType: BoardsPipelineType; // 'matters' | 'leads' | 'general'
  
  // Snapshot of structure (no card data)
  lists: Array<{
    id: string; // template-local id
    name: string;
    order: number;
    defaultStageId?: string; // for CasePro sync binding
  }>;
  
  fieldDefs: IBoardFieldDef[]; // copied as-is
  labelDefs: IBoardLabelDef[]; // copied as-is
  
  // Access control
  visibility: 'private' | 'team' | 'firm'; // private = creator only, team = team members, firm = gallery
  teamId?: string; // for team-scoped templates
  createdBy: IUser['_id'];
  
  // Governance
  deprecated?: boolean; // deprecated templates hide from gallery but don't break existing boards
  usageCount?: number; // denormalized count of boards created from this template
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
}
```

### API Surface

```
POST   /api/v1/boards.templates.save
  - body: { boardId, name, description?, visibility, teamId? }
  - response: { templateId, uri }

GET    /api/v1/boards.templates.list
  - query: { pipelineType?, visibility?, offset, count, search? }
  - response: { templates: IBoardTemplate[], total, count, offset }

POST   /api/v1/boards.create
  - NEW: body: { teamId, name, templateId? }
  - if templateId provided, board structure copied from template

GET    /api/v1/boards.templates.info
  - query: { templateId }
  - response: { template, boards_created_count, last_used_at? }

POST   /api/v1/boards.templates.update
  - body: { templateId, name?, description?, visibility?, deprecated? }
  - gated: only template creator or admin

DELETE /api/v1/boards.templates.delete
  - query: { templateId }
  - gated: only creator or admin; does not affect existing boards
```

### Permissions

- **Save as template:** board admin/member with `admin` role only
- **New from template:** any authenticated user (team-visible template checks via team membership; firm gallery only to admins initially, expand to all users on rollout)
- **Edit/delete template:** template creator + workspace admin
- **Publish to firm gallery:** workspace admin only (initial; template author approval possible in future)

### Dependencies / Blast Radius

- **Internal:** new MongoDB collection + service under `server/lib/boards/templates.ts` + REST routes in `boards.ts`
- **External:** none — templates are workspace-local (no CasePro sync, no integrations yet)
- **Migration:** none needed (green-field feature)
- **Performance:** template list UI paginated (50/page); search via MongoDB text index on name + description

### Build Estimate

**M** (Medium, 3–4 days): CRUD service + REST layer straightforward; schema copy logic straightforward; admin gallery UI + client-side template browser component + seed template JSON fixtures

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_TEMPLATES_ENABLED` (default: false). Rollout:
1. Alpha: internal firm only
2. Beta: opt-in via admin toggle
3. GA: default on for all workspaces; toggle remains for ops override

---

## 2. Board Export / Import

### Problem & User Story

Legal teams need to archive boards for audit/compliance, migrate workflows between instances, and backup critical board data. MatterChat has no export/import path; destruction is unrecoverable.

**User story:** "As a compliance officer, I need to export a completed litigation board with all cards, fields, comments, and activity logs in a format we can archive and restore if needed, plus import workflows from Trello."

### UX Flow

1. **Export:** Open board → Menu → "Export" → choose format (JSON/CSV) + date range (for activity) → download `board-[title]-[date].json` or `.csv`
   - JSON: full-fidelity board dump (structure + all card data + comments + activity)
   - CSV: cards only (one per row, custom fields as columns, comments inline or separate)
2. **Import:** Workspace → "+ New Board" → "Import" → upload JSON/Trello JSON → preview structure + card count → choose list destinations + merge strategy (new lists or append to existing) → import with progress bar
3. **Compliance Archive:** Export includes a manifest (title, created/updated dates, member list, CasePro bindings if any, HIPAA redaction state if applicable)

### Data Model

**Export format: JSON (canonical)**
```typescript
interface IBoardExport {
  version: '1.0'; // schema versioning for future compatibility
  exportedAt: Date;
  board: IBoard; // full board doc (minus _id, dates normalized)
  
  lists: Array<{
    ...IBoardList,
    cards: Array<{
      ...IBoardCard,
      comments: Array<{
        ...IComment,
      }>;
      activities: Array<{
        ...IActivity,
      }>;
    }>;
  }>;
  
  manifest: {
    title: string;
    createdBy: string; // userId (humanized in export)
    createdAt: Date;
    updatedAt: Date;
    cardCount: number;
    commentCount: number;
    activityCount: number;
    pipelineType: BoardsPipelineType;
    caseproBinding?: {
      matterStageMap: Record<string, string>;
    };
  };
}

// CSV export: one card per row, field columns + activity column (newest 3 activity entries as text)
interface IBoardExportCSV {
  card_id: string;
  card_number: string;
  title: string;
  status: string; // list name
  [fieldName: string]: string | number | boolean; // custom fields expanded
  comments_count: number;
  last_comment: string;
  activity_summary: string;
  created_at: Date;
  updated_at: Date;
  assigned_to: string; // user name(s)
}
```

**Import strategy:** new service under `server/lib/boards/import.ts` handles:
- Trello JSON → MatterChat schema (maps Trello lists → MatterChat lists, Trello labels → MatterChat labels)
- MatterChat JSON → direct restore (field-by-field copy, new _ids, preserve structure)
- Merge modes: `new_board` (always create new), `append_lists` (add to existing board), `merge_duplicates` (dedup by card title if exists in target)

### API Surface

```
POST   /api/v1/boards.export
  - body: { boardId, format: 'json' | 'csv', activityDaysBack?: number }
  - response: { success, downloadUrl } → streaming download
  - gated: board observer+

GET    /api/v1/boards.export.status
  - query: { exportId }
  - response: { status: 'pending' | 'completed' | 'failed', progress: number, eta_seconds? }

POST   /api/v1/boards.import
  - body (multipart/form-data): { file: File, format: 'json' | 'trello', boardId? }
  - response: { importId, preview: { listCount, cardCount, fieldCount }, status: 'ready' }

POST   /api/v1/boards.import.execute
  - body: { importId, mergeStrategy: 'new_board' | 'append_lists', targetBoardId?, boardName?, teamId? }
  - response: { boardId, cardsImported, listsCreated, status: 'completed' | 'partial_fail' }

GET    /api/v1/boards.import.status
  - query: { importId }
  - response: { status, progress, errors?: string[] }
```

### Permissions

- **Export:** board observer+ (same as read)
- **Import:** team member+ (imports create new board into team); existing board import requires board admin

### Dependencies / Blast Radius

- **Internal:** new service `boards/import.ts` + routes; streaming downloads via Meteor (standard pattern)
- **External:** none
- **Performance:** exports stream to disk (no memory spike); imports chunk card inserts (1000 per batch)
- **Storage:** exports stored temporarily in `/tmp` or S3 (configurable); cleanup after 7 days

### Build Estimate

**M** (Medium, 3–4 days): export serialization straightforward (template-to-JSON iteration); import parsing + conflict resolution logic; Trello schema translation; UI preview component; streaming/chunking infrastructure

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_EXPORT_IMPORT_ENABLED` (default: false). Rollout:
1. Alpha: JSON export only (no import yet)
2. Beta: JSON export + import, no Trello support
3. GA: all formats enabled; ops can disable export for SOC2/HIPAA workspaces if needed

---

## 3. Board Push Notifications

### Problem & User Story

Board activity (card assigned, due date approaching, mention in comment, approval requested, stage change) disappears into the in-app inbox. Legal team members work across apps (email, Slack, Teams) and miss critical board updates unless they actively check MatterChat. Push notifications bridge that gap.

**User story:** "As a paralegal on a complex matter, I need push notifications when I'm assigned a card or mentioned in a comment, so I can respond immediately even when MatterChat isn't the active app."

### UX Flow

1. **Notification Trigger:** Card event fires (assigned, due soon, mentioned, approval requested, stage changed)
2. **Delivery:** MatterChat sends to browser (if subscribed to push) + in-app bell (always); payload includes card title, action, actor
3. **Click action:** user clicks notification → navigates to card detail panel in the relevant board
4. **Preference:** see feature #4 (Notification Preferences Matrix)

### Data Model

**Extend existing `BoardsNotifications` model** (already stores in-app notification events)

**New Web Push delivery:**
- Reuse `apps/meteor/app/web-push/server/send.ts` infrastructure (Rocket.Chat's built-in VAPID-based Web Push)
- Wire boards notification service to emit `WebPushEvent` for subscribed users
- Payload schema:
```typescript
interface IBoardsPushPayload {
  title: string; // "Alice assigned you to 'Discovery responses due'"
  body?: string; // optional summary
  icon: string; // Rocket.Chat icon or custom boards icon
  badge?: string; // notification badge (custom MatterChat icon)
  tag: string; // 'board_card_assigned' etc. for coalescing duplicates
  data: {
    boardId: string;
    cardId: string;
    action: BoardNotificationAction; // 'assigned' | 'mentioned' | 'approved' | 'due_soon' | 'stage_changed'
    actorUserId: string;
    actorName: string;
  };
}
```

**Board notification preferences:** stored in new `UserBoardNotificationPrefs` collection (see feature #4)

### API Surface

**Extend existing `boards.notifications.*` routes:**

```
PUT    /api/v1/boards.notifications.preferences
  - body: { eventType, channels: { inApp: bool, email: bool, push: bool } }
  - stores in UserBoardNotificationPrefs per user

GET    /api/v1/boards.notifications.preferences
  - response: all user's notification pref settings

POST   /api/v1/boards.notifications.test
  - body: { boardId, eventType }
  - sends test push/email/in-app notification to user
  - useful for verifying subscription + pref settings
```

**Internal service in `server/lib/boards/notifications/push.ts`:**
- `notifyBoardEvent(cardId, action, actor, subscribers)` → check prefs, send via WebPush
- Coalesces same event within 5-min window (e.g., multiple mentions in same comment thread = 1 notification)

### Permissions

- **Send push:** internal service (triggered by card mutations)
- **Manage prefs:** authenticated user (prefs are per-user-only)
- **Test notification:** sender must have board observer access (gated in route handler)

### Dependencies / Blast Radius

- **Internal:** wire `BoardsNotifications.emit()` → `notifyBoardEvent()` in `notifications/deliver.ts` (new file); extend boards event emitters (assign, mention, stage change, approval request)
- **External:** uses existing Rocket.Chat web-push VAPID setup (must already be configured in admin)
- **Performance:** async, fire-and-forget (no blocking on card mutation)
- **Graceful degradation:** if push disabled, notifications still land in in-app bell

### Build Estimate

**M** (Medium, 2–3 days): wire event emission to push service; new preference model + routes; test push mechanism; UI for testing

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_PUSH_NOTIFICATIONS_ENABLED` (default: false). Rollout:
1. Alpha: internal team only; test notification endpoint for debugging
2. Beta: opt-in per user (in notification preferences)
3. GA: enabled by default; users can opt-out per event type

---

## 4. Notification Preferences Matrix

### Problem & User Story

MatterChat notification settings are scattered (in-app vs. email vs. push, per-event-type preferences missing). Legal team members get overwhelmed with alerts or miss critical ones because there's no centralized control.

**User story:** "As a senior associate, I need a single control panel where I can choose which board events (assigned, mentioned, due date, etc.) reach me via push, email, or in-app notification, with presets for 'urgent only' and 'everything.'"

### UX Flow

1. **Access:** User menu → "Notification Preferences" → "Boards" tab
2. **Matrix view:** Table with event types (rows) × delivery channels (columns) with toggles:
   | Event | In-App | Email | Push | Mute All |
   |-------|--------|-------|------|----------|
   | Assigned to me | ✓ | ✓ | ✓ | |
   | Mentioned in comment | ✓ | ✓ | ✓ | |
   | Due soon (48h) | ✓ | ✗ | ✓ | |
   | Approval requested | ✓ | ✓ | ✓ | |
   | Stage changed | ✗ | ✗ | ✗ | |

3. **Presets:** Radio buttons: "All Notifications" / "Urgent Only" (assigned + approved only) / "Digests Only" (email-only, daily) / "Silent" (all off)
4. **Advanced:** Per-board mute option (silence one noisy board without affecting others)
5. **Save & Test:** "Save" button + "Send Test Notification" link

### Data Model

**New collection: `UserBoardNotificationPrefs`**
```typescript
interface IUserBoardNotificationPrefs extends IRocketChatRecord {
  userId: IUser['_id'];
  
  // Event-type × channel matrix
  preferences: Record<
    BoardNotificationAction,
    {
      inApp: boolean;
      email: boolean;
      push: boolean;
    }
  >;
  // BoardNotificationAction = 'assigned' | 'mentioned' | 'due_soon' | 'approval_requested' | 'stage_changed'
  
  // Presets & bulk settings
  preset: 'all' | 'urgent_only' | 'digest_only' | 'silent'; // 'silent' = all false
  
  // Per-board mutes (list of boardIds to ignore all notifications)
  mutedBoards: IBoard['_id'][];
  
  // Digest settings
  digestFrequency?: 'daily' | 'weekly'; // only used if preset = 'digest_only'
  digestTime?: string; // ISO time, e.g. "09:00", default "08:00"
  
  updatedAt: Date;
  createdAt: Date;
}
```

### API Surface

```
GET    /api/v1/boards.user.notification-preferences
  - response: { preferences: IUserBoardNotificationPrefs }

PUT    /api/v1/boards.user.notification-preferences
  - body: { preset?, preferences?, mutedBoards?, digestFrequency?, digestTime? }
  - response: { success, updated: IUserBoardNotificationPrefs }

PUT    /api/v1/boards.user.notification-preferences.board-mute
  - body: { boardId, mute: boolean }
  - response: { success, mutedBoards }

POST   /api/v1/boards.user.notification-preferences.test
  - body: { eventType: BoardNotificationAction, boardId? }
  - sends test notification across all enabled channels
  - response: { success, sent: { inApp: bool, email: bool, push: bool } }

POST   /api/v1/boards.user.notification-preferences.digest
  - internal only; scheduled job to send daily/weekly digest emails
```

### Permissions

- **Read/write own prefs:** authenticated user only (no cross-user access)
- **Admin override:** future — workspace admin can set org-wide defaults (not in initial scope)

### Dependencies / Blast Radius

- **Internal:** new model + service `server/lib/boards/notifications/preferences.ts`; scheduled job for digest emails (Meteor's `Meteor.methods` + SyncedCron)
- **External:** email integration (uses existing Rocket.Chat email module)
- **Performance:** query on every notification event (should be cached per user in memory); ≤ 1s latency acceptable

### Build Estimate

**M** (Medium, 2–3 days): CRUD service + REST routes; UI matrix component with toggle state; preset logic; test notification routing; scheduled digest job

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_NOTIFICATION_PREFS_ENABLED` (default: false). Rollout:
1. Alpha: in-app only, no digest
2. Beta: add email digest
3. GA: fully enabled with push support (tied to #3 rollout)

---

## 5. Docs / Knowledge Base

### Problem & User Story

Legal teams accumulate shared knowledge: standard discovery templates, settlement authority tables, client contact lists, internal firm procedures. MatterChat has no persistent wiki. Confluence is expensive and a separate system. Teams resort to Google Docs (unsearchable from MatterChat) or long channel threads (lost to history).

**User story:** "As a case manager, I need a firm-wide wiki where I can document discovery timelines and authorization limits, link them from boards/matters, search from MatterChat, and control who sees sensitive sections by legal role."

### UX Flow

1. **Create Page:** Workspace → "Docs" tab (new left-rail button) → "+ New Page" → title → rich text editor (same as card description composer) → publish/draft toggle
2. **Structure:** Pages nest (parent/child) → breadcrumb navigation; e.g., Docs > Discovery > State Rules > Texas
3. **Linking:** In card descriptions or comments, type `[[page-title]]` → autocomplete → creates backlink (page shows "linked from 2 cards")
4. **Search:** Search bar in Docs panel + global search includes Docs results ("docs:discovery timeline")
5. **Permissions:** Per-page role-based access (docs-page-role: owner/editor/viewer); default inherit workspace visibility
6. **Matter/Card linking:** From Docs page, "Link Matter" button adds bidirectional link in matter-binding collection (future: matter context panel shows related docs)

### Data Model

**New collection: `WorkspaceDocs`** (stored in Rocket.Chat MongoDB)
```typescript
interface IWorkspaceDoc extends IRocketChatRecord {
  workspaceId: string; // Rocket.Chat workspace (team) _id
  
  // Content
  title: string;
  slug: string; // URL-safe: "discovery-timeline"
  content: string; // rich text (JSON from message composer, or HTML)
  
  // Structure
  parentDocId?: IWorkspaceDoc['_id']; // parent page (for nesting)
  children?: IWorkspaceDoc['_id'][]; // denormalized child list for nav
  order: number; // sibling order
  
  // Metadata
  description?: string; // short summary for list view
  tags?: string[]; // for filtering: "procedures", "discovery", "settlement"
  
  // Access control
  visibility: 'private' | 'team' | 'public'; // public = workspace-wide
  allowedRoles?: LegalRole[]; // if set, only these roles can view (overrides visibility)
  
  // Authorship & tracking
  createdBy: IUser['_id'];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: IUser['_id'];
  
  // Collaboration
  collaborators?: Array<{
    userId: IUser['_id'];
    role: 'owner' | 'editor' | 'viewer';
  }>;
  
  // Linked entities (denormalized for perf)
  linkedMatters?: Array<{ matterId: string; linkedAt: Date }>; // bidirectional
  linkedCards?: Array<{ cardId: string; linkedAt: Date }>;
  
  // Publishing
  published: boolean;
  publishedAt?: Date;
  
  schemaVersion: number;
}

// Backlinks index (separate collection for fast reverse lookup)
interface IDocBacklink extends IRocketChatRecord {
  targetDocId: IWorkspaceDoc['_id']; // page being linked TO
  sourceDocId?: IWorkspaceDoc['_id']; // page linking FROM (or null if card/matter)
  sourceCardId?: IBoardCard['_id']; // card linking TO page
  sourceMatterId?: string; // matter linking TO page
  linkedAt: Date;
}
```

### API Surface

```
POST   /api/v1/docs.create
  - body: { title, content?, parentDocId?, visibility, allowedRoles?, tags? }
  - response: { docId, slug, uri }

GET    /api/v1/docs.get
  - query: { docId or slug }
  - response: { doc, backlinks: [{ sourceCardId, sourceMatterId }] }

PUT    /api/v1/docs.update
  - body: { docId, title?, content?, visibility?, collaborators?, tags? }
  - gated: owner or editor

DELETE /api/v1/docs.delete
  - query: { docId }
  - gated: owner + checks for backlinks (warn if many)

GET    /api/v1/docs.list
  - query: { parentDocId?, search?, tags?, offset, count }
  - response: { docs: IWorkspaceDoc[], total, backlinks: IDocBacklink[] }

GET    /api/v1/docs.search
  - query: { q, offset, count }
  - full-text search via MongoDB text index on title + content
  - response: { results: IWorkspaceDoc[], total, count, offset }

POST   /api/v1/docs.link
  - body: { docId, matterId?: string, cardId?: string }
  - creates entry in IDocBacklink + updates denormalized linkedMatters/linkedCards

DELETE /api/v1/docs.unlink
  - body: { docId, matterId?: string, cardId?: string }
  - removes backlink
```

### Permissions

- **Create:** team member+ (same as channel creation)
- **View:** role-based (default team visibility; allowedRoles restricts further)
- **Edit:** doc owner or editor role
- **Delete:** doc owner + workspace admin
- **Collaborate:** doc owner can add collaborators

### Dependencies / Blast Radius

- **Internal:** new MongoDB collection + service under `server/lib/docs/` + REST routes; client Docs UI panel (`client/views/docs/**`); reuse message composer rich-text + search UI components
- **External:** none
- **Performance:** text index on title + content; backlink queries denormalized (update on every link mutation)
- **Storage:** no media yet (content is text-only; embed media links in content)

### Build Estimate

**L** (Large, 5–6 days): MongoDB schema + CRUD service; rich-text editor UI (can reuse message composer component); tree navigation UI; full-text search; backlink tracking + UI; role-based visibility enforcement; testing

### Rollout / Flag Strategy

**Feature flag:** `WORKSPACE_DOCS_ENABLED` (default: false). Rollout:
1. Alpha: owner-only pages, no roles/sharing
2. Beta: add collaborators + role-based access
3. GA: backlinks + matter/card linking; search integration

---

## 6. Two-Way Calendar Sync

### Problem & User Story

Legal matters have hard deadlines tied to court dates and discovery cutoffs, which live in Outlook/Google Calendar. MatterChat card due dates exist in isolation. When a court date changes, the card due date is stale. Manual updates kill productivity.

**User story:** "As a paralegal, I need my Outlook calendar events to update linked MatterChat card due dates automatically, and vice versa, so deadlines stay in sync without manual overhead."

### UX Flow

1. **Initial Setup:** Card detail panel → "Link to Calendar" button → OAuth prompt (Outlook/Google) → select calendar event → confirm sync direction (two-way or one-way) → card due date = event date
2. **Inbound (event → card):** User's calendar-sync job (runs every 5 min) checks for changes; if event date changed, update card due date + log activity
3. **Outbound (card → event):** When card due date edited, check for linked calendar event → update event → log activity
4. **Bidirectional conflict:** if both changed since last sync, user's change wins (card edit overwrites event if user manually changed card; event change overwrites card if user manually changed event); activity log notes the conflict
5. **Unlink:** Card or calendar event detail → "Unlink from [other side]" → breaks the binding

### Data Model

**Extend existing `IBoardCard`** (via CasePro sync pattern):
```typescript
interface IBoardCard {
  // ... existing fields ...
  
  // Calendar sync (new)
  calendarSync?: {
    provider: 'outlook' | 'google'; // based on user's OAuth token
    eventId: string; // calendar system's event ID
    eventUri?: string; // http link to event
    linkedAt: Date;
    lastSyncAt: Date;
    syncDirection: 'two-way' | 'card_to_event' | 'event_to_card';
    userId: IUser['_id']; // who created the link
    conflict?: {
      lastConflictAt: Date;
      winner: 'card' | 'event'; // which side won
      cardDue?: Date;
      eventDate?: Date;
    };
  };
}
```

**New collection: `UserCalendarTokens`** (OAuth tokens, encrypted at rest, never logged)
```typescript
interface IUserCalendarToken extends IRocketChatRecord {
  userId: IUser['_id'];
  provider: 'outlook' | 'google';
  
  // OAuth refresh token (encrypted in DB, never in logs)
  refreshToken: string; // ENCRYPTED
  accessToken?: string; // ENCRYPTED (cached, expires, can be refreshed)
  expiresAt?: Date;
  
  // Grant metadata
  scope: string; // OAuth scope requested (e.g., "Calendars.ReadWrite")
  grantedAt: Date;
}
```

**New service: `server/lib/boards/calendar-sync/`**
- `linkCardToEvent(cardId, provider, eventId, syncDirection)` → stores binding + triggers initial sync
- `syncCardToEvent(cardId)` → reads card, updates calendar event via OAuth
- `syncEventToCard(userId, eventId)` → reads event from calendar, updates card due date
- Scheduled job (every 5 min): for each user with active calendar sync, run `syncEventToCard` for all linked events

### API Surface

```
GET    /api/v1/calendar.oauth.token
  - query: { provider: 'outlook' | 'google' }
  - no-op if token already exists; return { hasToken: bool }

POST   /api/v1/calendar.oauth.start
  - query: { provider }
  - response: { authUrl } → user follows to OAuth consent screen
  - redirects back to app with `code` param

POST   /api/v1/calendar.oauth.callback
  - body: { code, provider } (or GET query param via redirect)
  - exchanges OAuth code for refresh token → stores IUserCalendarToken
  - response: { success, calendars: [{id, name}] } → list user's calendars

GET    /api/v1/calendar.oauth.revoke
  - query: { provider }
  - deletes IUserCalendarToken + unlinks all cards using this provider
  - response: { success, unlinkedCount }

POST   /api/v1/boards.cards.calendar-link
  - body: { cardId, provider, eventId, syncDirection: 'two-way' | 'card_to_event' | 'event_to_card' }
  - gated: user has OAuth token for provider
  - response: { success, cardId, linkedEvent: { id, title, date } }

DELETE /api/v1/boards.cards.calendar-unlink
  - body: { cardId }
  - removes calendarSync binding
  - response: { success }

GET    /api/v1/boards.cards.calendar-search
  - query: { provider, searchTerm }
  - search user's calendar for event by title (used in link UI)
  - response: { events: [{id, title, start, end, organizer}] }
```

### Permissions

- **Link calendar:** user must have board observer access to card + valid OAuth token for provider
- **Sync job:** internal service (no user-facing gate)
- **Revoke token:** user only (no cross-user token revocation)

### Dependencies / Blast Radius

- **Internal:** new service `server/lib/boards/calendar-sync/` + routes; extend card update flow to trigger `syncCardToEvent`; scheduled job (SyncedCron); new `UserCalendarTokens` collection
- **External:** Outlook Graph API (read/write events) + Google Calendar API (read/write events); requires app registration in Azure AD + Google Cloud Console (ops/infrastructure cost)
- **Performance:** sync job runs in background (non-blocking); OAuth token refresh cached (expires after configurable ttl, e.g., 55 min for 60-min Outlook tokens)
- **Security:** refresh tokens encrypted at rest (via `Meteor.settings.private.encryptionKey`); never logged; tokens revoked on user logout

### Build Estimate

**L** (Large, 5–6 days): OAuth integration (Outlook + Google, 2 days); calendar sync service + bidirectional conflict logic (2 days); scheduled job + error handling (1 day); UI for linking/unlinking + calendar search (1 day); testing

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_CALENDAR_SYNC_ENABLED` (default: false). Rollout:
1. Alpha: Outlook only, one-way sync (event → card)
2. Beta: Google Calendar, add two-way + conflict resolution
3. GA: fully enabled; disable per-provider if OAuth infra down

---

## 7. Guest / External Tier

### Problem & User Story

Legal matters involve outside counsel, clients, and mediators. MatterChat currently has no external user tier: they're either full members (see everything) or have no access. Guest users need to collaborate on specific boards/channels without seeing firm operations, directory, or other matters.

**User story:** "As a managing partner, I need to invite outside counsel to collaborate on a specific litigation board without them seeing our firm directory, other matters, or internal communications."

### UX Flow

1. **Create Guest:** Board detail → "Invite" → "External Guest" → email + select access level (board observer / channel member) → send invite
2. **Guest accepts:** Email link → sign in with password (no SSO) → creates `guest` user with limited profile
3. **Guest view:**
   - Left rail: only boards/channels they're invited to (no directory of all channels)
   - No "Workspace" directory/user list (blocked)
   - Board detail: can view cards, add comments (if channel member), cannot delete/edit cards (observer only)
   - Exports marked as "CONFIDENTIAL - EXTERNAL USER COPY" with watermark
   - No access to firm settings, admin, or knowledge base
4. **Revoke:** Board detail → Members → remove guest → guest loses access immediately
5. **Guest profile:** minimal (name + email only; no team, no internal status)

### Data Model

**Extend existing `IUser` + new `IGuestUser`**
```typescript
interface IUser {
  // ... existing fields ...
  
  // MATTERCHAT: guest-tier indicator
  roles?: string[]; // includes 'guest' for external users
  guestOf?: string; // workspace _id (indicates guest scope)
  guestSettings?: {
    restrictedBoards: IBoard['_id'][]; // list of boards this guest can access
    restrictedChannels: IRoom['_id'][]; // channels
    watermarkExports: boolean; // export watermark toggle
    expiresAt?: Date; // optional guest access expiry
  };
}
```

**New collection: `GuestAccessLog`** (for audit)
```typescript
interface IGuestAccessLog extends IRocketChatRecord {
  guestUserId: IUser['_id'];
  workspaceId: string;
  action: 'login' | 'view_board' | 'view_channel' | 'add_comment' | 'download_export';
  resourceId: string; // boardId or roomId
  timestamp: Date;
}
```

### API Surface

```
POST   /api/v1/guests.invite
  - body: { boardId, email, name, role: 'observer' | 'member', expiresAt? }
  - response: { guestUserId, inviteLink }
  - gated: board admin only

PUT    /api/v1/guests.update
  - body: { guestUserId, role?, expiresAt? }
  - gated: board admin or workspace admin

DELETE /api/v1/guests.revoke
  - body: { guestUserId }
  - removes guest immediately, logs access

GET    /api/v1/guests.list
  - query: { boardId or workspaceId }
  - response: { guests: [{userId, email, name, createdAt, lastSeenAt}] }

GET    /api/v1/guests.access-log
  - query: { guestUserId, offset, count }
  - admin-only; audit log
  - response: { logs: IGuestAccessLog[], total }

POST   /api/v1/guests.accept-invite
  - body: { inviteToken, password }
  - creates guest user, logs in
  - response: { authToken, userId }

POST   /api/v1/boards.export
  - EXTEND: if user is guest, export includes watermark: "CONFIDENTIAL - EXTERNAL USER COPY / Generated for [guest name] / [timestamp]"
```

### Permissions

- **Invite guest:** board admin only
- **Access board/channel:** only if in `guestSettings.restrictedBoards` or `restrictedChannels`
- **Edit/delete:** guests cannot (observer role only; member role allows comments but not edits)
- **View exports:** allowed; includes watermark
- **View workspace directory:** blocked (403)
- **View knowledge base:** depends on doc visibility (public/private/role-based; guests cannot see role-restricted docs)

### Dependencies / Blast Radius

- **Internal:** extend user model + permissions layer (see `server/lib/boards/permissions.ts`); new auth/invite flow; extend export watermarking; audit logging
- **External:** none
- **Performance:** permission checks on every API call (should cache in Redis: "guest:[userId]" → restricted board/channel list, ttl 5 min)
- **Security:** guests cannot use OAuth/SSO (password only); no API token generation for guests; session expires after 8 hours idle

### Build Estimate

**M** (Medium, 3–4 days): user model extension + permission layer integration; invite/accept flow; UI for invite + guest list; watermarking logic; audit logging

### Rollout / Flag Strategy

**Feature flag:** `GUESTS_ENABLED` (default: false). Rollout:
1. Alpha: board-level guests only, observer role
2. Beta: channel member role + expiry dates
3. GA: full access control; optional per-workspace toggle for ops

---

## 8. First-Class Subtasks v2

### Problem & User Story

MatterChat cards have checklists (flatten task lists), but complex cards need hierarchical structure: a motion has sub-motions, a deposition has pre-depo prep + actual dep + post-dep tasks. Checklists can't be commented on, can't have due dates, can't be assigned. Lawyers duplicate card structure awkwardly or ignore subtasks altogether.

**User story:** "As a litigation paralegal, I need cards to have true subtasks with descriptions, due dates, assignees, and comments, organized in 3-level hierarchy, so I can break down complex work without creating 30 separate cards."

### UX Flow

1. **Add subtask:** Card detail → "+" next to Subtasks section → title + optional description → auto-creates as indented card in same board (hidden from main board view unless filtered)
2. **Subtask card:** Looks like regular card but with `parent_card_id` link + indentation UI; can have own due date, assigned, description, comments
3. **Nesting (3 levels max):** Subtask can have its own sub-subtasks; visual hierarchy with indent + connecting lines
4. **Migration from checklists:** Admin → Data → "Migrate Checklists to Subtasks" → preview + execute → each checklist item becomes subtask (preserves title + completed status → completed = closed status)
5. **Bulk edit:** Select multiple subtasks → bulk assign / set due date / delete
6. **Completion flow:** parent card shows completion % based on completed subtasks; parent auto-closes when all subtasks done (configurable)

### Data Model

**Extend existing `IBoardCard`**:
```typescript
interface IBoardCard extends IRocketChatRecord {
  // ... existing fields ...
  
  // Subtasks v2 (new)
  parentCardId?: IBoardCard['_id']; // if set, this is a subtask of another card
  subtaskIds?: IBoardCard['_id'][]; // denormalized list of direct children (performance)
  subtaskMetadata?: {
    count: number; // total subtasks (direct + nested)
    completedCount: number; // completed subtasks
    completionPercent: number; // 0-100
  };
  
  nestLevel: number; // 0 = root card, 1 = subtask of level-0, 2 = subtask of level-1 (max 2)
}
```

**New service: `server/lib/boards/subtasks/`**
- `createSubtask(parentCardId, title, description, listId)` → creates new card with `parentCardId` + `nestLevel = parent.nestLevel + 1`, enforces nesting limit
- `migrateChecklistsToSubtasks(boardId)` → finds all cards with checklists, creates subtasks for each item, preserves `completed` status
- `recalculateSubtaskCompletion(cardId)` → updates `subtaskMetadata` on parent card when a subtask is completed/uncompleted

### API Surface

```
POST   /api/v1/boards.cards.subtask.create
  - body: { parentCardId, title, description?, listId? }
  - response: { cardId, parentCardId, nestLevel }

PUT    /api/v1/boards.cards.subtask.update
  - body: { cardId, title?, description?, dueDate?, assigned? }
  - same as card.update but for subtasks

DELETE /api/v1/boards.cards.subtask.delete
  - body: { cardId }
  - deletes subtask + re-bubbles any sub-subtasks to parent or root

POST   /api/v1/boards.cards.subtask.bulk-update
  - body: { cardIds: [], operations: [{type: 'assign' | 'due_date' | 'status', value}] }
  - applies operation to multiple subtasks
  - response: { updated: number, errors?: string[] }

POST   /api/v1/boards.cards.subtask.migrate-from-checklists
  - body: { boardId }
  - async job; response: { jobId }
  - GET /api/v1/boards.cards.subtask.migrate-from-checklists with query: { jobId } → status + progress

GET    /api/v1/boards.cards.subtasks
  - query: { cardId }
  - response: { subtasks: IBoardCard[], completionPercent }
  - recursively fetches all nested subtasks
```

### Permissions

- **Create subtask:** same as create card (board member+)
- **Edit/delete subtask:** same as edit/delete card + parent card permissions

### Dependencies / Blast Radius

- **Internal:** extend card model + CRUD service; update board views to hide subtasks from main list (or show grouped under parent); update card detail panel to show subtask tree; migration job
- **External:** none
- **Performance:** denormalized `subtaskMetadata` on parent (update on every child change); queries for "parent card + all subtasks" use `parentCardId` index
- **Backward compatibility:** existing checklists remain unchanged until migration is run; subtasks are new (don't break old code)

### Build Estimate

**M** (Medium, 3–4 days): model extension + service logic; card detail UI for subtasks (tree view + quick-add); migration job; bulk edit dialog; testing

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_SUBTASKS_V2_ENABLED` (default: false). Rollout:
1. Alpha: create/view/edit subtasks, no migration
2. Beta: add migration job for checklists
3. GA: fully enabled; checklists deprecated (still readable, not created)

---

## 9. Client SMS Bridge

### Problem & User Story

Legal clients and opposing counsel send status updates, signatures, payments via SMS. These messages scatter across team members' phones and disappear from firm records. Compliance requires logging all client communications. Firms want to route SMS into MatterChat as searchable, archived channels tied to specific matters for unified history.

**User story:** "As a case manager, I need SMS messages from clients and opposing counsel to land as threads in MatterChat channels tied to their matters, so our team stays informed, all communication is archived, and we meet compliance requirements."

### UX Flow

1. **Setup:** Admin → "Integrations" → "SMS Bridge" → set up Twilio account (or similar provider) → provision one phone number per firm → webhook URL auto-configured
2. **Client SMS arrives:** Inbound SMS to firm number → Twilio webhook → routes to matter-bound channel as a new thread
3. **Thread in channel:** SMS from "+1-555-0123 (John Client)" lands as a "system" message + starts thread → team can reply in thread (replies send as SMS back to client)
4. **Matter linking:** SMS channel creation auto-links to `matterId` if phone number already contacts a known client in CasePro
5. **Compliance:** All SMS logged in `SMSLog` collection with timestamps, parties, content hash (HIPAA-friendly storage)
6. **Templates:** Case manager can create SMS templates ("Discovery cutoff reminder") → preview + send to multiple clients from one button

### Data Model

**New collection: `SMSChannel`** (binds phone number to matter)
```typescript
interface ISMSChannel extends IRocketChatRecord {
  // Twilio/provider metadata
  provider: 'twilio' | 'other';
  phoneNumber: string; // firm's provisioned number
  inboundNumber: string; // client's number (linked)
  
  // Matter binding
  matterId?: string; // CasePro matter ID (if known)
  rid: IRoom['_id']; // Rocket.Chat channel this SMS maps to
  
  // Governance
  workspaceId: string; // Rocket.Chat workspace
  createdBy: IUser['_id'];
  createdAt: Date;
  
  // Compliance
  archived: boolean; // soft-delete
  retentionDays: number; // SMS retention policy
}

interface ISMSLog extends IRocketChatRecord {
  // Message metadata
  provider: 'twilio';
  providerId: string; // Twilio MessageSid
  
  direction: 'inbound' | 'outbound'; // perspective of firm
  fromNumber: string;
  toNumber: string;
  
  // Content
  body: string;
  contentHash: string; // SHA256 for audit (can verify without storing plaintext in some contexts)
  
  // Binding
  smsChannelId: ISMSChannel['_id'];
  matterId?: string;
  
  // Track delivery
  status: 'received' | 'sent' | 'failed' | 'queued';
  timestamp: Date;
  deliveredAt?: Date;
}

interface ISMSTemplate extends IRocketChatRecord {
  name: string; // "Discovery Cutoff Reminder"
  body: string; // template text + variables: {{client_name}}, {{deadline}}
  workspaceId: string;
  createdBy: IUser['_id'];
}
```

**Extend CasePro integration:** if client phone number exists in CasePro contacts, auto-link inbound SMS to known matter.

### API Surface

```
POST   /api/v1/sms.channel.create
  - body: { inboundNumber, matterId? }
  - creates ISMSChannel + Rocket.Chat channel
  - response: { channelId, smsChannelId }

POST   /api/v1/sms.send
  - body: { smsChannelId, body } | { phoneNumber, body, matterId? }
  - sends SMS via Twilio
  - response: { messageId, status }

POST   /api/v1/sms.send-from-template
  - body: { templateId, smsChannelIds: [], variables: {} }
  - bulk send to multiple clients from template
  - response: { messageIds: [], failedChannels?: string[] }

GET    /api/v1/sms.logs
  - query: { smsChannelId, offset, count, startDate?, endDate? }
  - compliance audit log
  - response: { logs: ISMSLog[], total }

GET    /api/v1/sms.templates.list
  - response: { templates: ISMSTemplate[] }

POST   /api/v1/sms.templates.create
  - body: { name, body }
  - response: { templateId }

// Webhook (inbound SMS) — internal only
POST   /api/internal/webhooks/sms/inbound
  - body: Twilio JSON payload
  - parses, creates channel if needed, posts to Rocket.Chat room
  - response: 200 OK
```

### Permissions

- **Create SMS channel:** workspace admin + board admin (for the matter's board)
- **Send SMS:** board member+ (same as chat in channel)
- **View logs:** workspace admin (HIPAA-sensitive)
- **Manage templates:** workspace admin

### Dependencies / Blast Radius

- **Internal:** new MongoDB collections + Twilio SDK integration; webhook handler; extend CasePro matter-finder (phone lookup); new admin settings panel for SMS config
- **External:** Twilio account + provisioned phone number (cost ~$1-2/month + per-message fees ~$0.0075); webhook security via HMAC (Twilio signs all requests)
- **Performance:** inbound messages async (fire-and-forget Twilio ACK, then create channel + post); SMS thread creation batched if multiple inbound same number
- **Compliance:** SMS content logged but can be redacted on demand (e.g., if PII disclosed); retention policy configurable (default 7 years for legal matter)

### Build Estimate

**L** (Large, 4–5 days): Twilio integration + webhook (1 day); SMS channel + routing logic (1 day); admin SMS config panel (0.5 day); templates + bulk send (1 day); compliance logging + audit UI (1 day); testing + HIPAA review (0.5 day)

### Rollout / Flag Strategy

**Feature flag:** `SMS_BRIDGE_ENABLED` (default: false). Rollout:
1. Alpha: single matter, manual channel creation, no templates
2. Beta: auto-link from CasePro contacts, add templates
3. GA: full rollout; Twilio failover for SMS delivery; compliance dashboard

---

## 10. Huddles + Auto-Notes

### Problem & User Story

Case teams jump on calls for depositions, settlement calls, court status conferences. Audio is captured on lawyers' phones (unshared, unsearchable, unarchived). No integrated note-taking during calls. After calls, notes go to Google Docs (lost to history) or Slack threads (not tied to the matter). MatterChat can offer 1-click rooms + auto-transcription via CaseNotes integration.

**User story:** "As a litigation associate, I need to start a secure audio call from a board channel or matter with auto-recording and CaseNotes integration so that notes are captured, transcribed, and filed with the matter — all without leaving MatterChat."

### UX Flow

1. **Start Huddle:** Board channel → "Huddle" button (or channel detail → "Start Huddle") → 1-click room creation → RTC link + share
2. **Join:** Other team members click link → browser WebRTC (or Jitsi embed if RC conference unavailable) → audio/screen share working
3. **Recording:** Huddle auto-records (with consent banner); transcript streamed to CaseNotes backend during call
4. **End call:** "End Huddle" → auto-create CaseNotes note linked to this board/channel/matter + transcript + recording link
5. **Revisit:** Channel detail → "Huddle Transcript" link → opens note in CaseNotes or embedded in card detail
6. **One-click UI:** Huddle icon on board detail + channel header; no setup wizard (uses board/channel metadata for context)

### Data Model

**Extend existing Rocket.Chat conference-call mechanism OR embed Jitsi:** MatterChat's fork may already have RC's built-in conference (check `apps/meteor/server/lib/boards/...` for RTC hooks).

**New collection: `BoardHuddle`** (tracks call sessions)
```typescript
interface IBoardHuddle extends IRocketChatRecord {
  // Session metadata
  boardId?: IBoardCard['_id']; // card this huddle is from (optional)
  roomId: IRoom['_id']; // channel huddle was in
  matterId?: string; // CasePro matter, if linked
  
  // Call details
  provider: 'jitsi' | 'rocket.chat'; // which platform
  roomJid?: string; // Jitsi room ID
  
  // Recording & transcript
  recordingUrl?: string; // S3 or similar (optional, privacy-gated)
  transcriptUrl?: string; // points to CaseNotes note or CaseNotes API
  autoTranscriptEnabled: boolean; // was recording streamed to CaseNotes?
  
  // Participants
  participants: Array<{
    userId: IUser['_id'];
    joinedAt: Date;
    leftAt?: Date;
    duration: number; // seconds
  }>;
  
  // Linked to CaseNotes
  caseNotesNoteId?: string; // CaseNotes note ID (foreign key)
  
  // Timing
  startedAt: Date;
  endedAt?: Date;
  duration?: number; // seconds
  
  createdBy: IUser['_id'];
}
```

**API hooks for CaseNotes integration:** Design a simple webhook contract (to be implemented by CaseNotes team in parallel):
```typescript
interface ICaseNotesHuddleHook {
  // MatterChat calls CaseNotes API to:
  // 1. Signal huddle start (for transcript setup)
  POST /internal/api/casenotes/huddles/start
    - body: { boardId?, matterId?, roomId, participants: [userId], huddle_id }
    - response: { noteId, transcript_stream_url } // webhook to stream transcript

  // 2. Signal huddle end (to finalize note + link)
  POST /internal/api/casenotes/huddles/end
    - body: { huddleId, duration, recordingUrl?, summarize?: boolean }
    - response: { noteId, transcriptUrl }

  // 3. Retrieve transcript (for embedding in card detail)
  GET /internal/api/casenotes/huddles/{huddleId}/transcript
    - response: { text, speaker_segments: [{speaker, time_ms, text}], language }
}
```

### API Surface

```
POST   /api/v1/boards.huddles.start
  - body: { boardId?, roomId, matterId?, transcriptionEnabled: boolean }
  - creates IBoardHuddle + calls CaseNotes hook
  - response: { huddleId, roomUrl, transcriptStreamUrl? }

GET    /api/v1/boards.huddles.status
  - query: { huddleId }
  - response: { huddle, participants, duration, status: 'active' | 'ended' }

POST   /api/v1/boards.huddles.end
  - body: { huddleId }
  - calls CaseNotes end hook, finalizes note
  - response: { huddleId, caseNotesNoteId, transcriptUrl }

GET    /api/v1/boards.huddles.transcript
  - query: { huddleId }
  - response: { transcript: string, segments: [...], caseNotesUrl }

POST   /api/v1/boards.huddles.link-casenotes
  - body: { huddleId, caseNotesNoteId }
  - manual linking if auto-link failed
  - response: { success }
```

### Permissions

- **Start huddle:** board member+ (or channel member+ if from channel)
- **Join huddle:** any team member in channel (RTC session-level auth via Jitsi tokens or similar)
- **Link CaseNotes note:** huddle creator or workspace admin

### Dependencies / Blast Radius

- **Internal:** new `BoardHuddle` collection + service under `server/lib/boards/huddles/`; client Huddle start/join UI (button in board/channel header); embed Jitsi iframe or wire RC conference mechanism; CaseNotes webhook consumer (`/internal/api/casenotes/huddles/*`)
- **External:** Jitsi deployment (free SaaS or self-hosted) OR Rocket.Chat's built-in RTC (if available in 8.6 fork); CaseNotes API for transcript/note creation (needs separate CaseNotes PR)
- **Performance:** Jitsi is standalone (no MatterChat latency impact); transcript streaming async (doesn't block huddle)
- **Security:** Jitsi rooms password-protected (auto-generated); RTC traffic over DTLS-SRTP; recording stored encrypted if enabled

### Build Estimate

**L** (Large, 4–5 days): Jitsi embed + MatterChat Huddle service (2 days); CaseNotes webhook contract + integration (1 day); client UI button + transcript embed (1 day); testing + docs (1 day)

**Note:** CaseNotes implementation (transcript generation + note creation) is a PARALLEL effort. This spec defines the MatterChat seam; CaseNotes team builds the transcript backend.

### Rollout / Flag Strategy

**Feature flag:** `BOARDS_HUDDLES_ENABLED` (default: false). Rollout:
1. Alpha: Jitsi room creation only, no recording/transcript
2. Beta: recording enabled (local storage, no transcription yet)
3. GA: full CaseNotes integration + auto-transcript

---

## 11. AI Knowledge Agents

### Problem & User Story

Legal teams have distributed knowledge: past motions, settlement frameworks, discovery protocols, client profiles, discovery timelines. This knowledge lives in LitBox folders, Google Docs, CasePro, MatterChat docs. Associates dig through archives or re-ask partners questions. AI-assisted search could accelerate research, but MatterChat cannot build its own LLM/RAG stack. The OmnisAI AI-Agents platform (CHI) already supports custom agents with pluggable knowledge sources and LLM providers. MatterChat should wire this as first-class bot users in channels.

**User story:** "As a junior associate, I need to @mention a 'Discovery Expert' bot trained on our firm's past discovery orders and CasePro data, so I can ask 'what's our standard response timeline in Texas?' and get an immediate, searchable answer without interrupting a partner."

### UX Flow

1. **Create Agent:** Workspace admin → "Integrations" → "AI Agents" → "+ New Agent" → form:
   - Name: "Discovery Expert"
   - Avatar: upload or icon picker
   - Purpose: "Answers discovery timeline, protocol, and objection questions based on firm knowledge"
   - Knowledge sources (multi-select): LitBox folders, Docs/KB pages (#5), CasePro matters (via MCP), board data (via MCP)
   - LLM provider: "Use workspace default" or "BYO" (OpenAI key, Claude token, local Ollama URL)
   - Visibility: firm-wide (or private admin-only for testing)
2. **Use in channel:** Type `@Discovery Expert what is our standard discovery objection response?` → agent responds in-thread with answer + source citations
3. **DM the agent:** Click agent name in member list → DM window → ask questions; responds same as channel mention
4. **Slash command:** `/ask discovery-expert what is the 30b6 limit?` → generalized, multi-agent aware
5. **Agent audit:** Workspace admin → "Agents" → see Q&A activity log (metadata only: who asked, when, agent ID, no question/answer content for privacy)

### Data Model

**New collection: `IKnowledgeAgent`** (workspace-scoped agent registry)
```typescript
interface IKnowledgeAgent extends IRocketChatRecord {
  workspaceId: string; // Rocket.Chat workspace (team) _id
  
  // Identity
  name: string; // "Discovery Expert"
  slug: string; // URL-safe: "discovery-expert"
  description?: string;
  avatar?: string; // URL or data:image URI
  purpose?: string; // long-form purpose for visibility
  
  // AI-Agents platform binding
  chiAgentId: string; // The agent's ID on the AI-Agents platform (created during provisioning)
  chiAgentStatus: 'provisioning' | 'active' | 'failed' | 'archived';
  chiProvisionedAt?: Date;
  
  // Knowledge sources (references, not copies)
  knowledgeSources: Array<{
    type: 'litbox_folder' | 'docs_page' | 'casepro_mcp' | 'boards_mcp'; // knowledge source type
    sourceId: string; // folder ID, doc ID, or MCP endpoint alias
    sourceName: string; // human-readable name
    addedAt: Date;
    status: 'synced' | 'syncing' | 'error'; // AI-Agents backend status
  }>;
  
  // LLM provider config
  llmProvider?: {
    type: 'workspace_default' | 'openai' | 'claude' | 'ollama' | 'other';
    // Do NOT store secrets here — use workspace settings or secure vault
    endpoint?: string; // for self-hosted (Ollama)
    configuredAt: Date;
  };
  
  // Permissions & access
  visibility: 'firm' | 'team' | 'private'; // firm = all members, team = team only, private = admins only
  allowedRoles?: LegalRole[]; // if set, role-gated access (e.g., only attorneys can ask)
  
  // Bot user (Rocket.Chat integration)
  botUserId?: IUser['_id']; // Rocket.Chat user created for this agent (to handle @mentions + DMs)
  
  // Audit
  createdBy: IUser['_id'];
  createdAt: Date;
  updatedAt: Date;
  
  schemaVersion: number;
}

// Agent invocation log (metadata only; never logs question/answer content)
interface IKnowledgeAgentAuditLog extends IRocketChatRecord {
  agentId: IKnowledgeAgent['_id'];
  userId: IUser['_id'];
  roomId: IRoom['_id']; // channel or DM
  invocationMethod: 'mention' | 'dm' | 'slash_command';
  invokedAt: Date;
  responseTime: number; // milliseconds
  success: boolean;
  error?: string; // brief error class, not the full trace
}
```

### API Surface

```
POST   /api/v1/agents.create
  - body: { name, description?, purpose?, avatar?, knowledgeSources: [{type, sourceId}], llmProvider?, visibility, allowedRoles? }
  - calls AI-Agents platform to provision agent + create CHI_AGENT_ID
  - response: { agentId, chiAgentId, botUserId, status: 'provisioning' | 'active' }

GET    /api/v1/agents.list
  - query: { visibility?, offset, count }
  - response: { agents: IKnowledgeAgent[], total }

GET    /api/v1/agents.info
  - query: { agentId or slug }
  - response: { agent, sourcesSynced: number, sourcesFailed: number, lastSyncAt? }

PUT    /api/v1/agents.update
  - body: { agentId, name?, description?, avatar?, knowledgeSources?, llmProvider? }
  - re-provisions on AI-Agents platform if sources changed
  - response: { agentId, status }

DELETE /api/v1/agents.delete
  - body: { agentId }
  - archives agent (soft-delete) + marks bot user as inactive
  - response: { success }

POST   /api/v1/agents.invoke
  - INTERNAL: called by @mention / /ask handler
  - body: { agentId, message, userId, roomId, context?: { matterContext?, boardContext? } }
  - performs permission check (userId's role vs. allowedRoles)
  - calls AI-Agents platform `/api/v1/chat/agents/{chiAgentId}/chat` with context
  - response: { answer: string, sources?: [{ type, name, url }] }

GET    /api/v1/agents.audit-log
  - query: { agentId, offset, count, startDate?, endDate? }
  - admin-only; metadata log (no question/answer content)
  - response: { logs: IKnowledgeAgentAuditLog[], total }

POST   /api/v1/agents.sync-sources
  - body: { agentId, sources: [{type, sourceId}] }
  - async job to re-sync knowledge sources with AI-Agents platform
  - response: { jobId, status: 'queued' }

GET    /api/v1/agents.sync-status
  - query: { jobId }
  - response: { status: 'pending' | 'completed' | 'failed', progress: number, errors?: string[] }

# Webhook — AI-Agents platform → MatterChat (bidirectional sync)
POST   /api/internal/webhooks/agents/sync-notify
  - body: { agentId, sourceId, status: 'synced' | 'error', message? }
  - notifies MatterChat when knowledge source sync completes
  - updates IKnowledgeAgent.knowledgeSources[*].status
```

**Internal MatterChat services:**
- `server/lib/agents/service.ts` — CRUD + permission checks + audit logging
- `server/lib/agents/provisioner.ts` — calls AI-Agents platform APIs to create/update agents
- `server/lib/agents/context-builder.ts` — constructs knowledge context from matter/board/doc queries (for MatterChat-to-AI-Agents payload)
- `app/slashcommands-omnis/agents.ts` — generalized `/ask <agent> <question>` handler (extends existing /chi pattern)
- `server/lib/agents/permissions.ts` — role-gated access checks (permission lookup: if user's legal role not in allowedRoles, return 403)

### Permissions

- **Create agent:** workspace admin only
- **Use agent:** depends on agent's `visibility` + `allowedRoles` (firm = all; team = team members; private = admin only; if allowedRoles set, user's legal role must be in list)
- **View audit log:** workspace admin only (never expose to end users — privacy-first)
- **Update/delete agent:** agent creator + workspace admin

### Dependencies / Blast Radius

- **Internal:** new `IKnowledgeAgent` collection + CRUD service; extend @mention handler (bot user detection) + /ask slash command (already in place for /chi); wire bot user → agent invocation
- **External:** AI-Agents platform (`CHI_API_URL` + `CHI_API_KEY`, already in env); platform must expose agents CRUD API (need API-Agents team to verify: POST `/agents`, PUT `/agents/{id}`, POST `/agents/{id}/knowledge-sources`)
- **Knowledge source connectors:** need MCP stubs for CasePro + Boards (casepro-mcp-v2, matterchat-mcp-v2) so AI-Agents platform can query matter/card data; LitBox folder listing already available via LitBox REST
- **Performance:** agent invocation async (fire-and-forget audit log, inline response); permission checks cached per user (ttl 5 min)
- **Security:** LLM provider secrets stored in workspace settings (encrypted at rest, never in logs); question/answer never logged; MatterChat user's legal role verified before query reaches AI-Agents platform (role-gated retrieval at MatterChat boundary)

### Build Estimate

**M** (Medium, 3–4 days): IKnowledgeAgent model + CRUD routes (1 day); provisioner calling AI-Agents APIs (0.5 day); bot user integration + @mention + /ask handlers (1 day); permission checking + audit logging (0.5 day); context builder for MCP queries (0.5 day); testing + docs (0.5 day)

**Note:** Depends on AI-Agents platform exposing agent provisioning APIs; if not yet available, coordinate with AI-Agents team for API contract.

### Rollout / Flag Strategy

**Feature flag:** `KNOWLEDGE_AGENTS_ENABLED` (default: false). Rollout:
1. Alpha: admins only can create/test agents; no role-gating yet
2. Beta: add role-based access; enable /ask for all users
3. GA: full visibility + allowedRoles + audit logging; toggle knowledge sources per-agent

---

## RECOMMENDED BUILD ORDER

### Quick Wins (1–2 weeks, high impact, low risk)
1. **Board Templates** (M) — reusable structure capture; zero-dependency; immediate velocity win for ops teams
2. **Notification Preferences Matrix** (M) — addresses user overwhelm; leverages existing notification infra; low risk
3. **Board Export/Import** (M) — compliance/data portability; no integrations; ship early, iterate on format

### Differentiators (3–4 weeks, medium complexity, high visibility)
4. **Docs / Knowledge Base** (L) — addresses "Confluence gap"; unique to MatterChat; strong product story; start early (longest build)
5. **First-Class Subtasks v2** (M) — hierarchical task management; solves real workflow pain; lower technical risk than calendar/SMS
11. **AI Knowledge Agents** (M) — plug-and-play firm knowledge bot; wires CHI platform; high adoption velocity; requires AI-Agents API coordination

### Integrations (2–3 weeks each, unlocks workflows)
6. **Board Push Notifications** (M) — wires templates/prefs; dependency on #3/4; medium risk (VAPID config)
7. **Two-Way Calendar Sync** (L) — Outlook/Google sync; highest integration complexity; high value to litigation teams; requires OAuth setup
8. **Guest / External Tier** (M) — cross-firm collaboration enabler (ties to Omnis Counsel vision); medium risk (permission layer)

### Specialized Use Cases (2–4 weeks, vertical focus)
9. **Client SMS Bridge** (L) — Twilio integration; vertical differentiator for PI + compliance-heavy practices; operational cost (SMS fees)
10. **Huddles + Auto-Notes** (L) — async call capture; deep CaseNotes integration; parallel CaseNotes work; highest coordination cost

### Build Sequence (overlapping)

**Phase 1 (Weeks 1–2):** #1 (Templates) + #2 (Notification Prefs) + #3 (Export/Import)  
**Phase 2 (Weeks 3–4):** #4 (Docs) in parallel; #5 (Subtasks v2) + #11 (AI Agents); #6 (Push Notifications)  
**Phase 3 (Weeks 5–6):** #7 (Calendar Sync); #4 continues  
**Phase 4 (Weeks 7–8):** #8 (Guests); #9 (SMS) + #10 (Huddles) in parallel  

**Rationale:**
- Templates first: establishes firm workflows, feeds into all later UX (templates + export/import ensure portability)
- Notification prefs paired: notification explosion risk if not solved early
- Docs as longest pole: start early, ship incrementally (phases: create/view → search/backlinks → matter linking)
- AI Agents (phase 2): wires firm knowledge into chat immediately; pairs well with Docs (knowledge source); CHI integration straightforward (proven pattern)
- Calendar sync before SMS: calendar is higher-volume workflow; SMS is specialized vertical
- Guests + SMS/Huddles last: dependencies on prior work (knowledge base, subtasks) stabilize first
- Overlap: while #4 (Docs) is building (backend-heavy), ship #5–6–11 (Subtasks + Push + AI Agents) to users

---

## Dependencies Summary

| Feature | Depends On | Blocks |
|---------|-----------|--------|
| Templates | (none) | Export/Import |
| Export/Import | Templates (for format std) | Docs export |
| Push Notifications | Notification Prefs | (none) |
| Notification Prefs | (none) | Push Notifications |
| Docs/KB | (none) | Matter linking (Phase 2), AI Agents knowledge source |
| Calendar Sync | (none) | (none) |
| Guests | Notification Prefs (privacy) | Cross-firm Docs |
| Subtasks v2 | (none) | Calendar sync (subtask due dates) |
| SMS Bridge | CasePro contact sync | (none) |
| Huddles | (none) | CaseNotes integration (CaseNotes PR) |
| AI Knowledge Agents | AI-Agents platform APIs + CHI env | (none) |

---

## Scope & Out of Scope

### In Scope (Wave 3)
- Board templates (save/load/gallery)
- JSON + CSV export; Trello JSON import
- Web push notifications (reuse RC infra)
- Notification preferences matrix UI
- Workspace wiki (pages, nesting, backlinks)
- Two-way Outlook/Google calendar sync
- Guest user tier (board-level access control)
- Subtasks with 3-level nesting
- SMS inbound routing via Twilio
- Jitsi-based huddles + CaseNotes hook design

### Out of Scope (Phase 4+)
- Advanced analytics / reporting
- Custom workflow automations (triggers beyond card events)
- AI-assisted categorization / auto-field-filling
- Video recording storage + hosting (linked to external provider)
- CaseNotes transcription (CaseNotes team)
- Slack/Teams export (MatterChat data egress)
- White-label deployment

---

_Spec version 1.0 — Wave 3 Roadmap — MatterChat Q3 2026_
