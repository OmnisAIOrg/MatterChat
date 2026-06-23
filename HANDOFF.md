# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **The "checkpoint matterchat" command updates this before a session ends.** Standing rules + the two session commands are in `CLAUDE.md`; decisions + their reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-23 · **LIVE:** https://matterchat.stg-omnisai.io

## ⚡ Headline: MatterChat is DEPLOYED + LIVE with LitBox Files working
MatterChat runs at **https://matterchat.stg-omnisai.io** (EKS staging). The **LitBox "Files" integration works end-to-end**: OmnisAI login → embedded LitBox file browser → the user's real files. Verified live: `/` → 200, `/api/info` → 200 (Rocket.Chat 8.6), `/_litbox/v1/files` → 401 (proxy wired). Final human test outstanding: log in + open Files in a browser.

## Branches (⚠️ TANGLED — consolidation needed before any merge)
- **`staging`** — the EKS **auto-deploy branch** (push = deploy). The LIVE state. Review PR **#9 → develop** (do NOT merge as-is).
- **`chore/matterchat-followups`** — docs + the extended security test + the hardening source. Pushed (no PR; or fold into the consolidation).
- **`feature/matterchat-cross-firm`** (PR **#6**, "REVIEW ONLY") — the base everything was built on (cross-firm CFCS work). `staging` + `chore` both sit on top of it.
- **Cleanup task:** rebase the LitBox/deploy/hardening work onto a clean branch off `develop` (separate from the cross-firm WIP) before merging.

## Built + verified this session (all LIVE on staging)
- **LitBox "Files":** `/_litbox` proxy (`apps/meteor/app/omnisai-oauth/server/litboxProxy.ts`), embedded `@omnisaiorg/litbox-file-browser` (`client/views/litbox/`), left-rail Files item. Credential captured at OIDC login, stored top-level `omnisaiLitbox`, injected server-side.
- **LitBox accepts MatterChat's OIDC token:** `Litbox-backend` PR **#184 (MERGED + deployed)** — `validate_session` accepts an OIDC access token via `mcp/get-session`, **audience-bound** to `OIDC_TRUSTED_CLIENT_IDS` (= MatterChat's client `EEHKZ…`).
- **EKS deploy pipeline (net-new):** `.github/workflows/matterchat-staging-deploy.yaml` + `kubernetes/staging/matterchat-{mongo,deployment-staging}.yaml`. Push to `staging` → build `apps/meteor/.docker/Dockerfile.alpha` → ECR → `kubectl apply` → rollout. Mongo replica set `rs0`, ALB ingress group `staging-backend-shared` order **870**. (The alpha-preview system never onboarded the Meteor fork — AlphaEnvironment PR #13 exists but unused.)
- **Hardening:** refresh-on-401; `accept-encoding` strip (Files render); token-leak fix (`getUserInfo.ts` + `ApiClass.ts` — `omnisaiLitbox` was leaking via `users.updateOwnBasicInfo`); redirect/SSRF fix (`@rocket.chat/server-fetch` opt-in `followRedirects:false`); **encrypt-at-rest** (`litboxCrypto.ts`, AES-256-GCM — DORMANT until `LITBOX_TOKEN_ENC_KEY` secret set, backward-compatible).
- **Docs/tests:** `docs/litbox-files-integration.md`, `docs/matterchat-staging-deploy.md` (build gotchas), `tests/unit/app/lib/server/functions/omnisaiLitbox-no-leak.spec.ts` (8 passing).

## Running services
| What | URL | Notes |
|---|---|---|
| MatterChat (live) | https://matterchat.stg-omnisai.io | EKS staging; **push to `staging` branch = deploy** (~15–30 min build) |
| LitBox backend | https://litbox-app.stg-omnisai.io | accepts MatterChat's OIDC token (PR #184 deployed) |
| Local dev | localhost:3100 (`/tmp/mc-dev.sh`) | FLAKY — Meteor dev-proxy `ERR_STREAM_WRITE_AFTER_END` crash bug. Prefer the live URL. |

## In-flight gotchas
- **Branch tangle** (above) — consolidate before merging.
- Deploy gotchas (all fixed, see `docs/matterchat-staging-deploy.md`): Deno **2.3.1 build / 1.37.1 runtime**; keep `.git` (meteor build runs `git log`); StatefulSet **and** Deployment need delete+recreate fallback (pre-existing incompatible resources in the reserved slot); `NPM_TOKEN`→`ENV` for `@omnisaiorg` GitHub Packages; ALB `group.order` must be unique; Mongo headless Service needs `publishNotReadyAddresses`.
- Secrets: AWS + `NPM_TOKEN` wired (org/repo). For encrypt-at-rest add `LITBOX_TOKEN_ENC_KEY` (base64 32 bytes).
- **`Chi-Omnis` can't self-approve PRs** — needs a non-author approver (`omnisai-io`, an engineer).

## Next safe task
1. **Founder's final test:** sign in at matterchat.stg-omnisai.io + click Files.
2. **Consolidate branches:** rebase the LitBox/deploy/hardening work onto a clean `develop`-based branch (off the cross-firm WIP), fold in `chore` docs+tests, replace PR #9.
3. **Enable encryption:** add the `LITBOX_TOKEN_ENC_KEY` secret.
