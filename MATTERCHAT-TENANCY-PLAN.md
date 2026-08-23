# MatterChat Boards/Leads tenancy — the durable fix

**Status: DESIGN ONLY. Nothing here has been run.** Phase 1 (the branch this file arrives on)
closed the cross-firm read path using data that already exists. This is Phase 2 — the schema change
that makes tenancy a property of the data rather than a property of every query. It is a backfill on
a live Mongo and it needs a maintenance decision, not a merge.

---

## Why Phase 1 is not the end of it

Phase 1 derives a board's firm from its **members** — a board is reachable when the caller is a
member, or when a member shares the caller's `customFields.firmId` cohort. That works, and it is
correct for the deployment as it stands, but it has three properties a legal product should not keep:

1. **It is derived, not declared.** A board with no members, or whose members were all deleted,
   belongs to nobody and is reachable by nobody. Recovering it is a manual database edit.
2. **Every new read is a new opportunity to forget.** The scope lives in call sites. Phase 1 fixed
   the ten that existed; the eleventh is one commit away, and nothing fails when it is missing.
3. **It cannot make uniqueness per-firm.** `leads.refNo`, `leads.caseproIntakeId` and
   `signup_packets.esignEnvelopeId` are globally unique indexes and `nextSeq('leadRefNo')` is a
   single global counter. Two firms on one workspace *collide* — the second firm to intake a lead
   gets a duplicate-key error, or two firms share one reference-number sequence. No amount of query
   scoping fixes that; only a per-firm key does.

Point 3 is the one that matters for onboarding a second firm. Points 1 and 2 are why this should not
be deferred indefinitely.

---

## The change

Add `firmId: string` to every Boards-family document, as the **first column of every index** and a
term in **every** query — including for an administrator.

### Collections that need the column

All 22 `boards_*` collections, as declared in `packages/models/src/models/Boards*.ts` on
`staging@42a2b91b`, plus the raw `boards_counters`. Grouped by how each one's firm is resolved.

**Resolves through `boardId` → `boards_boards`:**

| Collection | Notes |
| --- | --- |
| `boards_boards` | the root — firm comes from its members (see backfill); everything else inherits |
| `boards_lists` | |
| `boards_cards` | |
| `boards_leads` | carries two of the three colliding unique indexes |
| `boards_activities` | |
| `boards_automations` | |
| `boards_automation_runs` | |
| `boards_forms` | |
| `boards_saved_views` | workspace-wide views have no `boardId` — fall back to the owner's firm |

**Resolves through `leadId` → `boards_leads` → board:**

| Collection | Notes |
| --- | --- |
| `boards_communications` | |
| `boards_intake_tasks` | |
| `boards_signup_packets` | carries the third colliding unique index |
| `boards_sequence_enrollments` | |

**Resolves through `cardId` → `boards_cards` → board:**

| Collection | Notes |
| --- | --- |
| `boards_deadlines` | confirm the link field before running — may be card- or matter-linked |
| `boards_referrals_out` | |

**Resolves through the owning/creating user — no board link, the orphan-prone group:**

| Collection | Notes |
| --- | --- |
| `boards_referral_sources` | marketing registry; creator's firm |
| `boards_subscriptions` | subscriber's firm |
| `boards_notifications` | recipient's firm |
| `boards_user_notification_prefs` | owner's firm |
| `boards_comm_templates` | creator's firm; may be intended as workspace-wide — decide explicitly |
| `boards_playbooks` | creator's firm; seeded defaults may be workspace-wide — decide explicitly |
| `boards_sequences` | creator's firm |

**Special:**

| Collection | Notes |
| --- | --- |
| `boards_counters` | raw handle, no model, no indexes — becomes keyed per firm; see "counter" below |

Re-derive this list from `packages/models/src/models/Boards*.ts` before running anything: it was read
on `staging@42a2b91b` and a collection added after that date will not be here. The two "decide
explicitly" rows are genuinely ambiguous — seeded default templates and playbooks may be intended as
workspace-wide library content rather than firm data, and stamping them per-firm silently removes
them from every firm but one.

### Backfill, in dependency order

Boards first, because everything else resolves through `boardId`.

```
1. boards_boards
   firmId := the firm shared by the board's members
             (users.customFields.firmId, majority when members disagree)
   fallback := firm of createdBy
   fallback := UNRESOLVED  ← do not guess
2. boards_lists, boards_cards, boards_leads, boards_activities,
   boards_automations, boards_automation_runs, boards_forms, boards_saved_views
   firmId := boards_boards[boardId].firmId
3. boards_communications, boards_intake_tasks, boards_signup_packets,
   boards_sequence_enrollments
   firmId := boards_leads[leadId].firmId
4. boards_deadlines, boards_referrals_out
   firmId := boards_cards[cardId].firmId
5. boards_referral_sources, boards_subscriptions, boards_notifications,
   boards_user_notification_prefs, boards_comm_templates, boards_playbooks,
   boards_sequences, and any boards_saved_views left over from step 2
   firmId := firm of the owning/creating user
```

**Orphans and disagreements are the whole risk of this step.** A board whose members span two firms,
a lead whose board was deleted, a referral source created by a since-deleted user: these must be
*listed and decided by a human*, not defaulted. Write the backfill to emit an UNRESOLVED report and
refuse to stamp those documents. A wrongly-stamped document is invisible to the firm that owns it and
visible to one that does not — the exact failure this whole exercise exists to prevent.

Run the resolver **read-only first** and read the report before any write.

### The three unique indexes

Each becomes compound, firm-first, and keeps its `sparse` flag where it had one:

```
boards_leads:           { refNo: 1 }              → { firmId: 1, refNo: 1 }              unique
boards_leads:           { caseproIntakeId: 1 }    → { firmId: 1, caseproIntakeId: 1 }    unique, sparse
boards_signup_packets:  { esignEnvelopeId: 1 }    → { firmId: 1, esignEnvelopeId: 1 }    unique, sparse
```

Build the new index **before** dropping the old one, and only after the backfill has stamped every
document in that collection — a partially-stamped collection collapses every unstamped document onto
`firmId: null` and a unique index will reject the second one.

### The counter

`boards_counters` is a raw collection reached through the driver handle, with no model and no
indexes. `nextSeq('leadRefNo')` allocates from a single global document.

- Key it `{ _id: { firmId, name } }` (or `_id: "<firmId>:leadRefNo"` to avoid a compound `_id`).
- Seed each firm's counter to `max(refNo)` **for that firm** at cutover, not to the global max —
  otherwise firm two's first lead is numbered somewhere above firm one's last, which looks like
  thousands of missing leads to a firm that has just started.
- Give it a model and a primary key rather than leaving it a raw handle.

### Enforcement, so the eleventh call site cannot happen

The column alone is not the fix; a query that forgets it is still a leak. Add, in this order:

1. A model-layer helper that takes `firmId` as a required argument for every Boards finder, so
   omitting it is a type error rather than a silent full scan.
2. A CI guard that fails on a Boards-collection query literal with no `firmId` term — the port has
   one behind its equivalent rule; mirror it rather than inventing one.
3. Delete the Phase 1 member-derived scope only once both are in place, and not before.

---

## Order of operations that keeps the system serving

The constraint is that the app is up throughout and a rollback must not need a restore.

```
1.  Ship Phase 1 (this branch).                    ← reads are already safe from here on
2.  Add `firmId?: string` to the typings.          optional, so nothing breaks
3.  Deploy writers that STAMP firmId on insert     dual-write; nothing reads it yet
    but still read through the Phase 1 scope.
4.  Run the backfill resolver READ-ONLY.           produces the UNRESOLVED report
5.  A human resolves the report.                   ← the gate; do not automate past it
6.  Run the backfill for real.                     idempotent, resumable, batched
7.  Verify: zero documents without firmId, in      a single count per collection
    every collection in the table above.
8.  Build the new compound unique indexes.         background build
9.  Drop the old global unique indexes.
10. Migrate boards_counters per firm.              seeded from per-firm max(refNo)
11. Switch reads to firmId; keep the Phase 1
    scope as a belt-and-braces AND for one
    release.
12. Make `firmId` required in the typings, add
    the CI guard, remove the Phase 1 scope.
```

Steps 1–7 are all reversible without a restore: nothing reads `firmId` until step 11, and step 3's
stamping is additive. **Step 9 is the first irreversible one** — after the old index is gone, a
rollback to code that assumes global uniqueness can write a document the old index would have
rejected. Take a Mongo backup immediately before step 9.

That backup is not currently something the cluster does for you. Per the ops audit there are **no
backup CronJobs and no logical/mongodump backups** — only out-of-band AWS DLM daily EBS snapshots
(7-day retention) keyed on a `matterchat-mongo-backup=true` tag that is easy to lose when a PVC is
recreated. **Take and verify an explicit dump before step 9.**

---

## What this does NOT fix

Worth stating plainly, because a `firmId` column can create a false sense of completion:

- **Mongo runs with no authentication.** Per-firm columns give namespacing inside one database, not
  isolation. A compromised pod still reads every firm's data, and `MONGO_OPLOG_URL` points at the
  shared `local` database so every instance can read every firm's oplog. Real isolation needs Mongo
  auth with per-firm users at minimum. This must be settled before firm #2, or the isolation promise
  is false regardless of what the schema says.
- **The CasePro integration is per-workspace, not per-firm.** `CasePro_Enabled` and the base URL are
  workspace settings, so two firms on one workspace share one CasePro connection. That is a second
  tenancy boundary and it is not addressed here.
- **The crons have no caller.** `boardsCaseProSyncCron`, `boardsMattersCron` and
  `boardsCaseProSnapshotCron` scan `findByPipelineType(...)` workspace-wide by design. With a
  `firmId` column they should iterate firms explicitly rather than treating the workspace as one
  tenant. Phase 1 deliberately left them alone — they have no caller to scope to.
- **`hasPermissionAsync(uid, perm, boardId)` is not board-scoped.** Rocket.Chat's third argument is
  a *room* id; passing a board id means the scope silently does not apply, so every "board-scoped"
  permission check in the fork collapses to a global role check. Phase 1 did not touch this. It is
  independent of the column and should be fixed on its own.
