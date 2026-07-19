# Self-serve Firms — public signup, org creation, invites

**Status:** built 2026-07-19 (branch `feature/self-serve-firms`) · gated off by default
**Setting gate:** `Firms_SelfServe_Enabled` (bool, default `false`, public) · `Firms_Scoped_Directory` (bool, default `true`, private)

## What it does (plain language)

A stranger can land on app.matterchat.com, click **Create an account**, register with
email + password, and immediately be walked through **creating their firm** — a private
team that becomes their own space. They can then **invite teammates by email**; each
teammate's email contains an invite link that registers them and lands them **inside the
inviter's firm** automatically. Members of one firm can't see or search members of
another firm.

## Moving parts

| Piece | File | What it does |
|---|---|---|
| Firm service | `apps/meteor/server/lib/firms/firmsService.ts` | createFirm (private Team + firm stamp), inviteToFirm (invite link + email), directory scope query, helpers |
| REST | `apps/meteor/app/api/server/v1/firms.ts` | `firms.create`, `firms.mine`, `firms.invite` (authRequired; service-layer authz) |
| REST types | `packages/rest-typings/src/v1/firms.ts` | endpoint typing for `useEndpoint` |
| Invite adoption | `apps/meteor/app/invites/server/functions/useInviteToken.ts` | joining a firm-team invite stamps `customFields.firmId` |
| No shared GENERAL | `apps/meteor/app/lib/server/functions/addUserToDefaultChannels.ts` | default-channel auto-join disabled while self-serve is on |
| Directory scoping | `apps/meteor/server/methods/browseChannels.ts`, `apps/meteor/server/lib/spotlight.js` | user search restricted to the caller's firm cohort (admins exempt) |
| Onboarding gate | `apps/meteor/client/views/root/MainLayout/FirmSetupCheck.tsx` | fresh user with no firm & no rooms → onboarding screen |
| Onboarding UI | `apps/meteor/client/views/firms/FirmOnboardingPage.tsx` | step 1 firm name → step 2 invite emails (both skippable) |
| Settings | `apps/meteor/server/settings/omnisai.ts` | the two `Firms_*` settings |

## Data model

No new collections. A firm **is** a private Team; membership is stamped on the user doc:

- `user.customFields.firmId` — the team `_id`
- `user.customFields.firmName` — pretty display name (team name is the slug)
- `user.customFields.firmRole` — `owner` | `member`
- firm team main room: `room.customFields.firmTeam: true`, `room.customFields.firmName`

Directory cohorts: users **with** a firmId only see their firm; users **without** one
(accounts predating the feature) only see other unstamped users; admins see everyone.

## What it deliberately is NOT

- **Not tenancy.** The multiworkspace spike rejected a tenant rewrite. Channel names,
  admin surfaces, and server-level settings remain per-workspace. Directory/search
  scoping is a privacy measure, not an isolation guarantee.
- **Not wired to CentralizedAuth orgs.** A self-served firm lives only in MatterChat.
  Linking it to a CasePro/CentralizedAuth organization (so the OmnisAI ecosystem sees
  it) is a follow-up — see `docs/features/org-auto-provision.md` for the existing
  reverse direction (CasePro org → MatterChat accounts).

## Enablement (deployment env)

```
OVERWRITE_SETTING_Firms_SelfServe_Enabled=true
OVERWRITE_SETTING_Accounts_EmailVerification=true   # requires working SMTP
# SMTP must be configured (SMTP_Host/Port/Username/Password + From_Email)
# or invite + verification emails silently fail.
```

`Accounts_RegistrationForm` stays `Public` (the default).

## Known limitations / follow-ups

- Invite emails require SMTP; without it `firms.invite` still returns the invite URL
  (shareable manually) but emails fail.
- Users who register with no invite and skip firm creation land in an empty workspace
  (deliberate: no shared GENERAL while self-serve is on).
- `users.autocomplete` (mention picker inside rooms) is room-scoped already, but
  cross-room autocomplete surfaces outside spotlight/directory were not exhaustively
  audited — flag anything that leaks names across firms.
- OmnisAI SSO users with a CasePro org get accounts via org auto-provision; they are
  exempt from the firm gate only via the "has subscriptions" heuristic. If a
  pre-provisioned SSO user somehow has zero rooms they will see the firm onboarding
  screen (skippable).
