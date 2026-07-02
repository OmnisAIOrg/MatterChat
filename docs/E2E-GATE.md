# MatterChat E2E regression net

The deterministic safety net for the fork: curated upstream Playwright specs, run at two
gates. Built 2026-07-01 on branch `auto/playwright-gate`.

## The three tiers

| Tier | What | Size | When it runs | Where |
| --- | --- | --- | --- | --- |
| **smoke** | highest-value core flows (login, channel/DM create, messaging + edit, search, admin basics) | 26 tests / 7 files | every PR into `staging` | CI-booted server (`e2e-gate.yml`) |
| **mit-core** | every upstream spec valid on our MIT/CE fork | 592 tests / 124 files | on demand (`workflow_dispatch` on **E2E Gate**, suite=`full`) | CI-booted server (`e2e-gate.yml`) |
| **staging smoke** | read-only checks against the live site (`/api/info`, `/livez`, `settings.public`, login screen renders) | 4 tests | after every staging deploy + on demand | live `matterchat.stg-omnisai.io` (`staging-smoke.yml`) |

Suite membership is defined in ONE place: `apps/meteor/tests/e2e/matterchat-suites.ts`,
consumed by `apps/meteor/playwright.matterchat.config.ts` (projects `smoke` / `mit-core`).

```sh
# local usage (server on :3000 with TEST_MODE=true, Mongo rs0 on :27017)
cd apps/meteor
yarn test:e2e --config=playwright.matterchat.config.ts --project=smoke
yarn test:e2e --config=playwright.matterchat.config.ts --project=mit-core
```

## Suite inventory (measured 2026-07-01 via `--list`)

- Upstream suite (base config, federation already ignored): **728 tests / 158 files**
- Curated `mit-core`: **592 tests / 124 files**
- Excluded: **136 tests / 34 files**
  - 33 files are *entirely* EE-gated (`test.skip(!IS_EE, ...)` on every top-level describe):
    device management, marketplace apps, enforce-2FA, read receipts (3), video conference (2),
    voice calls, and 19 omnichannel EE features. Full list + reasons in `matterchat-suites.ts`.
  - `saml.spec.ts` needs its own SAML IdP docker-compose (infra, not EE).
  - `federation/**` needs a Matrix homeserver (excluded upstream too).
- Specs that are only *partially* EE (e.g. `administration.spec.ts`, `homepage.spec.ts`,
  most remaining omnichannel specs) stay IN `mit-core`; their EE tests self-skip because we
  never set `IS_EE=true`. **Never delete EE specs** — they're upstream code; deleting them
  guarantees merge conflicts on every upstream sync.

## How the CI boot works (`.github/workflows/e2e-gate.yml`)

1. Builds the PR's code into an image with `apps/meteor/.docker/Dockerfile.alpha` — the exact
   Dockerfile the staging deploy uses — pulling layer cache from the staging ECR `:cache` ref
   (read-only; the gate never writes to that cache). If AWS creds are missing the build still
   runs, just cold.
2. Boots `docker-compose-e2e-gate.yml`: single-node Mongo 8.0 replica set (exposed on :27017
   because Playwright's globalSetup seeds users/settings straight into Mongo) + the app with
   `TEST_MODE=true` on :3000. No traefik / EE micro-services — the CE monolith serves
   websockets itself.
3. `yarn install` + builds the two workspace packages the specs import at runtime
   (`@rocket.chat/core-typings`, `@rocket.chat/random`), installs Playwright browsers
   (cached), `yarn prepare`, then runs the chosen project.
4. Uploads traces + HTML report as the `playwright-report-<project>` artifact.

The check appears on the PR but is **deliberately not a required check** (solo-founder merge
model, approvals at 0). Red gate = signal to read the report, not a hard block.

## Post-deploy staging smoke

`e2e-staging-smoke/` is a standalone npm mini-project (kept OUT of the yarn workspaces so CI
installs it in seconds). Strictly read-only — no logins, no writes. It runs:
- automatically as the `staging-smoke` job chained after `build-and-deploy` in
  `matterchat-staging-deploy.yaml` (same push-to-staging trigger, so no cross-workflow /
  default-branch chaining problems);
- by hand via **Staging Smoke** → Run workflow (optional `staging-url` input).

Verified locally 2026-07-01: all 4 tests green against live staging (login hydration ~29s,
hence the 60s test timeout).

## Cost / runtime per gate run (estimates)

| Phase | smoke PR gate | full (mit-core) |
| --- | --- | --- |
| Docker image build (warm ECR cache; blacksmith-8vcpu) | ~20–35 min | same |
| Boot + yarn install + package build + browsers (cached) | ~8–12 min | same |
| Test execution (workers=1, upstream default) | ~8–12 min | ~2.5–4 h (upstream shards this 6-ways; revisit sharding if we ever run it routinely) |
| **Total** | **~40–60 min** | **~3–5 h** |

The image build dominates; it's the same cost the staging deploy already pays per push. If
that's too slow for PR feedback, the next lever is a bundle-reuse build (upstream's
`meteor-build` action + Dockerfile.alpine) or sharding.

## Known gaps / next steps

1. **Fork features have no UI specs yet** — Boards (beyond `scripts/boards-api-test.mjs`),
   OmnisAI OIDC login, LitBox Files panel, cross-firm panel, connectors. The suites file is
   the place to grow a `fork` project.
2. `workflow_dispatch` for **E2E Gate** / **Staging Smoke** becomes visible in the Actions UI
   once the workflow files reach the repo's default branch (`develop`); the PR-trigger and the
   deploy-chained smoke work from `staging` alone.
3. The full `mit-core` tier has never been executed end-to-end on our fork; expect a handful
   of legitimately-broken specs on first run (our redesigns changed login/chrome markup).
