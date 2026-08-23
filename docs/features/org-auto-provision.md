# Org Auto-Provision (Your Whole Firm, Ready on Day One)

> Status: **live on the MatterChat side** (merged to staging, commit `987553c97d`, PR #11; **reworked 2026-07-30** — per-ORG marker + org-admin trigger + firm-scope stamping, branch `feat/org-provisioning-fix`). End-to-end operation **pending** the CentralizedAuth roster endpoint (CentralizedAuth PR #352, not yet merged) — see "Current limitations".

## What it is

The first time one of a firm's **admins** signs in to MatterChat with their OmnisAI account, MatterChat quietly fetches the firm's member roster from OmnisAI (the same org that powers CasePro) and pre-creates a linked MatterChat account for every teammate. When each teammate later clicks "Sign in with OmnisAI," their account is already there — right name, verified email, linked identity — no invites, no email round-trips, no duplicate accounts.

## Who it's for

Firm admins onboarding their office. Instead of inviting 25 people one by one (and fighting spam filters), the team "is just there."

## How it works, step by step

1. An admin signs in with OmnisAI (OIDC) and their login carries the firm's `orgId`. "Admin" means either a MatterChat **workspace admin** (how org #1 always worked) *or* someone whose OmnisAI login carries an **org-admin role** (the `casepro:role` claim, matched against `MATTERCHAT_ORG_ADMIN_ROLES`, default `admin,owner`). The second path is what lets a *second* firm's roster mirror — its admins never hold MatterChat workspace-admin.
2. MatterChat atomically claims the org's durable marker in the `matterchat_org_provisions` collection (one document per org, `_id` = orgId — the collection's built-in unique index is the concurrency lock, so two simultaneous first-logins can't both run the import).
3. In the background — sign-in is never delayed or blocked — MatterChat calls the OmnisAI auth service for the org's member roster (authenticated with a shared provision key, not a user token).
4. For each member, MatterChat pre-creates an account: name, username (derived from email, de-duplicated), verified email, standard `user` role, the OmnisAI identity link (`services.omnisai.id`), and the firm-scope stamp (`customFields.firmId` = orgId — the same field the cross-firm directory scoping reads). No emails are sent.
5. When a teammate signs in with OmnisAI for the first time, MatterChat matches them to their pre-created account (by OmnisAI subject, then email) and logs them straight in — the same person, never a duplicate.
6. On success the marker flips to `done` (with import counts); a failed roster fetch flips it to `failed`, which re-arms provisioning on the next qualifying login. A single member failing to import never stops the rest.

### Firm-scope stamping (every login, not just provisioning)

Independently of the roster import, **every** OmnisAI login (web OIDC and the Chi session-exchange lane — both funnel through `resolveOmnisaiUser`) stamps `customFields.firmId` from the login's org claim when the user doesn't have one yet. An existing *different* `firmId` (e.g. a self-serve firm's Team id) is **never overwritten** — it's kept and a warning is logged. Stamped values carry `customFields.firmIdSource: 'omnisai'` so they're distinguishable from self-serve firm stamps. With the firms feature off (`Firms_SelfServe_Enabled` / `Firms_Scoped_Directory`), the stamp is harmless metadata — scoping stays a no-op.

### Backfill & first deploy on an existing workspace

A startup applier (`orgBackfill.ts`, runs at every boot, cheap after the first run) does two things:

- Seeds a `done` marker for any org recorded by the **legacy per-admin marker** (`services.omnisai.provisionedOrgId`) — so the first deploy of this code onto the live workspace does **not** re-run provisioning for the already-provisioned org.
- Stamps `customFields.firmId` from `services.omnisai.orgId` for existing OIDC-linked users that predate login-time stamping (users with an existing `firmId` are excluded).

### Re-running provisioning for an org

There is no admin UI/endpoint for this (yet). Ops re-arms an org by deleting its document from `matterchat_org_provisions` (or setting its `status` to `failed`); the next qualifying login re-runs the import, which is idempotent (existing members are adopted, never duplicated).

**What it does *not* do (by design, this slice):** it pre-creates *accounts* only — it does not create channels or teams, and members added to the firm later are not retroactively imported (they get an account on their own first sign-in).

## Admin setup

Two pieces of server configuration (environment variables — names below, values are secrets managed by ops):

| Config | Required | Purpose |
|---|---|---|
| `MATTERCHAT_PROVISION_KEY` | yes | Shared secret authenticating MatterChat's roster request to the OmnisAI auth service. The same value must be configured on the CentralizedAuth side. Missing/empty → provisioning silently does nothing. |
| `OMNISAI_OIDC_ISSUER` *or* `OMNISAI_AUTH_API_BASE` | yes (one of) | Where the OmnisAI auth service lives; used to build the roster URL. |
| `MATTERCHAT_ORG_ADMIN_ROLES` | no (default `admin,owner`) | Comma-separated, case-insensitive list of `casepro:role` claim values that count as "org admin" for the provisioning trigger. CentralizedAuth's role vocabulary is not guaranteed (some deployments emit role UUIDs) — set whatever the issuer actually emits. Workspace admins always qualify regardless. |

Env additions are deployed via the **MatterChat-New** manifests repo (this repo's `kubernetes/` dir is dead — ArgoCD owns staging from MatterChat-New's `staging` branch; prod is the manual apply workflow).

No admin-UI steps; there is nothing to click. OmnisAI sign-in ("Sign in with OmnisAI") must already be configured.

## Current limitations

- **(pending verification)** Full end-to-end operation requires the CentralizedAuth `GET /organizations/:id/members` service endpoint (CentralizedAuth PR #352), which is **not yet merged** as of 2026-07-01. The MatterChat side is deployed and fails soft (no-op with a warning) until the endpoint exists.
- Accounts only — channel/team mirroring is a future slice.

## FAQ

**Will my teammates get an email?**
No. Accounts are pre-created silently (import-style); people discover them simply by signing in with OmnisAI.

**What if someone already had a MatterChat account?**
Matching is by OmnisAI identity first, then email — an existing linked account is adopted, not duplicated.

**Is the admin's login slower on first sign-in?**
No. Provisioning runs in the background after login completes, and a provisioning failure never breaks sign-in.

**Who can trigger provisioning?**
A MatterChat workspace admin, or a member whose OmnisAI login carries an org-admin role (`casepro:role` matched against `MATTERCHAT_ORG_ADMIN_ROLES`); regular members signing in never trigger a roster import.

**Does a user's firm ever change automatically?**
No. The first org claim wins; if a later login carries a different org, MatterChat keeps the existing `customFields.firmId` and logs a warning. Moving a user between firms is a manual ops action (clear the field, let the next login re-stamp it).

## Key files (for developers)

`apps/meteor/app/omnisai-oauth/server/orgProvision.ts` (marker collection + claim lock, roster fetch, import loop, firmId stamping), `orgProvisionHelpers.ts` (pure decision logic + unit specs in `tests/unit/app/omnisai-oauth/server/`), `orgBackfill.ts` (startup marker seed + firmId backfill), `loginHandler.ts` (`resolveOmnisaiUser` login-time stamp + `maybeAutoProvisionOrg` trigger). CentralizedAuth side: `GET /organizations/:id/members` with `x-provision-key` (PR #352).
