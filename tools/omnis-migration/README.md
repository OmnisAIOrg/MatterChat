# Omnis migration / verification tooling (dev only)

Helper scripts + fixtures produced while building the MatterChat ↔ OmnisAI integration
(2026-06-19/20). **Not product code** — these are local dev/verification helpers preserved here
so they survive across machines/sessions. They assume a local MatterChat prod bundle on
`http://localhost:3100`, MongoDB replica set `rs0` on `:27018`, and (for OIDC) a mock or real
CentralizedAuth. Paths inside some scripts are machine-specific (`/Users/davidnguyen/...`); adjust
as needed. This branch (`dev/omnis-migration-tooling`) is **not intended to merge** to `develop`.

## What ships where (the real work)
- **PR #2** (`feature/matterchat-omnisai-oidc` → develop): "Sign in with OmnisAI" OIDC SSO keystone
  (PKCE, `sub` → `services.omnisai.id` = CasePro `users.id`), branded "Import from Slack" admin
  entry, and `apps/meteor/app/omnisai-oauth/server/RUNBOOK-wire-to-real-centralizedauth.md`.
  **Live-verified against real staging CentralizedAuth.**
- **PR #3** (`feature/matterchat-channel-matter-link` → develop): bind a chat channel to a Matter
  card (both-way link + unlink + "Matters" sidebar folder).
- **AlphaEnvironment PR #13**: onboards MatterChat to per-PR Alpha previews (Meteor compose template
  + dedicated Mongo replica set).

## Scripts
| File | Purpose |
|---|---|
| `mc-mock-oidc.js` | Mock CentralizedAuth OIDC server (:9100) — mirrors better-auth `mcp` OAuth (authorize/token/userinfo + DCR) **and** `/organizations/invite-multiple` + a CasePro `users/webhook/sync` receiver. Lets you exercise login + provisioning fully offline. `node mc-mock-oidc.js` (env: MOCK_SUB/MOCK_EMAIL/... to switch the simulated user). |
| `mc-verify-login.js` | Drives the OIDC chain → DDP `login` → asserts a session is issued (user logged in). |
| `mc-run-slack-import.js` | Headlessly drives Rocket.Chat's built-in Slack importer (uploadImportFile → prepare → startImport → poll) using `fixtures/slack-export.zip`. |
| `mc-provision-from-slack.js` | Bulk-provision Slack members into CentralizedAuth via `/organizations/invite-multiple` (→ auto-syncs to CasePro). Env: AUTH_BASE, ORG_ID, ROLE_ID, AUTH_ADMIN_TOKEN, SLACK_USERS_JSON. |
| `mc-verify-channel-link.js` / `mc-verify-cl-full.js` / `mc-verify-link-state.js` | Verify the channel↔matter link (create → unlink → reuse; both-way binding) over the REST API. |
| `mc-debug-matters.js` | Inspect the matters board / `listMatters` raw responses. |
| `mc-install-toolchain.sh` | Reproduces the build environment (nvm Node 22.22.3, Yarn 4, Deno, Meteor 3.4.1, MongoDB) on macOS/Homebrew. |

## Fixtures
- `fixtures/slack-export/` + `fixtures/slack-export.zip` — a **synthetic** Slack export (2 users,
  1 channel "case-smith-v-jones", 2 messages). No real PII. Feeds the import/provision scripts.

## Stack quick-start (the local run loop)
See the memory note `matterchat-slack-migration` (RESUME RUNBOOK) for exact commands:
mongod `--replSet rs0 --port 27018` → `node mc-mock-oidc.js` → MatterChat prod bundle on `:3100`
with the `OMNISAI_OIDC_*` env. Alpha deploy: `MATTERCHAT-ALPHA-DEPLOY-RUNBOOK.md`.
