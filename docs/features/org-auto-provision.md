# Org Auto-Provision (Your Whole Firm, Ready on Day One)

> Status: **live on the MatterChat side** (merged to staging, commit `987553c97d`, PR #11). End-to-end operation **pending** the CentralizedAuth roster endpoint (CentralizedAuth PR #352, not yet merged) — see "Current limitations".

## What it is

The first time a firm **admin** signs in to MatterChat with their OmnisAI account, MatterChat quietly fetches the firm's member roster from OmnisAI (the same org that powers CasePro) and pre-creates a linked MatterChat account for every teammate. When each teammate later clicks "Sign in with OmnisAI," their account is already there — right name, verified email, linked identity — no invites, no email round-trips, no duplicate accounts.

## Who it's for

Firm admins onboarding their office. Instead of inviting 25 people one by one (and fighting spam filters), the team "is just there."

## How it works, step by step

1. An admin signs in with OmnisAI (OIDC) and their login carries the firm's `orgId`.
2. In the background — sign-in is never delayed or blocked — MatterChat calls the OmnisAI auth service for the org's member roster (authenticated with a shared provision key, not a user token).
3. For each member, MatterChat pre-creates an account: name, username (derived from email, de-duplicated), verified email, standard `user` role, and the OmnisAI identity link (`services.omnisai.id`). No emails are sent.
4. When a teammate signs in with OmnisAI for the first time, MatterChat matches them to their pre-created account (by OmnisAI subject, then email) and logs them straight in — the same person, never a duplicate.
5. The provisioning is once-per-admin-per-org (an idempotency marker), and if the roster fetch fails it simply retries on the admin's next login. A single member failing to import never stops the rest.

**What it does *not* do (by design, this slice):** it pre-creates *accounts* only — it does not create channels or teams, and members added to the firm later are not retroactively imported (they get an account on their own first sign-in).

## Admin setup

Two pieces of server configuration (environment variables — names below, values are secrets managed by ops):

| Config | Required | Purpose |
|---|---|---|
| `MATTERCHAT_PROVISION_KEY` | yes | Shared secret authenticating MatterChat's roster request to the OmnisAI auth service. The same value must be configured on the CentralizedAuth side. Missing/empty → provisioning silently does nothing. |
| `OMNISAI_OIDC_ISSUER` *or* `OMNISAI_AUTH_API_BASE` | yes (one of) | Where the OmnisAI auth service lives; used to build the roster URL. |

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
Only a user with the `admin` role; regular members signing in never trigger a roster import.

## Key files (for developers)

`apps/meteor/app/omnisai-oauth/server/orgProvision.ts` (trigger, roster fetch, import loop, idempotency marker), `upsertOmnisaiUser` (account adoption on member sign-in). CentralizedAuth side: `GET /organizations/:id/members` with `x-provision-key` (PR #352).
