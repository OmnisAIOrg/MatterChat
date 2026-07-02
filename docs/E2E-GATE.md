# MatterChat E2E regression net

The deterministic safety net for the fork: curated upstream Playwright specs, run at two
gates. Built 2026-07-01 on branch `auto/playwright-gate`.

## The tiers

| Tier | What | Size | When it runs | Where |
| --- | --- | --- | --- | --- |
| **smoke** | highest-value core flows (login, channel/DM create, messaging + edit, search, admin basics) **+ the most stable fork specs** (boards, pagination, forms, legal hold) | 26 core + 8 fork tests / 11 files | every PR into `staging` | CI-booted server (`e2e-gate.yml`) |
| **mit-core** | every upstream spec valid on our MIT/CE fork **+ all fork specs** (they live under `tests/e2e/`) | 592 upstream + 16 fork tests / 131 files | on demand (`workflow_dispatch` on **E2E Gate**, suite=`full`) | CI-booted server (`e2e-gate.yml`) |
| **fork** | just the fork-feature specs (`tests/e2e/matterchat/**`, tag `@matterchat`) | 16 tests / 7 files | on demand / locally | CI-booted server (`e2e-gate.yml`) |
| **staging smoke** | read-only checks against the live site (`/api/info`, `/livez`, `settings.public`, login screen renders) | 4 tests | after every staging deploy + on demand | live `matterchat.stg-omnisai.io` (`staging-smoke.yml`) |

Suite membership is defined in ONE place: `apps/meteor/tests/e2e/matterchat-suites.ts`
(`SMOKE_SPECS`, `FORK_SPECS`, `FORK_SMOKE_SPECS`, plus the EE/external exclusions), consumed by
`apps/meteor/playwright.matterchat.config.ts` (projects `smoke` / `mit-core` / `fork`).

```sh
# local usage (server on :3000 with TEST_MODE=true, Mongo rs0 on :27017)
cd apps/meteor
yarn test:e2e --config=playwright.matterchat.config.ts --project=smoke
yarn test:e2e --config=playwright.matterchat.config.ts --project=mit-core
yarn test:e2e --config=playwright.matterchat.config.ts --project=fork
# or just the fork specs by tag against any project:
yarn test:e2e --config=playwright.matterchat.config.ts --grep @matterchat
```

## Fork-feature coverage (`tests/e2e/matterchat/**`, tag `@matterchat`)

The "next tier" the gate's author + reviewer flagged: e2e for the FORK's own surfaces. Unlike the
upstream specs these are OURS — no merge-conflict risk, so they can be renamed/deleted freely.
Setup is **API-seeded** through the `boards.*` / `rooms.*` REST surface
(`tests/e2e/matterchat/fixtures/boards-api.ts`); the UI is driven only for the assertion itself.

| Spec | Tests | What it proves | Skips |
| --- | --- | --- | --- |
| `boards.spec.ts` | 5 | render seeded board (lists + cards), add card via QuickAddCard composer, move card between lists (via the `boards.card.move` contract the drag handler calls — no flaky dnd-kit pointer sim), open the card detail drawer | — |
| `boards-pagination.spec.ts` | 1 | a board with 105 cards renders **all** of them (regression for the page-1 truncation bug; boundary cards 1/100/101/105 all visible) | — |
| `forms.spec.ts` | 1 | a **logged-out** visitor loads `/form/<slug>`, submits, and a card with the templated title lands on the target list | — |
| `legal-hold.spec.ts` | 1 | a room under a legal hold **refuses** `rooms.cleanHistory` (`error-room-under-legal-hold`); clearing the hold re-allows the prune | — |
| `matter-link.spec.ts` | 1 | a matter-linked channel groups under the **"Matters"** sidebar section (seeds `ensureBoard`→`bind`→`linkChannel`) | self-skips if the matters chain is unavailable on a bare CE gate |
| `read-receipts.spec.ts` | 3 | menu has no "Read receipts" item when off; both settings flip on via admin API | 1 `@skip !IS_EE` — the receipt **indicator** is an EE feature (upstream `read-receipts.spec.ts` owns the full flow) |
| `oidc-login.spec.ts` | 4 | OIDC feature is gated off on a bare CE gate (no OmnisAI button) | 2 `@skip` — the "Sign in with OmnisAI" PKCE flow needs a mock IdP + `OMNISAI_OIDC_*` env not wired into the CI boot (un-skip recipe in the file header) |

Flake-risk notes: card MOVE and read-receipts/OIDC indicators are the parts most likely to flake,
so those assertions go through a stable API contract or are `@skip`-annotated rather than driven
through pointer physics / EE-only UI. Everything else is deterministic API-seed + role/testid
assertions with explicit `expect`/`poll` waits (no `sleep`).

## First actual run of the `fork` project (2026-07-02)

Until now the fork specs were only `--list`-verified. First real execution against a booted
MatterChat: **Route B (local boot)** — docker was unavailable, so instead of the gate's
`docker-compose-e2e-gate.yml` we built the same production bundle the gate's `Dockerfile.alpha`
produces (`meteor build --server-only`) and ran it as `node main.js` on a dedicated port against a
dedicated single-node Mongo replica set. (An initial attempt with the Meteor **dev** server —
`meteor run` — was abandoned: its dev HTTP proxy crashed mid-run with `ERR_STREAM_WRITE_AFTER_END`
on the board's asset requests. The compiled prod bundle — what CI actually runs — has no dev proxy
and was rock-solid across repeated runs.)

**Result: 10 passed / 4 skipped / 0 failed**, stable across two consecutive runs.

| Spec | Result |
| --- | --- |
| `boards.spec.ts` (render / add / move / drawer) | 5 ✓ |
| `boards-pagination.spec.ts` (105-card render) | 1 ✓ |
| `forms.spec.ts` (public intake) | 1 ✓ |
| `legal-hold.spec.ts` (prune refusal) | 1 ✓ |
| `read-receipts.spec.ts` (menu-off + settings API) | 2 ✓ / 1 `@skip !IS_EE` (receipt indicator) |
| `oidc-login.spec.ts` (gating-off) | 1 ✓ / 2 `@skip` (need mock IdP + `OMNISAI_OIDC_*`) |
| `matter-link.spec.ts` (Matters sidebar) | self-skipped (see below) |

Fixes made to get green (all in the specs/fixtures — no product code changed):

1. **`fixtures/boards-api.ts` `getCards()` now paginates.** `boards.cards` honours
   `API_Upper_Count_Limit` (default **100**), so `getCards(boardId, 500)` could never return more
   than one page — the pagination spec's own `beforeAll` sanity check (`expect(all.length).toBe(105)`)
   failed with `Received: 100`. The helper now loops on `offset` until `total` is reached, mirroring
   the client's `fetchNextPage` contract. (Not a product bug — the 100-cap is standard REST behaviour;
   it's exactly *why* the board view paginates.)
2. **`exact: true` on every card-tile `getByRole('button', { name })`.** dnd-kit's
   `sortableAttributes` stamp `role="button"` on the **whole column** element; with no `aria-label`
   its accessible name is computed from contents, so it *contains* every card title (and "Add card").
   A non-exact name match therefore resolved to 2 elements (tile + column) → strict-mode violation.
   `exact: true` targets only the tile, whose accessible name IS the title. (Product observation, not
   fixed here: the column being exposed as a giant button named after all its cards is an a11y smell
   worth a follow-up — the drag affordance should be a labelled inner handle, not the column root.)
3. **Generous (`30s`) `toBeVisible` timeout on the first list-title render** in both board specs. The
   board view is data-driven (board → lists → first card page) and on a cold server the first column
   took >5s (the default) to hydrate; the 105-card board is the slowest. No `sleep` — just a longer
   `expect` wait.

Boot notes (environment, not spec/product — CI's fresh-DB prod boot avoids both):

- **`AUTO_ACCEPT_FINGERPRINT=true`** was required. The DB's stored deployment fingerprint
  mismatched, so the app raised the blocking **"Unique ID change detected"** modal over `<main>` —
  which failed the board renders and the read-receipts click (backdrop intercepts pointer events).
  A truly fresh gate DB never has a prior fingerprint, so this is local-boot-only; the env var also
  makes it a no-op on a clean boot.
- Default **roles** had to be seeded once before the *dev*-server boot (`rocketchat_roles` was empty
  and `rocket.cat` role assignment threw `error-invalid-role`); the compiled prod boot ordered
  `upsertPermissions` before `initialData` and did not need this.

`matter-link.spec.ts` **self-skip is justified — and revealed a spec/product assumption mismatch.**
The chain traces as: `boards.matters.ensureBoard` → **200 ok** (board + 2 lists), but
`boards.matters.bind` with a stub `matterId` → **400 `error-matter-not-found` ("Matter not found in
CasePro")**. The spec header claims bind "binds a card to a stub matter id; no CasePro needed,
snapshot resolution degrades" — in fact `bind` calls `refreshMatterSnapshot`, which **hard-fails**
when CasePro can't resolve the matter rather than degrading. On a bare CE gate (no CasePro backend)
the chain can't complete, so the defensive self-skip fires correctly. Follow-up options: (a) make
`bind` degrade gracefully for an unresolvable/offline matter (bind with an empty snapshot), or
(b) point the gate at a CasePro stub so the Matters sidebar assertion can actually run.

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

1. **Fork-feature specs landed AND executed for real** (`auto/fork-e2e-specs` →
   `auto/fork-e2e-firstrun`) — Boards (render/add/move/drawer), pagination regression, public Forms
   intake, legal hold, matter-link sidebar, read receipts, OIDC gating. First run: **10/14 pass,
   4 justified skips, 0 real failures** (see "First actual run" above for the spec fixes and boot
   notes). Two product follow-ups surfaced but were NOT patched here (test-only branch): the board
   **column** is exposed as one giant `role=button` named after all its cards (a11y smell from
   dnd-kit's `sortableAttributes`), and `boards.matters.bind` **hard-fails** on an unresolvable
   stub matter instead of degrading. Still uncovered: LitBox Files panel, the cross-firm (CFCS)
   panel, and the Slack/Teams connectors — the next specs to grow under `tests/e2e/matterchat/`.
2. `workflow_dispatch` for **E2E Gate** / **Staging Smoke** becomes visible in the Actions UI
   once the workflow files reach the repo's default branch (`develop`); the PR-trigger and the
   deploy-chained smoke work from `staging` alone.
3. The full `mit-core` tier has never been executed end-to-end on our fork; expect a handful
   of legitimately-broken specs on first run (our redesigns changed login/chrome markup).
