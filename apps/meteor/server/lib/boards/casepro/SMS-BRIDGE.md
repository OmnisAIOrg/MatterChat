# SMS Bridge — CasePro SMS Thread Sync

## Overview

The SMS Bridge is a bidirectional sync layer that mirrors **CasePro SMS threads** into **MatterChat channels**. Matter channels become a unified interface for team communication, incorporating client SMS conversations alongside internal team chats.

**CasePro is the system of record.** SMS messages are pulled from CasePro's `sms_threads` and `sms_messages` entities, synced into Matter channels on a 30-second interval (configurable), and MatterChat user replies are ingested back through CasePro's SMS gateway for delivery.

## Architecture

### Core Components

1. **SMS Bridge** (`sms-bridge.ts`)
   - `SMSBridge` class: high-level API for SMS operations
   - `getSMSBridge()`: singleton accessor
   - Wraps the CasePro transport layer (transport.ts)
   - Provides verbs: `pullMessages`, `ingestMessage`, `getThread`, `getThreadMessages`, `listThreadsForMatter`
   - **Graceful degradation:** returns empty results if SMS entities unavailable or CasePro disabled

2. **Sync Job** (`sms-sync.ts`)
   - `syncSMSRoomMessages(roomId)`: sync SMS messages for a specific room
   - `syncAllSMSMessages()`: scan all SMS-enabled rooms and sync new messages
   - `ingestSMSMessage(roomId, messageId, body, userId)`: queue a MatterChat message → CasePro SMS
   - **Deduplication:** via `caseProMessageId` stored on room messages; duplicate messages are skipped
   - **Error resilience:** failures logged but don't block other operations

3. **Scheduler** (`sms-scheduler.ts`)
   - `startSMSSyncScheduler()`: begin periodic sync job (default: 30s interval)
   - `stopSMSSyncScheduler()`: stop the job (for testing, graceful shutdown)
   - `initSMSSyncScheduler()`: register with Meteor startup hook
   - Configurable via `SMS_SYNC_INTERVAL_MS` env var

4. **API Endpoints** (`/app/api/server/v1/sms.ts`)
   - `GET /api/v1/sms/threads?matterId=...` — list SMS threads for a matter
   - `GET /api/v1/sms/threads/:threadId` — get thread details
   - `GET /api/v1/sms/threads/:threadId/messages` — conversation history
   - `POST /api/v1/sms/rooms/:roomId/sync` — manual sync trigger
   - `POST /api/v1/sms/rooms/:roomId/messages/ingest` — ingest MatterChat message
   - `GET /api/v1/sms/status` — admin diagnostics

### Data Models

**ISMSChannel** (stored on Matter room document under `room.sms`)
```typescript
{
  enabled: boolean;                    // SMS sync active
  caseProThreadId: string;             // SMS thread ID
  caseProMatterId: string;             // Matter ID for filtering
  caseProPartyId?: string;             // Client/contact party ID
  lastSyncAt?: string;                 // Last sync timestamp
  syncCursor?: string;                 // Incremental sync cursor
  status?: string;                     // Thread status (active, closed, archived)
  subject?: string;                    // Thread subject from CasePro
}
```

**ISMSMessage** (stored on room message under `message.sms`)
```typescript
{
  caseProMessageId: string;            // For deduplication
  caseProSender?: string;              // Phone, party ID, or "system"
  externalMessageId?: string;          // SMS provider's reference
  caseProStatus?: string;              // pending, delivered, failed, read, etc.
  caseProSentAt?: string;              // Timestamp from CasePro
}
```

### UI Components

1. **SMSChannelBrowser** (`client/views/rooms/sms/SMSChannelBrowser.tsx`)
   - Displays SMS threads as available channels to join for a matter
   - Search and filter threads
   - Click to select and create a Matter channel
   - Premium design tokens: radius 14px cards, Geist Mono labels, status colors

2. **SMSMessageIndicator** (`client/views/rooms/sms/SMSMessageIndicator.tsx`)
   - Badge shown on room messages synced from SMS
   - Displays status (pending, delivered, failed, read)
   - Shows sender phone number or party ID
   - Status color coding: green (delivered), amber (pending), red (failed)

## Message Flow

### CasePro → MatterChat (Pull)

1. Sync job runs every 30 seconds
2. For each SMS-enabled room:
   - Query `sms_threads` for the matter
   - Query `sms_messages` for each thread
   - Filter by `syncCursor` for incremental sync
3. For each new message:
   - Check for duplicate via `caseProMessageId` (idempotent)
   - Create a room message with metadata
   - Store `sms.caseProMessageId` for dedup
   - Mark sender as SMS system
4. Update room's `syncCursor` for next pull

### MatterChat → CasePro (Ingest)

1. User posts a message in an SMS-enabled channel
2. Room message handler calls `ingestSMSMessage()`
3. Bridge calls `transport.ingest('/sms-messages/ingest', payload)`
4. CasePro receives the message and queues it for SMS delivery
5. Return immediately (fire-and-forget; CasePro handles delivery)
6. Status updates come in next pull (sync is eventually consistent)

## Stub Guard & Degradation

**When CasePro is not configured or disabled:**

- Transport resolves to `StubTransport` (mock in-memory store)
- Stub provides representative demo data (seeded matters, parties, etc.)
- SMS bridge returns empty results for pull/ingest
- Sync job no-ops silently
- UI components show empty state: "No SMS threads"
- **Feature is gracefully hidden** — no errors, no noise

**When an SMS entity is not available:**

- Transport query returns `{ data: [], total: 0 }`
- Bridge returns empty results
- Sync continues to next room
- Logged as debug/warn (not error)

## Configuration

### Environment Variables

- `SMS_SYNC_INTERVAL_MS` (default: 30000)
  - Milliseconds between sync runs
  - Set to `0` to disable automatic sync (manual via API only)

### Settings

- CasePro endpoint configuration (global, shared with boards/matters)
- SMS bridge enabled implicitly when CasePro is configured

### Permissions

- Room membership required for sync/ingest endpoints
- Admin-only for status diagnostics (`GET /api/v1/sms/status`)

## Testing

### Unit Tests (`tests/unit/server/lib/boards/casepro/sms-bridge.spec.ts`)

- 20+ test cases covering pull, ingest, get, list operations
- Uses `StubTransport` for deterministic, fast tests
- Tests graceful degradation and entity unavailability
- No network, no live CasePro required

**Run tests:**
```bash
npm run test -- sms-bridge.spec.ts
```

### Integration Testing

Manual testing via Postman/curl:

```bash
# List SMS threads for a matter
curl -H "X-Auth-Token: $TOKEN" \
  http://localhost:3000/api/v1/sms/threads?matterId=matter-1

# Get a specific thread
curl -H "X-Auth-Token: $TOKEN" \
  http://localhost:3000/api/v1/sms/threads/sms-thread-1

# Ingest a message
curl -X POST -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageId":"msg-1", "messageBody":"Test SMS"}' \
  http://localhost:3000/api/v1/sms/rooms/room-1/messages/ingest

# Check status
curl -H "X-Auth-Token: $TOKEN" \
  http://localhost:3000/api/v1/sms/status
```

## Known Limitations & Future Work

### Current Implementation (Buildable Now)

- ✅ Pull SMS threads from CasePro
- ✅ Sync new SMS messages into Matter channels
- ✅ Ingest MatterChat messages → CasePro SMS
- ✅ Incremental sync with cursor
- ✅ Deduplication via message ID
- ✅ Graceful degradation without CasePro
- ✅ API endpoints + UI components
- ✅ Scheduler + background job
- ✅ Unit tests

### Stubbed / Future Phases

- ⏳ **Attachment Sync** — SMS photos/files (requires CasePro file entity)
- ⏳ **Delivery Receipt Tracking** — SMS provider webhooks for status updates
- ⏳ **Bulk SMS Templates** — scheduled/bulk message composition
- ⏳ **Compliance & Audit** — message archival, retention policies (per HIPAA)
- ⏳ **SMS Provider Abstraction** — currently assumes Twilio/Bandwidth via CasePro; future: direct provider integration

## Migration & Rollout

1. **Phase 1 (Current):** SMS bridge as optional feature
   - Activated per-room via `room.sms.enabled = true`
   - No auto-provisioning; manual channel creation + enable
2. **Phase 2:** Automatic SMS channel discovery
   - When a matter is opened in MatterChat, SMS threads auto-discovered
   - Offers to auto-create SMS channels for active threads
3. **Phase 3:** Bi-modal UI (Messages + SMS tabs)
   - Matters show SMS threads alongside chat channels
   - Unified inbox view

## Support & Debugging

### Check SMS Bridge Status
```bash
curl -H "X-Auth-Token: $ADMIN_TOKEN" \
  http://localhost:3000/api/v1/sms/status
```

### View Sync Logs
```bash
# Check Meteor logs for SMSBridge debug output
tail -f .meteor/local/log
# or in code: SystemLogger.debug('SMSSync: ...', { details })
```

### Trigger Manual Sync
```bash
POST /api/v1/sms/rooms/:roomId/sync
```

### Entity Schema Diagnostics
The SMS entities are queried via the CasePro transport. If sync produces no messages:
1. Check `GET /api/v1/sms/status` — is the bridge available?
2. Verify `room.sms.caseProMatterId` is set and refers to an actual matter
3. Check CasePro for SMS threads on that matter (admin dashboard)
4. Inspect transport logs for query errors (SystemLogger.warn)

## See Also

- `apps/meteor/server/lib/boards/casepro/transport.ts` — CasePro wire layer (entity verbs, stub/native/MCP transports)
- `packages/core-typings/src/ISMSChannel.ts` — type definitions
- `docs/design/premium-refresh/README.md` — design tokens and UI patterns
