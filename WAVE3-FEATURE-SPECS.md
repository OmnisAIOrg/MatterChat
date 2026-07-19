# WAVE3 Feature Specifications

## SPEC #2: Board Export/Import

### Overview
Enable users to export boards in multiple formats (CSV, JSON) and import boards from Trello JSON exports. This feature supports data portability, backup, and migration scenarios.

### Feature: Board Export

#### Export Formats

1. **CSV Export**
   - One CSV per list within the board
   - Filename: `{boardTitle}-{listName}.csv`
   - Columns: ID, Title, Description, Status, Assignee(s), Labels, Due Date, Time Estimate, Time Spent, Created By, Created Date, Updated Date
   - Flattened format: one row per card
   - Multi-valued fields (assignees, labels) comma-separated

2. **JSON Export**
   - Complete board structure including:
     - Board metadata (id, title, description, type)
     - All lists with order
     - All cards with full data (id, title, description, list, parent, position, dates, assignees, labels, time tracking)
     - Comments (text, author, date)
     - Activity log (action type, actor, timestamp, details)
   - Filename: `{boardTitle}.json`
   - Single JSON file, structured as:
     ```json
     {
       "board": {...},
       "lists": [...],
       "cards": [...],
       "comments": [...],
       "activities": [...]
     }
     ```

#### Export UI
- Location: Board header action menu (kebab/overflow)
- Action label: "Export"
- Submenu options:
  - "Export as CSV" (prompts: which lists? all/selected)
  - "Export as JSON" (full board)
- Toast feedback: "Exporting {count} cards..." then "Export complete"

#### Export Permissions
- Permission gate: `boards-manage` (existing)
- Available for all board types (general, task, matters, leads)

### Feature: Board Import

#### Import Format: Trello JSON

Support the Trello JSON export format (`.json` files from Trello's Export board → JSON feature):
- Parse `lists`, `cards`, `labels`, `members` from Trello schema
- Map Trello fields to MatterChat equivalents:
  - Trello card → MatterChat card
  - Trello list → MatterChat list (create if not exists)
  - Trello labels → MatterChat labels
  - Trello attachments → link in description (no file upload)
  - Trello comments → MatterChat comments
  - Trello checklist items → description notes (convert to subtasks if applicable)
  - Trello due date → MatterChat due date
  - Trello members → search by email for existing users, note if not found

#### Import UI
- Location: Boards home page or new board creation flow
- Option: "Import from Trello" button in new board modal
- Modal flow:
  1. File input (accept `.json`)
  2. Board name field (pre-populated from Trello JSON, editable)
  3. Board type selector (general, task, matters, leads)
  4. Preview: card count, list count, estimated import time
  5. "Import" button (triggers async job)
- Toast: "Importing {cardCount} cards into {listCount} lists..." then "Import complete"

#### Import Validation
- Validate JSON structure (required: lists, cards arrays)
- Skip invalid cards (log warnings)
- Handle missing/invalid references gracefully (orphan cards to first list)
- Prevent duplicate imports (offer merge/replace options if board name matches existing)

#### Import Permissions
- Permission gate: `boards-manage` (existing)
- Async import job handles large files (>10MB / 1000+ cards)

### API Endpoints

#### Export Endpoints

**POST /api/v1/boards.export**
- Request: `{ boardId, format: 'csv' | 'json', listIds?: string[] }`
- Response: `{ url, filename }`
- Returns a downloadable URL (temporary, 1-hour TTL)
- CSV returns zip file if multiple lists

**GET /api/v1/boards.export/{exportId}/download**
- Returns binary export file
- Sets `Content-Disposition: attachment; filename={filename}`

#### Import Endpoints

**POST /api/v1/boards.import**
- Request: `{ file: File, boardName: string, boardType: 'general' | 'task' | 'matters' | 'leads' }`
- Response: `{ jobId, boardId }`
- Triggers async import job, returns immediately

**GET /api/v1/boards.import/{jobId}/status**
- Response: `{ status: 'queued' | 'processing' | 'complete' | 'failed', progress: 0-100, boardId?, error? }`

### Implementation Details

#### Server-side (Meteor)
- New file: `apps/meteor/server/lib/boards/export.ts` (CSV/JSON generators)
- New file: `apps/meteor/server/lib/boards/import.ts` (Trello JSON parser)
- New file: `apps/meteor/app/api/server/v1/boards-export.ts` (export endpoints)
- New file: `apps/meteor/app/api/server/v1/boards-import.ts` (import endpoints)
- Use Bull queue for async import jobs

#### Client-side (React)
- New file: `apps/meteor/client/views/boards/export/ExportModal.tsx`
- New file: `apps/meteor/client/views/boards/import/ImportModal.tsx`
- New menu item in board header
- New button in boards home

#### Types
- Update `packages/core-typings/src/IBoardExport.ts` with export metadata
- Update `packages/core-typings/src/IBoardImport.ts` with import job status

### Testing

- Unit tests:
  - CSV generation (fields, escaping, multi-value)
  - JSON export (structure, references)
  - Trello JSON parsing (valid/invalid inputs)
  - User/label mapping during import

- Integration tests:
  - Full export → import roundtrip (CSV, JSON)
  - Trello → MatterChat import
  - Large board (1000+ cards) performance

### UI/UX Notes

- Use premium design tokens (docs/design/premium-refresh/README.md)
- Export/import modals follow standard MatterChat dialog pattern (radius 14px, shadow3)
- Action buttons use green primary style
- File upload accepts `.json` files with visual feedback
- Progress indicator during import (percentage, ETA)
- Toast notifications for success/error with actionable next steps

### Success Criteria

- Export button functional from board header
- CSV export downloads properly formatted with all card data
- JSON export includes full board structure
- Trello JSON import successfully parses and creates board
- User mapping works (email match, note unfound)
- Large boards (1000+ cards) import without timeout
- All data preserved in roundtrip export → import
- Zero typecheck errors
- Zero ESLint errors
