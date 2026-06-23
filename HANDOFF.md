# HANDOFF.md — current state (read after CLAUDE.md)
> Live state for resuming. **The "checkpoint matterchat" command updates this before a session ends.** Standing rules + the two session commands are in `CLAUDE.md`; decisions + their reasoning in `DECISIONS.md`; full onboarding in `MATTERCHAT-ONBOARDING.md`; feature inventory in `docs/current-status.md`.

**Last updated:** 2026-06-22 · **Branch:** `feature/matterchat-cross-firm`

## The repos
- **`~/MatterChat`** ← here. The product + these resume docs. (Only repo touched this session.)
- **`~/matterchat-mcp-v2`** — CHI tool server (23 MCP tools over `boards.*`).
- **`~/omnis-counsel`** — cross‑firm CFCS service + customer KB + demo scripts.

## Running services (local dev)
| Port | What | Notes |
|---|---|---|
| 27018 | MongoDB (rs0) | DB `matterchat_apex` (sign in as **alex**, a regular user) |
| 3100 | **Dev server (HMR)** | `/tmp/mc-dev.sh` (ROOT_URL :3100, OmnisAI sign‑in). Browseable app + fast loop. |
| 9100 / 9200 | Mock OIDC / CFCS | `~/omnis-counsel/mc-mock-oidc.js` / `server.js` |

Dev loop: self‑heal wrapper `while true; do bash /tmp/mc-dev.sh; done`, OR the **preview tool** (`.claude/launch.json` `matterchat`→`/tmp/mc-dev.sh` port 3100; `preview_start` owns it + gives a browser to screenshot). The preview-managed server has **no self‑heal** and dies on the dev‑proxy abort bug — re-`preview_start` to recover. Board route = `/boards/board/:id/:view?`. Boards API harness: `MC_BASE=http://localhost:3100/api/v1 MC_USER_ID=<id> MC_AUTH_TOKEN=<token> node scripts/boards-api-test.mjs` (token from browser `localStorage`, never commit it).

## Built + verified this session (committed on `feature/matterchat-cross-firm`, PR #6)
**Boards UI for the new server features — 58/58 harness + eyeballed in the browser:** card **label chips + manager**, card **checklist panel** (add/toggle/remove + progress), **drag‑to‑reorder lists** (mirrors card DnD; header handle), and the **iCal "Subscribe in your calendar"** flow — incl. a **public tokenized feed URL** (`boards.cards.ical.public?token=`, authRequired:false) + the Subscribe modal (i18n fixed to inline defaultValues).

**LitBox integration — FOUNDATION done, not yet loading files:** embeds the official `@omnisaiorg/litbox-file-browser` React component (GitHub Packages, v0.1.77).
- ✅ **Component bundles + mounts + renders its full UI in Meteor** (verified in browser — My Folders/Files, Upload, Create Folder, grid). Lazy-loaded (`client/views/litbox/LitboxEmbed.tsx`) so it stays out of the main bundle.
- ✅ **`/litbox` route** (`client/views/litbox/`, registered via `createRouteGroup('litbox',…)` + `main.ts`) and a **"Files" item in the LEFT RAIL** (`client/views/root/MainLayout/AppLeftRail.tsx`) rendered with the **LitBox wordmark** (recolored 'Lit' white for the dark rail).
- ✅ **GitHub Packages wiring** — `.yarnrc.yml` `npmScopes.omnisaiorg` (registry npm.pkg.github.com, auth `${NPM_TOKEN-}`). **Install needs `NPM_TOKEN` = a GitHub token with `read:packages` on @omnisaiorg.**
- ✅ **Server auth proxy built + hardened** — `apps/meteor/app/omnisai-oauth/server/litboxProxy.ts`, mounted at **`/_litbox`** (NOT `/api/...` — Rocket.Chat owns that namespace and 404s it). The OIDC callback (`index.ts`) captures the CentralizedAuth credential; `loginHandler.ts` persists it on a **top-level `omnisaiLitbox` user field (NOT `services.*` — `getFullUserData` projects `services` wholesale to self, so it would leak)**. The proxy resolves the MatterChat user from the loginToken, injects the credential, forwards `/_litbox/v1/* → ${LITBOX_API_URL}/api/v1/*`. Hardened per red-team: Authorization-header-only, path-traversal/protocol-relative rejection, origin-pin + resource-prefix + method allow-lists (credential attached only after all gates pass), redirect:manual, Cookie/Origin dropped. **Route registration verified locally (503 until `LITBOX_API_URL` set).**

## ⚠️ Next safe task — verify LitBox file-loading on a REAL env (cannot be done on local mock)
The proxy is built; what's left is verifying it loads real files, which the local dev **cannot** do: local MatterChat logs in via a **mock OIDC** (`:9100`) whose tokens the real staging LitBox/CentralizedAuth reject. So:
1. **Set `LITBOX_API_URL`** (the LitBox backend base, e.g. `https://litbox-app.stg-omnisai.io`) in the run env / RUNBOOK. Until set the proxy returns 503.
2. **Deploy to alpha** (or point local at the REAL CentralizedAuth OIDC + use a real LitBox account) and open Files. Confirm the grid loads the user's files.
3. **Probe the credential-type gate:** the proxy forwards the OIDC `access_token` as the LitBox bearer (Option A — the callback already calls CentralizedAuth's `mcp/get-session` with `Bearer ${access_token}` successfully). If real LitBox 401s, switch to capturing the better-auth `set-cookie` session value instead (Option B). **Verify against real staging — local cannot.**
4. **Remaining proxy follow-ups** (deferred, all need real env): refresh-on-401 via the `refresh_token` grant; a regression test asserting `users.info`/`me` never return `omnisaiLitbox` (defense for the leak fix); encrypt the token at rest; and confirm MatterChat users carry the same `centralized_user_id` (`services.omnisai.id == sub`) so LitBox's JIT match-by-id wins over the email-rebind footgun.
(Full research + design + red-team output: the `litbox-auth-design` workflow result under the session's tasks/ dir.)

## In‑flight gotchas
- **`packages/rest-typings`/`core-typings` edits:** rebuild dist (`yarn turbo run build --filter=…`) **then bounce** the dev server — the watcher misses a one‑off dist rebuild (new ajv fields stripped, enum bypassed). App code under `apps/meteor/**` recompiles itself (no dist rebuild).
- **Meteor dev proxy crashes on aborted connections** (`ERR_STREAM_WRITE_AFTER_END`) — don't poll with short‑`--max-time` curls; verify via log/harness. The LitBox `/litbox` screen is stable (component skeleton-loads gracefully) — earlier crashes were the proxy bug, not the component.
- **GitHub Packages:** installing `@omnisaiorg/*` needs `NPM_TOKEN` with `read:packages`; `gh auth refresh -s read:packages` grants it on the existing login.
