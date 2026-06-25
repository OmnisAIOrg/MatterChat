# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **"checkpoint matterchat" updates this before a session ends.** Decisions + reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-25 · **Branch:** `staging` (deploy is now BUILD-ONLY — ArgoCD owns the cluster; see below)

## 🔴 READ FIRST (2026-06-25) — staging is ArgoCD-owned; deploy is BUILD-ONLY; OmnisAI login works E2E
- **Staging is deployed by ArgoCD** (app `matterchat-staging`, syncs from repo **`MatterChat-New`** `kubernetes/staging/`, automated+prune+selfHeal — owns Deployment/Service/**Ingress**). THIS repo only BUILDS the image (→ ECR `matterchat:staging-latest`); its `kubernetes/staging/*.yaml` is **DEAD** (ArgoCD reverts it). The GHA deploy (PR #16) is now **build-only** → builds image + `kubectl delete pod` to roll it. So merging to `staging` is **safe again** (it no longer `kubectl apply`s the conflicting manifests that flipped the Ingress to the wrong ALB and 404'd the site). Full story in `DECISIONS.md` (2026-06-25) + memory `matterchat-staging-argocd-truth`.
- **OmnisAI login works end-to-end.** Fixes: ingress rebound to the frontend ALB; OIDC issuer/clientId seeded as **persisted Mongo settings** (`getConfig` reads settings-first) — survive ArgoCD; Setup Wizard held at `completed`; `verifyIdToken` accepts a missing `iss`/`aud`. **Still fail-soft (production TODO):** Ed25519 signature verify + nonce; CentralizedAuth should emit standard iss/aud/nonce, then re-enable strict.
- **No local `kubectl`.** Cluster introspection = founder-authorized read-only `matterchat-staging-diag.yml` (`workflow_dispatch` on `develop`). cluster `stg-omnisai-cluster`, ns `staging`.

## ⚡ Prior session (2026-06-24) — Omnis Boards parity (PR #12, merged 2026-06-25)
Three Trello/Asana parity features on **Omnis Boards**, all generic / **standalone-safe** (work on a plain `general`/`task` board, no CasePro — verified by an 8-agent code map + adversarial standalone check):
- **True Gantt** in the Timeline view — **hand-built, no third-party Gantt lib** (the free ones are AGPL/GPL or paywall advanced features). Month/week/day axis, bars, milestone diamonds, finish-to-start dependency arrows, progress fill, today line, drag-to-reschedule + edge-resize. Timeline gains a Gantt|List toggle (Gantt default). New: `client/views/boards/views/gantt/{ganttModel.ts,GanttChart.tsx}`.
- **Nested subtasks** — child cards in the same board+list via the existing `parent`/`child` relation; new `card/SubtasksPanel.tsx` (add/complete/unlink/drill-in) + progress rollup + tile badge. Typed the relations.add/remove + complete REST endpoints (server routes already existed).
- **Time tracking** — `ITimeEntry` sub-doc + `timeEstimateMinutes`/`timeEntries` on `IBoardCard`; `logTime`/`deleteTimeEntry` service fns + `boards.card.log-time`/`delete-time-entry` routes; new `card/TimePanel.tsx` + tile badge. Estimate rides existing `boards.cardUpdate`.

A **multi-agent adversarial review found 11 real bugs → all fixed** (2nd commit): subtasks silently dropped on boards >100 cards (the board-cards endpoint caps at `API_Upper_Count_Limit`=100 → children now resolved per-id via `useQueries`); Gantt drag listener leak + no `pointercancel`; orphan card if a subtask link fails (now archived back); time-input validation (minutes>0, valid `spentAt`, non-negative integer estimate). **Typecheck-clean (0 new errors vs the 23 pre-existing baseline), ESLint-clean.** Shared `core-typings`/`rest-typings` gained additive optional fields/endpoints — the meteor app consumes them as built `dist`, so **rebuild those two packages after pulling** (`yarn workspace @rocket.chat/core-typings run build`, then rest-typings) before the meteor `tsc`.

## ⚡ MatterChat is LIVE on real staging
**https://matterchat.stg-omnisai.io** — on EKS. Deploy model: push to **`staging`** → GitHub Actions builds → ECR → `kubectl apply` `kubernetes/staging/matterchat-{mongo,deployment-staging}.yaml` → rollout (**`Recreate`** strategy). The `matterchat-staging-deploy.yaml` workflow now dumps pod state + events + crash logs on a failed rollout (so a boot failure is diagnosable, not a blind revert). ⚠️ `Recreate` = brief downtime if a rollout fails, and a rollout can flake on a stuck termination (one did 2026-06-24 — a clean redeploy was green).

## ⚡ Cross-firm (CFCS / Omnis Counsel) is LIVE + SECURE on staging (2026-06-24)
Opposing-counsel messaging is wired end-to-end and turned ON:
- **CFCS backend** (`~/omnis-counsel`, `staging`) — internal ClusterIP service in **STRICT identity mode** + real audit key + a NetworkPolicy. REFUSES to start without `CFCS_AUDIT_KEY`; requires the proxy's verified `x-cfcs-caller` on every non-`/health` route (no header-less body-trust in prod). `CFCS_TEST_MODE=1` relaxes it for the test suite/demo only.
- **`/_crossfirm` server proxy** (`app/omnisai-oauth/server/crossFirmProxy.ts`) — authenticates the MatterChat user, derives the verified OmnisAI subject (`services.omnisai.id`), strips inbound `x-cfcs-*`, forwards to `http://cfcs:9200` with an unforgeable `x-cfcs-caller`/`x-cfcs-firm`. **Verified live:** unauth `POST /_crossfirm/whoami` → 401 (mounted + enabled + auth-gated).
- **CFCS identity gateway** (`omnis-counsel/server.js`) — single pre-dispatch step binds every actor field to the resolved caller (unique principal or fail closed); firm asserted ONLY by the verified header.
- **Browser** (`useCrossFirmFetch.ts` / `CrossFirmSection.tsx`) — calls same-origin `/_crossfirm` with a Bearer loginToken; the panel gates on `CrossFirm_Enabled`.
- **Enabled via deployment env:** `CFCS_API_URL=http://cfcs:9200`, `OVERWRITE_SETTING_CrossFirm_Enabled=true`, `OVERWRITE_SETTING_CrossFirm_Firm_Name="Apex Law LLP"`.
- **Red-teamed before deploy** (5 lenses): go-list M1/M2/M3/M5 + S1–S6 + the audit-key all fixed + verified — CFCS `test.js` **26/0**, `test-audit.js` **8/0**, strict-mode security suite all-pass (spoof blocked, header-less→401, missing firm→400, unprovisioned→403, refuses-boot-without-key).

## 🆕 Org auto-provision — built 2026-06-24, PRs up (NOT merged)
On a firm **admin's first "Sign in with OmnisAI"**, MatterChat now mirrors the firm's CasePro team into the workspace automatically. Branch `feature/matterchat-org-autoprovision` in BOTH repos:
- **MatterChat** ([PR #11](https://github.com/OmnisAIOrg/MatterChat/pull/11), base `staging`) — `app/omnisai-oauth/server/orgProvision.ts` (`provisionOrgFromRoster`: roster fetch + idempotent per-member pre-create) + `loginHandler.ts` `maybeAutoProvisionOrg` hook (admin + orgId + per-admin `services.omnisai.provisionedOrgId` marker set only after success; background; never blocks/breaks login).
- **CentralizedAuth** ([PR #352](https://github.com/OmnisAIOrg/CentralizedAuthBackend/pull/352), base `staging-backend`) — new `GET /organizations/:id/members` (service-auth) + `ProvisionApiAuthGuard` (shared secret `x-provision-key` or KeyGate `auth:organizations:read`). Shared-auth ⇒ **needs a non-author review; do not self-merge.**
- **Two deliberate deviations from the design** (see DECISIONS 2026-06-24): service provision-key (not user-token replay, which the session-based AuthGuard rejects); IMPORT/pre-create accounts (not `invite-multiple`, which no-ops on the already-member team — and import needs no SMTP).
- **Config to set on both Alpha/staging apps:** `MATTERCHAT_PROVISION_KEY` (same secret both sides), MatterChat also `OMNISAI_OIDC_ISSUER` (or `OMNISAI_AUTH_API_BASE`). Absent ⇒ silent no-op.
- **Verified:** CentralizedAuth `tsc` clean; MatterChat scoped `tsc` consistent with shipping code. **NOT yet:** live E2E (needs both full stacks → run in Alpha per-PR env).

## Prior session (2026-06-23, all live on staging)
OmnisAI OIDC login E2E (client `WoqXiUHmfiYFRtRhtZoPYygvbthcwqdz`); setup-wizard skip; email-2FA off; first-OmnisAI-user→admin; Admin rail entry; Activity `/boards/inbox` route fixed; Boards code-split; Slack IMPORT verified.

## Deferred / open
- **M4 — before authoritative PRODUCTION cross-firm:** bind firm to a verified CentralizedAuth tenant/org id, not the free-text `CrossFirm_Firm_Name` (name collisions merge escrow domains). Safely deferred behind M2's fail-closed stopgap. Also required before a production launch: real per-state bar verification, firm-held KMS/HSM escrow, and the **legal-ethics (Rule 4.2) + security/crypto expert sign-offs**.
- **Two-firm demo:** staging is a single firm ("Apex Law LLP"), so the panel/identity/create-room work but a full two-firm exchange needs a second instance — or a strict-mode-compatible seed path (`seed-demo.js` hits `POST /firms|/attorneys`, which strict mode now gates).
- **LitBox proxy token-expiry** (`litboxProxy.ts resolveUser`) has the same M3 gap the cross-firm proxy just fixed — task chip spawned.
- LitBox Files PR #186 (trust the OIDC client); branch consolidation; Boards server-side pagination; LitBox encrypt-at-rest key.

## Single next safe task
**This session's open loop (Boards parity, PR #12):** browser-verify it via an alpha preview — click through Gantt drag-reschedule + edge-resize, subtask add/complete/unlink, and time logging — then land the 1 required non-author review (PRs open under Chi-Omnis can't self-approve) and merge `feature/boards-gantt-timeline` → `staging`. Remaining Boards parity gap after this: a Forms/intake builder.

**Prior standing thread (cross-firm):** Browser E2E of cross-firm — log into matterchat.stg-omnisai.io → open a channel → "Cross-firm · Opposing counsel" action → confirm `/whoami` bridges identity + a matter room can be created. Then design the two-firm demo (second instance, or a bootstrap seed path that works under strict mode).
