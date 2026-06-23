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
- ❌ **Server proxy + auth — the last piece** (the file grid skeleton-loads until this exists).

## ⚠️ Next safe task — the LitBox auth proxy (the file grid won't load real files without it)
Plan: the component calls MatterChat's own origin at **`/api/litbox/v1/*`** (a Meteor server proxy that forwards to `https://litbox-app.stg-omnisai.io/api/v1/*`), injecting the user's LitBox credential server-side. A server proxy **bypasses LitBox CORS** (no LitBox-side allowlist change needed) and keeps the credential off the client.
**THE CRUX — verified by reading Litbox-backend this session:** LitBox does **NOT** use KeyGate / OIDC access tokens. Its API accepts only (a) its **own** API key `litbox_<random>` via the `X-API-Key` header, or (b) on `Authorization: Bearer <X>`, a **CentralizedAuth better-auth SESSION token** (it stuffs X into the `better-auth.session_token` cookie and POSTs to `{CENTRALIZED_AUTH_URL}/auth/session`; valid session → JIT-creates the user/org). It rejects an **OIDC access_token**. So the OPEN problem: **MatterChat's OmnisAI OIDC login only holds an OIDC access_token, not a better-auth session token.** The proxy phase must resolve this — options to evaluate next session: (1) have MatterChat obtain/forward the user's CentralizedAuth better-auth session token; (2) provision a per-user `litbox_` API key from MatterChat's server. (Full research + the design/red-team output: workflow result saved under the session's tasks/ dir.)

## In‑flight gotchas
- **`packages/rest-typings`/`core-typings` edits:** rebuild dist (`yarn turbo run build --filter=…`) **then bounce** the dev server — the watcher misses a one‑off dist rebuild (new ajv fields stripped, enum bypassed). App code under `apps/meteor/**` recompiles itself (no dist rebuild).
- **Meteor dev proxy crashes on aborted connections** (`ERR_STREAM_WRITE_AFTER_END`) — don't poll with short‑`--max-time` curls; verify via log/harness. The LitBox `/litbox` screen is stable (component skeleton-loads gracefully) — earlier crashes were the proxy bug, not the component.
- **GitHub Packages:** installing `@omnisaiorg/*` needs `NPM_TOKEN` with `read:packages`; `gh auth refresh -s read:packages` grants it on the existing login.
