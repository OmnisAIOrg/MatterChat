# Boards Push Notifications (Web Push / VAPID)

**Status:** Wave 3 implementation, feature-complete · **Gated by:** `Boards_Notifications_WebPush_Enabled` (default: enabled)

## Overview

Board push notifications deliver time-sensitive board events directly to users' browsers and PWA instances using the **Web Push Protocol (Push API + VAPID signing)**. Complements the in-app bell/inbox by reaching users even when they don't have the app open.

Notifications cover five core event categories:
- **Card assignments** — "You're assigned to [card]"
- **Deadlines** — "Due soon: [card]" and "Overdue: [card]"
- **Mentions** — "Mentioned in [card]"
- **Approvals** — "Approval needed for [card]", status updates
- **Stage changes** — Matter/card status transitions

## Architecture

### Delivery Pipeline
1. **Event emission** → Board lifecycle events (`card.commented`, `member.added`, `matter.stageChanged`, etc.) are emitted from service functions.
2. **Notification delivery** → The `boards/notifications/deliver.ts` module writes to TWO targets in parallel:
   - **In-app bell** (`boards_notifications` collection) — primary, always-on
   - **Web push** (`sendWebPushToUser`) — fire-and-forget, best-effort (errors swallowed)
3. **Browser handling** → User's service worker receives VAPID-signed push, displays native notification.

### Key Design Decisions
- **Fire-and-forget + graceful degrade** — Failed web-push sends never block the underlying mutation (card move, comment, etc.). Errors logged at debug level.
- **Coalesce per card** — Multiple notifications for the same card use a `tag` to coalesce in the browser (only latest shows).
- **Parallel dispatch** — Web push sends are fire-and-forget `Promise.all()` while in-app delivery happens sequentially (in-app is critical path).
- **No streamer dependency** — Hooks are explicit, avoiding broad Rocket.Chat core events that would increase blast radius.

## Configuration

### Server-side Requirements
1. **VAPID keypair generation** (one-time, per environment):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Output:
   ```
   Public Key: BPxxxxx...
   Private Key: xxxxx...
   ```

2. **Set environment variables** (or Admin Settings):
   ```env
   WEB_PUSH_VAPID_PUBLIC=<public-key-base64url>
   WEB_PUSH_VAPID_PRIVATE=<private-key-base64url>
   WEB_PUSH_SUBJECT=mailto:ops@yourdomain.io
   ```

3. **Enable in Admin → Settings → Boards Reporting & AI**:
   - ✅ `Boards_Notifications_WebPush_Enabled` (default: enabled)
   - ✅ `Boards_Notifications_InApp_Enabled` (default: enabled — must be ON for web push to send)

### Client-side (Browser)
- Handled automatically when a user visits the app in a **modern browser with service-worker support** (all recent Firefox, Chrome, Safari, Edge).
- The app prompts for push permission on first visit; users can grant/deny per browser.
- Notifications route users back to the card: `link` field deep-links to `/boards/b/{boardId}/board/{cardId}`.

## Event Mappings

| Event | Trigger | Notification |
|---|---|---|
| `member.added` | User is assigned to a card | "You're assigned to [card]" |
| `card.dueSoon` | Card's due date approaches (cron-synthesized) | "Due soon: [card]" (with days-to-due if <7d) |
| `card.overdue` | Card's due date has passed | "Overdue: [card]" (high priority) |
| `card.commented` (mention) | User is mentioned in a comment | "Mentioned in [card]" |
| `approval_requested` | Automation/card requests approvers | "Approval needed for [card]" |
| `approval_approved` | Approver approves the card | "Approved: [card]" |
| `approval_rejected` | Approver requests changes | "Changes requested on [card]" |
| `matter.stageChanged` | Matter moves to new stage | "Stage changed: [card]" |
| `card.subStatusChanged` | Card status updates | "Status changed: [card]" |
| `card.moved` | Card moves to different list | "Moved: [card]" |
| `due.set` | Due date is set/changed | "Due date set: [card]" |

## Recipient Resolution

Web push uses the **same recipient set** as in-app notifications:
- **Card events** → card's assignees + watchers + subscribers (excluding the actor)
- **Automation NOTIFY actions** → action target (owner / assignees / watchers / named user)
- **Approval events** → approvers notified on request; assignees + creator notified on decision
- **Mention events** → mentioned user(s) only

Duplicate detection via subscriptions is built-in (the `boards/notifications/subscriptions` module).

## Message Format

Notifications are compact and action-oriented:

### Title
- Event-specific human-readable summary: `"You're assigned to 'Lease Review'"`
- Fallback to event kind + card title if context unavailable

### Body (optional)
- Additional context when needed: `"Due in 3 days"`
- Empty for simple notifications (mention, approval request)

### Deep Link
- Standard: `/boards/b/{boardId}/board/{cardId}` — user clicks → opens card detail

## Feature Flags

Two separate toggles allow independent control:

| Setting | Description | Default |
|---------|-------------|---------|
| `Boards_Notifications_InApp_Enabled` | Inbox/bell delivery (critical path) | ✅ |
| `Boards_Notifications_WebPush_Enabled` | Browser push (fire-and-forget) | ✅ |

When web-push is disabled, delivery still works to in-app (the setting is only checked before sending web-push).

## Coalescing & Deduplication

Each notification includes a `tag` based on the subject:
- **Card events:** `tag: 'boards-card-{cardId}'` — multiple events on the same card show only the latest
- **Board events:** `tag: 'boards-board-{boardId}'` — multiple board events coalesce

Browsers respect this tag (native Push API behavior): if two notifications arrive with the same tag, the second replaces the first in the notification tray.

## Error Handling & Monitoring

### Graceful Degrade
- **Missing VAPID keys** → Warning logged once at boot, web-push silently no-ops (in-app still works)
- **Failed push send** → Logged at debug level; does not affect card/comment/automation mutation
- **Invalid subscription** → Automatically pruned (404/410 responses → subscription deleted)

### Observability
- **Boot warnings** — `[web-push] web-push package not installed` or `VAPID keys not set`
- **Debug logs** — `boards.notifications.webpush.sendFailed` (per-user failures)
- **Run logs** — Automation NOTIFY actions report delivery success/suppression counts

## Limits & Constraints

- **Max recipients per event:** No hard limit (best effort, parallelized)
- **Notification TTL:** Browser-managed (typically 24–72 hours pending user action)
- **Rate limiting:** None (rely on event emission rate; cron jobs coalesce multiple due-soon checks per card)
- **Payload size:** ≤4KB per W3C spec (titles/bodies are short, stay well under)

## Testing

### Local Development (stub mode)
If VAPID keys are not set:
1. App boots with warning: `[web-push] VAPID keys not set — browser push disabled`
2. In-app notifications still work (no-op web-push, gracefully ignored)
3. Verify by watching server logs while triggering events (assignments, comments, etc.)

### Staging/Production
1. Set `WEB_PUSH_VAPID_PUBLIC`/`PRIVATE`/`SUBJECT` environment variables or Admin Settings
2. App boots cleanly (no warnings)
3. Visit app in browser → Accept push notification permission
4. Trigger a board event (assign yourself, comment, etc.)
5. Browser should show a native push notification
6. Click it → Opens the card at deep-link

### Manual Testing
```bash
# Simulate a push notification (requires subscription data)
curl -X POST https://instance.stg-omnisai.io/api/v1/boards.notifications.list \
  -H "X-User-ID: <userId>" \
  -H "X-Auth-Token: <token>"
# Verify unread count increases
```

## Future Enhancements

- **Notification preferences** — Per-user opt-in by event type (mentions vs. all assignments)
- **Batching cron** — Coalesce multiple events into a single daily digest push (vs. real-time)
- **Interactive actions** — Buttons on notifications ("Approve", "Acknowledge", etc.) that bypass deep-link
- **Rich media** — Add icon/image (card cover, user avatar) to notifications (requires icon upload)

## References

- **W3C Push API spec:** https://www.w3.org/TR/push-api/
- **VAPID signing (RFC 8292):** https://tools.ietf.org/html/rfc8292
- **web-push npm library:** https://github.com/web-push-libs/web-push
- **Related:** `boards/notifications/deliver.ts`, `app/web-push/server/send.ts`, `boards/notifications/eventNotifications.ts`
