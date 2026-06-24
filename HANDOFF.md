# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **"checkpoint matterchat" updates this before a session ends.** Decisions + reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-24 · **Branch:** `staging` (the LIVE deploy branch → matterchat.stg-omnisai.io)

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

## Prior session (2026-06-23, all live on staging)
OmnisAI OIDC login E2E (client `WoqXiUHmfiYFRtRhtZoPYygvbthcwqdz`); setup-wizard skip; email-2FA off; first-OmnisAI-user→admin; Admin rail entry; Activity `/boards/inbox` route fixed; Boards code-split; Slack IMPORT verified.

## Deferred / open
- **M4 — before authoritative PRODUCTION cross-firm:** bind firm to a verified CentralizedAuth tenant/org id, not the free-text `CrossFirm_Firm_Name` (name collisions merge escrow domains). Safely deferred behind M2's fail-closed stopgap. Also required before a production launch: real per-state bar verification, firm-held KMS/HSM escrow, and the **legal-ethics (Rule 4.2) + security/crypto expert sign-offs**.
- **Two-firm demo:** staging is a single firm ("Apex Law LLP"), so the panel/identity/create-room work but a full two-firm exchange needs a second instance — or a strict-mode-compatible seed path (`seed-demo.js` hits `POST /firms|/attorneys`, which strict mode now gates).
- **LitBox proxy token-expiry** (`litboxProxy.ts resolveUser`) has the same M3 gap the cross-firm proxy just fixed — task chip spawned.
- LitBox Files PR #186 (trust the OIDC client); branch consolidation; Boards server-side pagination; LitBox encrypt-at-rest key.

## Single next safe task
Browser E2E of cross-firm: log into matterchat.stg-omnisai.io → open a channel → "Cross-firm · Opposing counsel" action → confirm `/whoami` bridges identity + a matter room can be created. Then design the two-firm demo (second instance, or a bootstrap seed path that works under strict mode).
