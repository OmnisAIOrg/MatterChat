# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **"checkpoint matterchat" updates this before a session ends.** Decisions + reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-23 · **Branch:** `staging` (the LIVE deploy branch → matterchat.stg-omnisai.io)

## ⚡ MatterChat is LIVE on real staging
**https://matterchat.stg-omnisai.io** — off localhost, on EKS. Deploy model: push to **`staging`** → GitHub Actions builds `apps/meteor/.docker/Dockerfile.alpha` → ECR → `kubectl apply` `kubernetes/staging/matterchat-{mongo,deployment-staging}.yaml` → rollout. (Branches are tangled — `staging` is the deploy branch; `feature/matterchat-cross-firm` + `develop` also exist. Consolidation deferred.)

## Built + verified LIVE this session (2026-06-23, all on `staging`, deployed + confirmed)
- **OmnisAI OIDC login works end-to-end.** The login failures were a stale OIDC client (registered for localhost). Re-registered a new client `WoqXiUHmfiYFRtRhtZoPYygvbthcwqdz` (redirect URIs include the staging + prod callbacks); `OMNISAI_OIDC_CLIENT_ID`→WoqX. LitBox PR #186 trusts it (UNAPPROVED — see deferred).
- **Setup wizard skipped**, **login button shown**, **email 2FA disabled** (no SMTP on staging → the 2FA code could never arrive). All via `OVERWRITE_SETTING_*` env on the deployment.
- **First OmnisAI user auto-promoted to admin** — `app/omnisai-oauth/server/loginHandler.ts` grants `admin` if the workspace has none (the OIDC path skipped stock RC's first-user rule). Founder IS admin. ⚠️ requires a TRUE logout→login (incognito shares sessions — that was the gotcha).
- **Admin entry added to the left rail** (`AppLeftRail.tsx`, gated on the admin role).
- **Activity 404 fixed** — registered the missing `/boards/inbox` route (`views/boards/routes.tsx`; made `NotificationsInbox.onNavigate` optional). Fixes the rail "Activity", the Boards sidebar "Inbox", and the My Day "activity inbox" link (all hit the same dead route).
- **Boards load faster** — code-split the non-default board views + card drawer in `views/boards/BoardRouter.tsx`.
- **Slack IMPORT verified working** — Admin→Import→Slack imported a test export. (Import = one-time MIGRATION, NOT live comms — that's cross-firm, below.)

## ⚠️ In progress — Cross-firm (CFCS) going live, secure-first. BLOCKED on AWS secrets.
The cross-firm UI is ALREADY on `staging` (deployed but OFF — `CrossFirm_Enabled/CFCS_URL/Firm_Name` empty; CFCS backend not deployed). Founder chose to wire it live with a security proxy first.
- **Stage 1 (deploy CFCS) is BUILT on `omnis-counsel` `staging`** (Dockerfile + internal ClusterIP manifest + CI) **but the deploy FAILED — that repo lacks the AWS deploy secrets.**
- **Critical-path blocker → engineer:** add `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` to the `omnis-counsel` repo (same IAM as MatterChat), then re-run "CFCS — Staging Deploy".
- **Full plan + the secure-proxy design** (CFCS internal-only + a `/_crossfirm` MatterChat proxy that injects the verified OmnisAI identity, overriding the actor `*AttorneyId` fields): in memory `omnis-counsel-crossfirm` — exact files, fields, and remaining stages.

## Deferred / open
- **LitBox Files:** PR https://github.com/OmnisAIOrg/Litbox-backend/pull/186 (trust the new OIDC client) UNAPPROVED → Files 401s until merged. Parked per founder.
- Branch consolidation (staging / develop / feature-cross-firm).
- Boards server-side pagination (task chip spawned).
- Encrypt-at-rest for LitBox tokens (`LITBOX_TOKEN_ENC_KEY` secret).

## Single next safe task
Once the engineer adds the AWS secrets to `omnis-counsel`: re-run the CFCS deploy, then build the `/_crossfirm` proxy → repoint `useCrossFirmFetch` → flip the 3 `CrossFirm_*` settings → seed `omnis-counsel/seed-demo.js` → cross-firm goes live. (Step-by-step in the `omnis-counsel-crossfirm` memory.)
