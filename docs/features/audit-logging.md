# Audit Logging: Privilege Trail, Legal Hold & Retention

> Status: **live** (merged to staging, commit `24e40f042f`) — with the deferred items called out below

## What it is

Compliance-grade logging and preservation controls for firms that answer to courts, carriers, and bar regulators:

1. **Privilege trail** — every change to *who can do what* is recorded: role assignments/revocations (`role.changed`) and permission grants/revocations (`permission.changed`), each with the acting user, target, timestamp, and the role/permission involved. This closes a gap even Rocket.Chat's enterprise audit doesn't cover.
2. **Legal hold** — a room can be placed under hold; held rooms are **excluded from retention pruning** (both the global retention pass and per-room retention policies), so messages under hold are never auto-deleted.
3. **Audit retention** — audit records themselves are kept for **7 years** and then expire automatically (a MongoDB TTL index), matching common legal-industry document-retention expectations.

These land on top of the events the server already records: login attempts, failed logins, settings changes, and user profile changes.

## Who it's for

- **Managing partners / compliance officers** who need to answer "who gave this person admin, and when?"
- **Litigation teams** that must preserve a matter's communications the moment a hold obligation attaches.

## How it works

**Privilege trail** — automatic. Assign or remove a role, grant or revoke a permission, and the event is written to the audit store (`server_events` collection) with actor identity, IP, and user agent. Records are indexed for query by event type, user, actor, and date range. Viewing audit data is gated by the `can-audit` permission (stock audit UI/API).

**Legal hold** — hold state lives on the room (`retention.legalHold`: enabled flag, who set it, when, case ID, free-text reason). While enabled, the retention prune job skips the room entirely.

**Retention** — audit records auto-expire after 7 years; no configuration needed. Room-message retention continues to use Rocket.Chat's standard retention policy settings, now subordinate to legal hold.

## Admin setup

- No new settings for the privilege trail or the 7-year audit TTL — both are on by default.
- Audit access: grant `can-audit` (and `can-audit-log`) to the roles that should see audit data (partners, compliance).

## Current limitations (deferred to a next slice)

Honest status — the following are **not in this release**:

- **No admin UI/method yet to set or clear a legal hold.** The hold model and its enforcement in the retention pruner are live, but the set/clear admin action, a `manage-legal-hold` permission, and a `legalhold.changed` audit event are pending. (Setting a hold currently requires operator/database access.)
- **No guard yet on manual purges** — legal hold protects against *automatic* retention pruning; a manual prune guard is pending.
- **Audit retention period is fixed at 7 years** — a configurable setting is planned.

## FAQ

**Does legal hold stop a user deleting their own message?**
Not in this release — hold blocks retention *pruning*. Message-level deletion controls remain governed by the standard `delete-own-message`/`delete-message` permissions (which the legal roles restrict).

**Are the audit records themselves protected from tampering?**
They're server-written records in a dedicated collection with no client write path; they expire only via the 7-year TTL.

**Can I export the privilege trail?**
Via the existing audit API (`can-audit`-gated). A dedicated export surface is not part of this slice.

## Key files (for developers)

`server_events` model (`packages/models/src/models/ServerEvents.ts` — indexes + 7y TTL), room legal-hold model methods (`Rooms.saveLegalHoldById` / `Rooms.clearLegalHoldById`), retention prune cron (legal-hold exclusion), role/permission change event emission.
