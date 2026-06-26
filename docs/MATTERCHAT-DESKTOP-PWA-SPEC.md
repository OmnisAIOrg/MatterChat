# MatterChat — Desktop App + PWA Spec (build-ready)

Status: Proposed · Owner: Phillip · Date: 2026-06-25 · Branch: `auto/desktop-pwa-spec`

This spec covers shipping MatterChat as **(A)** a downloadable desktop app and **(B)** an installable PWA. It is grounded in the actual fork (`apps/meteor`, a Rocket.Chat fork pinned at MIT core) and the existing OmnisAI integrations already in this repo:

- **OmnisAI SSO** is implemented server-side: `apps/meteor/app/omnisai-oauth/server/index.ts` mounts `GET /_omnisai/authorize` → CentralizedAuth `/api/auth/mcp/authorize` (PKCE) → `GET /_omnisai/callback` → redirect to `omnisai/<credentialToken>` which the client logs in with. Redirect URI is `Meteor.absoluteUrl('_omnisai/callback')`.
- **Connector OAuth** (Slack/Teams/Google) is being built under `apps/meteor/app/external-workspaces/server` with routes like `/_teams/authorize` + `/_teams/callback`, per-user token encryption via the `litboxCrypto` AES-256-GCM helper (`enc:v1:<iv>:<authTag>:<ciphertext>`) keyed by a new env `EXTERNAL_TOKEN_ENC_KEY`. See `MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md`.
- **PWA artifacts already exist but are stock/incomplete**: `apps/meteor/public/images/manifest.json` (name rebranded to "MatterChat", but only 192/512 icons, no maskable/theme/shortcuts) and `apps/meteor/client/serviceWorker.ts` (registers RC's `/enc.js` — that SW exists for **encrypted file downloads**, NOT app-shell caching).
- **Push today is gateway-only**: `apps/meteor/app/push/server/{push,fcm,apn}.ts` send via the FCM/APN gateway. There is **no browser Web Push** path. This is the single biggest PWA gap.

Hosts:
- Staging: `https://matterchat.stg-omnisai.io` (EKS, deploy on push to `staging`).
- Prod: TBD — assume `https://matterchat.omnisai.io` (reserve the host now; every redirect-URI list below registers both).

---

# A. Desktop app

## A.1 Chosen approach — **lightweight Electron wrapper, matched to LitBox Desktop** (DECISION)

**Decision: build a thin Electron wrapper that loads the hosted MatterChat web app, structured exactly like `OmnisAIOrg/Litbox-Desktop`. Do NOT fork `RocketChat/Rocket.Chat.Electron`.**

| Option | Verdict | Why |
|---|---|---|
| **Fork Rocket.Chat.Electron** | ❌ Reject | It is a heavy multi-server client (server list, RC-specific deep links, jitsi, screen-share IPC, its own update channel, RC branding everywhere). We'd inherit a large surface we must re-brand and maintain, fight its multi-server model when we want single-workspace, and keep merging upstream RC. High maintenance, low fit. |
| **Tauri** | ❌ Reject | Rust toolchain + WebView2/WKWebView quirks + a *different* deep-link/protocol story than we already operate. No existing OmnisAI precedent. Switching tech for one app costs more than it saves. |
| **Lightweight Electron wrapper (match LitBox)** | ✅ **Choose** | We already run this exact pattern in production-adjacent form (LitBox Desktop: Electron + `electron-builder` + `electron-updater` + GitHub Releases feed + Azure signing scaffold + macOS/Windows CI). We reuse the toolchain, the signing playbook, the release-repo model, and the team's muscle memory. The MatterChat web app is already a full SPA — the wrapper just hosts it and adds native glue. |

This is the **"match LitBox"** answer the brief asks for: same stack, same packaging, same release/signing infra, new product.

**New repo: `OmnisAIOrg/MatterChat-Desktop`** (private, source) + **`OmnisAIOrg/MatterChat-Desktop-releases`** (public, installers + auto-update feed). Mirrors the LitBox two-repo split.

Stack (copy LitBox's exact versions to avoid re-litigating):
- Electron (patched runtime, same major LitBox ships — 42.x), **plain CommonJS, no native modules**.
- `electron-builder` (packaging) + `electron-updater` (auto-update).
- `contextIsolation: on`, `nodeIntegration: off`, `sandbox: on`; all native capability via `preload.js` `contextBridge`.
- Tests: `node:test`. CI: GitHub Actions on macOS + Windows runners (add Linux runner for AppImage/deb).

## A.2 Architecture

**Main process (`src/main/main.js`)**
- Creates one `BrowserWindow` pointing at the configured server URL.
- Persistent session partition `persist:matterchat` (so the RC login/Meteor login token survives restarts; mirrors LitBox's `persist:litbox`).
- Owns: tray, app menu, deep-link/custom-protocol registration, badge/unread, IPC, auto-update wiring.
- `config.js` (Electron `userData/config.json`): `serverUrl`, `channel` (stable/beta), `launchAtLogin`, `minimizeToTray`, `spellcheckLangs`, `lastWindowBounds`.

**Renderer = the hosted web app (no local bundle).** The window loads `https://matterchat.stg-omnisai.io` (or prod). We do **not** bundle the SPA into the app — this keeps the desktop app a thin shell that auto-tracks server deploys, and means the PWA/web/desktop are byte-identical UI.

**Single-workspace, not a server picker (DECISION).** MatterChat is one product on one (staging/prod) server, unlike RC's "connect to any RC server." Ship a single hardcoded default (`serverUrl` = prod). Expose an **Advanced → Server URL** field (defaults hidden) purely so internal/QA users can point at staging or a PR preview. No multi-server rail, no add-server UI. This is strictly simpler than Rocket.Chat.Electron and is why forking it is wasteful.

**Preload bridge surface (`window.matterchatDesktop`)**: `setBadgeCount(n)`, `flashFrame()`, `getDesktopInfo()` (so the web app can detect it runs in desktop and adjust, e.g. hide "Install app" CTA), `openExternal(url)`, `onDeepLink(cb)`. The web app feature-detects this object; everything degrades to plain web when absent.

## A.3 Native features

| Feature | Implementation |
|---|---|
| **Desktop notifications** | The web app already calls the Web Notifications API. In Electron these render as native OS notifications automatically. No code needed beyond ensuring `Notification` permission is auto-granted in the desktop session (it is, for the app's own origin). |
| **Badge / unread count** | Web app computes total unread; push it over IPC `setBadgeCount(n)`. macOS: `app.dock.setBadge(String(n))`. Windows: `win.setOverlayIcon(...)` (numbered overlay) + taskbar. Linux: `app.setBadgeCount(n)` (Unity/where supported). Clear on `n===0`. |
| **System tray** | `Tray` with `trayTemplate.png` (reuse LitBox's tray asset pattern). Menu: Open MatterChat · Unread: N · Toggle Do Not Disturb · Quit. Close-to-tray when `minimizeToTray` on (default on Windows/Linux, off on macOS where Cmd-W just hides). |
| **Deep links** | Register custom protocol `matterchat://` (see A.4) + handle HTTPS deep links by forwarding in-window. `app.setAsDefaultProtocolClient('matterchat')`. `second-instance`/`open-url` events route the URL into the renderer via `onDeepLink`. |
| **Spellcheck** | Built into Electron (`session.setSpellCheckerLanguages([...])`) + context-menu "Add to dictionary" / suggestions via `context-menu` event using `params.dictionarySuggestions`. Languages from `config.spellcheckLangs` (default OS locale). |
| **Screen-share** | RC core ships screen-share (getDisplayMedia). Electron ≥ needs a `setDisplayMediaRequestHandler` (or `desktopCapturer`) to present a source picker. Add a minimal picker window listing `desktopCapturer.getSources({types:['screen','window']})` and return the chosen source. This is the one place we add real native code RC.Electron has — small and self-contained. |
| **Focus / flash** | On a mention/DM while unfocused: `win.flashFrame(true)` (Windows/Linux taskbar flash) + `app.dock.bounce('informational')` (macOS). Triggered from the same IPC that sets the badge. |

## A.4 Connector OAuth in desktop — the critical bit (DECISION)

**Problem:** Microsoft (Entra) and Google **block OAuth in embedded webviews** (Google: `disallowed_useragent`; Microsoft: embedded-webview blocking + policy). An Electron `BrowserWindow` is an embedded webview. So the Slack/Teams/Google connector flows — and OmnisAI SSO — **must not** run inside the app window.

**Decision: open the system browser for every OAuth, and return to the app via the `matterchat://` custom protocol.** This is the same model LitBox Desktop / standard Electron OAuth uses, and it requires **server changes that are additive and browser-compatible** (the server can return to either an HTTPS page or our custom scheme based on a `client=desktop` param).

### Flow (applies to connectors AND OmnisAI SSO)

```
[Desktop app]  user clicks "Connect Microsoft Teams"
      │  shell.openExternal( https://matterchat.../_teams/authorize?client=desktop )
      ▼
[System browser]  → /_teams/authorize mints state, redirects to Microsoft /authorize
                  → user consents in the REAL browser (Edge/Chrome/Safari) — not blocked
                  → Microsoft → https://matterchat.../_teams/callback?code=...
[MatterChat server]  /_teams/callback exchanges code, encrypts+stores token
                     (EXTERNAL_TOKEN_ENC_KEY), then because state was minted with
                     client=desktop it issues a final redirect to:
                        matterchat://oauth/teams?status=ok
      ▼
[OS]  hands matterchat:// URL to the running desktop app (open-url / second-instance)
      ▼
[Desktop app]  onDeepLink → focus window → tell renderer to refresh the workspace rail
```

**Server change required (small):** in `external-workspaces/server` the callback handlers must read the desktop flag (carried through `state`, not a raw query param, to keep it tamper-proof) and, when set, finish with a `302` to `matterchat://oauth/<provider>?status=ok|error&reason=...` instead of an HTTPS page. A tiny HTML interstitial page ("Return to MatterChat") is served as a fallback in case the OS doesn't auto-hand-off (covers the no-handler edge). **No token ever transits the custom-scheme URL** — only a status; the encrypted token stays server-side on the connection record, exactly as in the connector spec.

**Loopback alternative (documented, not chosen):** instead of `matterchat://`, the app can spin an ephemeral `http://127.0.0.1:<port>/cb` loopback listener and pass that as the final redirect. Custom-scheme is chosen because (a) we already issue server-side redirects we control, (b) no firewall/port issues, (c) cleaner UX (no localhost tab). Keep loopback as the fallback if a corporate browser strips custom schemes.

### Exact redirect-URI / config additions per provider

These are **app-registration** changes (additive — existing web URIs stay). The custom scheme is handled by **our server's** final redirect, so providers only ever see HTTPS callbacks; the only thing they need is that those HTTPS callbacks already exist. The `matterchat://` registration is OS-level, not provider-level.

| Provider | Where | Add |
|---|---|---|
| **Microsoft Entra (Teams)** app reg `099f4168…`, tenant `600ceefb…` | Authentication → Web platform redirect URIs | `https://matterchat.stg-omnisai.io/_teams/callback` and `https://matterchat.omnisai.io/_teams/callback` (already required for web — confirm both present). **No SPA/Mobile platform needed** because the browser-visible callback is HTTPS. (Only add a "Mobile and desktop applications" platform with `matterchat://oauth/teams` **if** we later switch to a native-PKCE flow where Microsoft itself redirects to the scheme — not the current design.) |
| **Slack** (founder-owned app) | OAuth & Permissions → Redirect URLs | `https://matterchat.stg-omnisai.io/_slack/oauth/callback` + prod. Slack only allows HTTPS redirect URLs — our server-side hand-off to `matterchat://` is therefore mandatory (Slack can't redirect to a custom scheme). |
| **Google (Workspace/Chat)** | Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs | `https://matterchat.stg-omnisai.io/_google/oauth/callback` + prod. Google forbids custom schemes for "Web application" client type and blocks embedded webviews — system-browser + HTTPS callback + server hand-off is the only compliant path. |
| **OS-level (all platforms)** | App packaging | Register `matterchat://` as default protocol client: macOS `Info.plist` `CFBundleURLTypes` (via electron-builder `protocols`), Windows registry (electron-builder `protocols` writes it), Linux `.desktop` `MimeType=x-scheme-handler/matterchat`. |

## A.5 OmnisAI SSO ("Sign in with OmnisAI") in desktop

Same system-browser rule (CentralizedAuth consent must not run in an embedded webview). The server flow already exists end-to-end:

1. Desktop "Sign in with OmnisAI" → `shell.openExternal(https://matterchat.../_omnisai/authorize?client=desktop)`.
2. System browser does the PKCE dance with CentralizedAuth `/api/auth/mcp/authorize`, returns to `/_omnisai/callback`.
3. `index.ts` currently redirects to `Meteor.absoluteUrl('omnisai/<credentialToken>')`. **Add a desktop branch:** when `state` carries `client=desktop`, redirect instead to `matterchat://login?token=<credentialToken>`.
4. Desktop `onDeepLink` receives it, loads `https://matterchat.../omnisai/<credentialToken>` **inside the app window** (the credentialToken is single-use and short-lived — RC's standard OAuth credential-token mechanism — so it's safe to carry it on the scheme back into our own app, unlike a long-lived access token).
5. Renderer completes `Meteor.loginWithToken`-equivalent; session persists in `persist:matterchat`.

CentralizedAuth redirect-URI addition: `https://matterchat.stg-omnisai.io/_omnisai/callback` + prod must be on the MatterChat OIDC client (already required for web). No change to CentralizedAuth needed for desktop — the scheme hop happens entirely on the MatterChat server's final redirect.

## A.6 Build / sign / distribute

**macOS**
- Output: `.dmg` (+ `.zip` for auto-update). Universal binary (`x64`+`arm64`) or arm64-first.
- Sign: **Apple Developer ID Application** cert → `electron-builder` `mac.identity`. **Notarize** via `notarytool` (Apple ID app-specific password or API key in CI secrets `APPLE_API_KEY/KEY_ID/ISSUER`). Hardened runtime + entitlements (`com.apple.security.network.client`, mic/camera for screen-share, `allow-jit` for Electron). Staple the ticket.

**Windows**
- Output: NSIS `.exe` (per-user install, no admin) + `.appx`? No — NSIS only (matches LitBox).
- Sign: code-signing cert. Reuse LitBox's **Azure Trusted Signing** scaffold (vars `AZURE_CODE_SIGNING_ENDPOINT/ACCOUNT`, `AZURE_CERT_PROFILE`; secrets `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET`) — same SIGNING.md playbook. Until signing is on, expect SmartScreen warnings (acceptable for internal beta only).

**Linux**
- Output: `AppImage` (primary) + `.deb`. No signing standard; ship as-is.

**Auto-update**
- `electron-updater` against the **public `MatterChat-Desktop-releases`** repo (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`). Installed apps poll ~every 6h (LitBox cadence). Differential downloads on Windows/macOS.

**Release channels**
- `stable` (default) and `beta` (electron-updater `channel`). `beta` points the same updater at pre-release GitHub Releases. Channel selectable in Advanced.

**Download / landing page**
- A simple page at `https://matterchat.omnisai.io/download` (and link from in-app About) with OS auto-detect → correct installer, plus "All downloads" → the public releases repo Releases page (`https://github.com/OmnisAIOrg/MatterChat-Desktop-releases/releases`). Mirrors LitBox's download-page model.

**Ship a release:** bump `package.json` version → `git tag vX.Y.Z && git push origin vX.Y.Z` → CI: tests → build Win/Mac/Linux → publish GitHub Release → feed updates.

## A.7 Effort + milestones (desktop)

Total: **~2–3 weeks** for stable v1 (the wrapper itself is days; signing/notarization + OAuth hand-off + QA are the cost). Reuse of LitBox infra removes ~1 week.

| Milestone | Scope | Est |
|---|---|---|
| **D0 Scaffold** | New repo from LitBox skeleton; window loads staging; persist session; tray; basic menu. | 2 d |
| **D1 Native glue** | Badge/unread IPC, flash/bounce, desktop notifications verified, spellcheck, screen-share picker. | 2–3 d |
| **D2 Protocol + OAuth** | Register `matterchat://`; server `client=desktop` branch for `/_omnisai/callback` + connector callbacks; SSO + Slack/Teams/Google connect work end-to-end from desktop. | 3–4 d |
| **D3 Build/sign** | macOS Developer ID + notarization green; Windows Azure signing; Linux AppImage/deb; auto-update feed live; beta channel. | 3–4 d |
| **D4 Distribute** | Public releases repo; download page; About box; first v0.1.0 tag; internal QA pass. | 2 d |

---

# B. PWA

## B.1 manifest.json (DECISION — replace the stock file)

Current `apps/meteor/public/images/manifest.json` is stock RC (no maskable icon, no theme color, no shortcuts). Replace with the below and add the new icon assets. Note the manifest is served and linked from the app's `<head>` (RC injects it); keep the same served path or update the `<link rel="manifest">`.

```json
{
  "name": "MatterChat",
  "short_name": "MatterChat",
  "description": "Secure legal team messaging by OmnisAI.",
  "id": "/?source=pwa",
  "start_url": "/home?homescreen=1",
  "scope": "/",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone"],
  "orientation": "any",
  "background_color": "#0b1220",
  "theme_color": "#0b1220",
  "lang": "en-US",
  "categories": ["business", "productivity"],
  "icons": [
    { "src": "/assets/pwa/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/assets/pwa/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/assets/pwa/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/assets/pwa/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Chats", "short_name": "Chats", "url": "/home?tab=chats", "icons": [{ "src": "/assets/pwa/sc-chats-96.png", "sizes": "96x96", "type": "image/png" }] },
    { "name": "Boards", "short_name": "Boards", "url": "/boards", "icons": [{ "src": "/assets/pwa/sc-boards-96.png", "sizes": "96x96", "type": "image/png" }] }
  ]
}
```

Decisions baked in: `theme_color`/`background_color` set to MatterChat's dark navy (replace `#fff`); **maskable** icons added (Android adaptive); **shortcuts** for Chats + Boards as the brief requires; `display_override` adds window-controls-overlay for a more app-like desktop-PWA title bar; stable `id` so the install identity is fixed across `start_url` changes.

## B.2 Service worker strategy (DECISION — extend, add a second SW, don't fight `enc.js`)

RC's existing SW (`/enc.js`, registered by `client/serviceWorker.ts`) exists for **encrypted file downloads** — it is NOT an app-shell/offline SW and must keep working. **Decision: do NOT repurpose `enc.js`.** Instead:

- Keep `enc.js` doing exactly what it does today (file decryption stream).
- It already claims `scope: '/'`. Two SWs can't both control the same scope. **So we extend `enc.js` itself** with a small app-shell layer rather than registering a competing SW — add a `fetch` handler branch: file-decrypt requests keep current behavior; navigation requests + static assets get the cache strategy below. (Wrapping the existing SW is lower-risk than scope-juggling.)

Cache strategy (in the extended SW):
- **App shell** (the SPA's HTML entry, JS/CSS bundles, fonts, manifest, icons): **stale-while-revalidate** keyed by build hash. Meteor bundles are content-hashed, so cache-bust is automatic on deploy.
- **API / DDP / realtime** (`/api/**`, websocket): **never cache** — network only (chat must be live).
- **Avatars / uploaded media**: cache-first with size cap + LRU eviction.
- **Offline state**: a minimal `offline.html` served for navigations when the network is down ("MatterChat is offline — reconnecting…"); the live UI itself already shows a reconnecting banner once loaded.

**Update / refresh prompt:** on `updatefound` → new SW `installed` while one is controlling, post a message to the page; the web app shows a non-blocking toast **"New version available — Reload"** (replaces RC's current auto-reload-within-10s hack in `serviceWorker.ts`, which is jarring). User-driven reload avoids interrupting an in-progress message.

## B.3 Installability

- Listen for `beforeinstallprompt`, `preventDefault()`, stash the event.
- Add an **in-app "Install MatterChat"** affordance: a menu item (Admin/user menu) + a one-time dismissible banner shown only when (a) the deferred prompt exists, (b) not already installed (`matchMedia('(display-mode: standalone)')` false), and (c) **not running in the desktop app** (feature-detect `window.matterchatDesktop` from A.2 and suppress — don't tell desktop users to install a PWA).
- Clicking → `deferredPrompt.prompt()`; record `appinstalled`.
- iOS/Safari has no `beforeinstallprompt`: show an iOS-specific "Add to Home Screen" hint (Share → Add to Home Screen) when on iOS Safari and not standalone.

## B.4 Push notifications (DECISION — add Web Push/VAPID; RC gateway doesn't cover browsers)

**Gap (confirmed in code):** `app/push/server/{push,fcm,apn}.ts` push only to **native** FCM/APN tokens via the RC gateway. A browser/PWA has **no** FCM/APN device token, so today an installed PWA gets **zero** background push. Foreground in-tab notifications work (Web Notifications API while the tab is open); background does not.

**Decision: add a first-party Web Push (VAPID) path alongside the gateway.**

Wiring:
1. Generate a VAPID keypair; server env `WEB_PUSH_VAPID_PUBLIC` / `WEB_PUSH_VAPID_PRIVATE` (+ `WEB_PUSH_SUBJECT=mailto:…`).
2. Client: after notification permission granted, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public> })`; POST the subscription to a new endpoint `POST /api/v1/webpush.subscribe` storing `{userId, endpoint, keys}` (one user → many subscriptions).
3. Server: extend the push dispatch so that, for a target user, we send to native tokens via the gateway **and** to Web Push subscriptions via the `web-push` library (signed with VAPID). De-dupe so a user isn't double-notified across an open tab.
4. SW: add a `push` event handler → `self.registration.showNotification(title, {body, icon, badge, data:{url}})` and a `notificationclick` handler → focus existing client or open `data.url`. (This lives in the same extended `enc.js`/app-shell SW.)
5. Prune `410 Gone` subscriptions on send.

**iOS caveat (call it out):** Web Push on iOS works **only iOS 16.4+ and only for a PWA installed to the Home Screen** (not Safari tabs). The install affordance (B.3) is therefore a prerequisite for iOS notifications. Document this in the in-app permission prompt copy ("On iPhone, add MatterChat to your Home Screen to receive notifications"). Android/desktop Chrome/Edge/Firefox get Web Push without install.

## B.5 Branding assets checklist + location

Create directory **`apps/meteor/public/assets/pwa/`** and populate (source from the MatterChat logo / component-library brand tokens):

| Asset | Size(s) | Purpose |
|---|---|---|
| `icon-192.png`, `icon-512.png` | 192, 512 | Standard PWA icons (`purpose: any`). |
| `icon-maskable-192.png`, `icon-maskable-512.png` | 192, 512 | Android adaptive (safe-zone padded, `purpose: maskable`). |
| `apple-touch-icon.png` | 180×180 | iOS home-screen icon (`<link rel="apple-touch-icon">`). |
| `favicon.ico` + `favicon-32.png` + `favicon-16.png` | 16/32 + ico | Browser tab. (RC already ships favicons under `public/assets/` — overwrite with MatterChat brand.) |
| `sc-chats-96.png`, `sc-boards-96.png` | 96×96 | Manifest shortcut icons. |
| `apple-splash-*.png` | per-device | iOS launch screens via `<link rel="apple-touch-startup-image" media=…>` (generate the standard set; optional but improves the installed feel). |
| `<head>` meta | — | `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=MatterChat`, `theme-color=#0b1220`. |

Verify there are no leftover Rocket.Chat marks: replace `public/assets/favicon*` and any `manifest`-referenced art.

## B.6 Effort + milestones (PWA)

Total: **~1–1.5 weeks**. Manifest/branding is hours; the SW extension + Web Push server path is the real work.

| Milestone | Scope | Est |
|---|---|---|
| **P0 Manifest + branding** | New `manifest.json`, all icons/maskable/splash/favicons under `public/assets/pwa/`, head meta, Lighthouse PWA pass. | 1–2 d |
| **P1 SW app-shell** | Extend `enc.js` with app-shell SWR caching + offline page + update-toast (replace auto-reload). | 2 d |
| **P2 Install UX** | `beforeinstallprompt` capture + in-app "Install MatterChat" + iOS A2HS hint; suppress in desktop. | 1 d |
| **P3 Web Push** | VAPID keys, `webpush.subscribe` endpoint + storage, dispatch alongside gateway, SW `push`/`notificationclick`, iOS-16.4 gating. | 2–3 d |

---

# C. Shared

## C.1 Which first + why

**Do the PWA first.** Rationale: (1) it ships entirely inside this repo (no new repo, no app-store/notarization gauntlet) and rides the existing `staging` deploy; (2) it immediately improves mobile (iOS/Android home-screen) and gives background notifications, the biggest user-visible gap; (3) the **system-browser OAuth insight is web-native already** — the PWA needs no OAuth changes at all (it runs in a real browser), so it de-risks the harder desktop OAuth hand-off by proving the web flows end-to-end first. Desktop second, reusing LitBox infra.

## C.2 What's reusable between desktop + PWA

- **The hosted web app is the single renderer** for both — desktop loads the same URL the PWA installs. One UI, three delivery channels (web/PWA/desktop). Fix once, fixed everywhere.
- **Notifications copy + permission UX** shared.
- **Icons/brand art**: the 512/maskable PNGs feed both the PWA manifest and (downscaled to `.icns`/`.ico`) the desktop installer.
- **Feature-detection contract** (`window.matterchatDesktop`): lets the same web code suppress the PWA install banner inside desktop and route OAuth to system-browser inside desktop.
- **The server-side `client=desktop` redirect branch** is the *only* desktop-specific server change; the PWA reuses the unmodified web OAuth.

## C.3 Security — token storage

| Channel | Token at rest | Note |
|---|---|---|
| **PWA / web** | Browser-managed (RC's `Meteor.loginToken` in `localStorage`, session cookies). | Standard web; same threat model as today's web app. No change. |
| **Desktop** | Persisted in the Electron **`persist:matterchat`** session partition (cookies/localStorage in the encrypted app profile), exactly like LitBox stores its session cookie. **Do not** invent a second token store. If we ever cache a raw secret outside the session, use the **OS keychain** via `safeStorage.encryptString` (macOS Keychain / Windows DPAPI / libsecret) — never plaintext on disk. The OAuth hand-off (A.4/A.5) is designed so **no long-lived token ever crosses the `matterchat://` URL** (only single-use credential tokens / status), keeping secrets server-side. |

## C.4 EXTERNAL_TOKEN_ENC_KEY note (connectors)

Connector access/refresh tokens (Slack/Teams/Google) are **never the desktop's or browser's problem** — they live **server-side**, encrypted at rest on the connection record with `EXTERNAL_TOKEN_ENC_KEY` (32-byte base64), via the `tokenCrypto.ts` generalization of `litboxCrypto.ts` (AES-256-GCM, `enc:v1:<iv>:<authTag>:<ciphertext>`, fail-closed decrypt, no-op without the key). Both desktop and PWA only ever trigger the OAuth and then talk to the MatterChat server, which holds and refreshes the encrypted tokens. **Action: `EXTERNAL_TOKEN_ENC_KEY` must be set in staging and prod before connector OAuth is enabled** — without it the crypto helper no-ops and tokens would not be encrypted at rest. This is a hard launch gate for the connector feature on every channel (web/PWA/desktop alike).

---

## Open items / dependencies
- Reserve + DNS the prod host (`matterchat.omnisai.io`) and add all `_omnisai/_teams/_slack/_google` callbacks to it on every provider before desktop GA.
- Set `WEB_PUSH_VAPID_*` and `EXTERNAL_TOKEN_ENC_KEY` in staging/prod secrets.
- Confirm screen-share `setDisplayMediaRequestHandler` against the RC core version pinned in this fork.
- Decide universal vs arm64-only macOS build (affects download-page matrix).
