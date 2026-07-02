# Legal Roles & Permissions (Partner / Attorney / Paralegal)

> Status: **live** (merged to staging, commit `c734efae42`)

## What it is

MatterChat ships with law-firm roles out of the box, so an admin can express "partners run the workspace, attorneys run their own channels, paralegals participate" without hand-building custom roles. Three primary roles are seeded automatically:

| Role | Description | In one line |
|---|---|---|
| `partner` | Law firm partner | Admin-tier oversight of rooms, users, and boards |
| `attorney` | Associate attorney | Creates and runs their own channels and private rooms |
| `paralegal` | Paralegal / case support | Views and participates; no create/delete/admin powers |

Four supporting roles are also seeded so they're assignable (they were previously referenced by Boards but couldn't be granted): `case-manager`, `intake-specialist`, `intake-manager`, `marketing`.

## Who it's for

Firm admins setting up MatterChat for a real office structure — the roles map to how a law firm actually delegates authority, instead of Rocket.Chat's generic user/moderator/admin ladder.

## What each role can do

**Partner** — firm leadership powers across the whole workspace:
- View room administration and user administration; manage the permission matrix (`access-permissions`)
- Add users to any public or private room; remove, mute, or ban users
- Edit, archive, or delete channels and private rooms; set rooms read-only
- Delete or edit any message
- Promote others (set owner / moderator / leader on rooms)
- Full Boards powers: view, create, and administer boards

**Attorney** — create and run, but not administer:
- Create channels (`create-c`) and private rooms (`create-p`) — and as the creator they get the normal room-owner powers *on those rooms only*
- View and preview public/private rooms they can access; join their rooms
- Pin messages, use `@all` mentions, delete their *own* messages
- No workspace admin, no deleting other people's rooms or messages

**Paralegal** — participate:
- View and preview rooms they're given access to, read and write messages, delete their *own* messages
- No room creation, no admin surfaces, no destructive powers

## How an admin assigns a role

1. Go to **Administration → Users**.
2. Open the user, choose **Edit**.
3. In the **Roles** dropdown, pick `partner`, `attorney`, or `paralegal` (they appear alongside the stock roles).
4. Save. Permissions apply immediately.

This uses Rocket.Chat's standard role-assignment mechanism — no custom screens to learn.

## Admin setup

None beyond assignment. The roles and their permission grants are seeded automatically on server startup (idempotent), and a one-time migration (v337) backfills the permission grants on installs that existed before this feature.

Admins can still fine-tune what each role may do in **Administration → Permissions** — the seeded grants are a starting matrix, not a lock.

## FAQ

**Can I rename the roles or change what they can do?**
The role set is protected (it will re-seed), but the *permission grants* are editable in Administration → Permissions like any other role.

**Do these roles affect Boards?**
Partners get `boards-view`, `boards-create`, and `boards-admin`. Attorneys and paralegals use the standard user-level Boards access.

**What happens to users with no legal role?**
Nothing changes — the stock `user`/`admin` roles behave exactly as before. Legal roles are additive.

**Is there a partner-only channel type?**
No; use a private room and add partners. The roles govern powers, not room taxonomy.

## Key files (for developers)

`apps/meteor/app/authorization/server/constant/permissions.ts` (grants), `apps/meteor/app/authorization/server/functions/upsertPermissions.ts` (role seeding), `apps/meteor/server/startup/migrations/v337.ts` (backfill for existing installs).
