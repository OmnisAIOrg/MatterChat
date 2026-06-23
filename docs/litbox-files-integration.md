# MatterChat ↔ LitBox "Files" Integration

## Marketing summary

Your documents now live right next to your conversations. The new **Files** item in MatterChat's left rail opens your full LitBox file account — browse, search, preview, tag, comment, and share every document your team has stored — without ever leaving MatterChat or logging in a second time. Sign in once with OmnisAI and your files are just there, organization-wide, in the same app where the work happens.

---

## 1. What it does for users

- A **Files** entry in the MatterChat left navigation rail opens a full-screen "Files" page.
- That page embeds the user's **LitBox** account: the same files, folders, shares, tags, tasks, and comments they'd see in LitBox, rendered inside MatterChat.
- It is **organization-wide** (`orgWide`) — the user sees their org's files, not just a personal scope.
- No second login. The user's "Sign in with OmnisAI" session is reused to authenticate against LitBox automatically.
- Heavy assets only load when the user actually opens Files (lazy-loaded), so the rest of MatterChat stays fast.

---

## 2. Architecture

### 2.1 The left-rail "Files" item → `LitboxFilesView`

- **`client/views/litbox/LitboxFilesView.tsx`** is the "Files" screen. It renders a standard `Page` / `PageHeader` (title "Files") and lazy-imports the embed:
  ```ts
  const LitboxEmbed = lazy(() => import('./LitboxEmbed'));
  ```
  The lazy import keeps the heavy `@omnisaiorg/litbox-file-browser` package out of MatterChat's main client bundle — it is fetched only when the user opens Files. A `<Throbber/>` shows under `<Suspense>` while it loads.
- The browser-side token handed to the embed is the caller's **own MatterChat session token**, read from local storage:
  ```ts
  const authToken = userId ? (window.localStorage.getItem('Meteor.loginToken') ?? '') : '';
  ```
  This is *not* a LitBox credential — it is the MatterChat login token, which the server-side proxy validates before swapping in the real LitBox credential.

### 2.2 The embedded `@omnisaiorg/litbox-file-browser` component

- **`client/views/litbox/LitboxEmbed.tsx`** is the **only** module that imports the heavy package and its CSS:
  ```ts
  import { LitboxProvider, LitboxFileBrowser } from '@omnisaiorg/litbox-file-browser';
  import '@omnisaiorg/litbox-file-browser/style.css';
  ```
- It mounts the shared LitBox React component with a config that points at MatterChat's **own** origin, not at LitBox:
  ```ts
  const LITBOX_API_BASE = '/_litbox/v1';

  <LitboxProvider config={{ apiBaseUrl: LITBOX_API_BASE, authToken, appSlug: 'matterchat' }}>
      <LitboxFileBrowser orgWide className='litbox-embed-root' />
  </LitboxProvider>
  ```
  - `apiBaseUrl: '/_litbox/v1'` — every LitBox API call the component makes is sent to MatterChat's own server (same origin), where the proxy handles it.
  - `authToken` — the caller's MatterChat session token (above).
  - `appSlug: 'matterchat'` — identifies this client to LitBox.
  - `orgWide` — show the whole organization's files.

> Note: the source-file comments mention `/api/litbox/v1`, but the live code mounts the proxy at **`/_litbox`** and the client points at **`/_litbox/v1`**. The comments are stale on the exact path; the behavior described (own-origin proxy, server-side credential injection) is accurate.

### 2.3 The server-side `/_litbox` proxy

- **`app/omnisai-oauth/server/litboxProxy.ts`** declares a `connect` middleware mounted at `/_litbox`:
  ```ts
  RoutePolicy.declare('/_litbox/', 'network');
  WebApp.connectHandlers.use('/_litbox', async (req, res, next) => { ... });
  ```
  `connect` strips the `/_litbox` prefix, so inside the handler `req.url` begins with `/v1/<rest>`.
- **Why it's mounted OUTSIDE `/api`:** Rocket.Chat's own `/api/*` router owns that namespace and 404s unknown `/api` paths *before* any custom middleware runs. Mounting at `/_litbox` (mirroring the existing `/_omnisai` OIDC routes) keeps the proxy reachable. This is the reason the client `apiBaseUrl` is `/_litbox/v1` rather than `/api/...`.
- **Request flow per call:**
  1. **Authenticate the MatterChat user.** Read the `Authorization: Bearer <token>` header (the MatterChat login token the embed sends), hash it with `Accounts._hashLoginToken`, and look the user up by `services.resume.loginTokens.hashedToken`. The lookup projects `omnisaiLitbox` only.
  2. **Load the user's LitBox credential** from the top-level `omnisaiLitbox.sessionToken` field (see §3). No credential → `401`, which makes the embedded browser show LitBox's unauthenticated/empty state.
  3. **Validate method and path** (see §2.4) — *before* the credential is attached.
  4. **Forward to the real LitBox backend** at `${LITBOX_API_URL}/api/v1/<rest>`, injecting `Authorization: Bearer <litboxToken>` server-side. The MatterChat token, inbound `Cookie`, and inbound `Origin` are stripped and never forwarded; hop-by-hop headers are dropped.
  5. **Relay the response** back with a small allow-list of headers (`content-type`, `content-disposition`, `cache-control`, `etag`). Request/response bodies are handled as raw `Buffer`s so binary uploads/downloads pass through.
- **Two wins of the own-origin proxy design:**
  - **(a)** No cross-origin call from the browser to LitBox → no LitBox CORS allow-list change is needed.
  - **(b)** The LitBox credential **never reaches the client** — it is injected server-side, only on the forwarded request.
- **Configuration:** `LITBOX_API_URL` (parsed once at boot) must be an absolute `https` URL (`localhost`/`127.0.0.1` allowed for dev). The proxy **pins all outbound calls to this origin**. If `LITBOX_API_URL` is unset, the proxy returns `503 litbox_not_configured`.

### 2.4 Proxy hardening

The proxy was hardened per an auth-chain red-team; the following gates all fail closed and must not be relaxed without re-review:

- **Authorization header ONLY** — never a cookie. A cookie-authenticated proxy would be CSRF-able cross-site; a `Bearer` header is not.
- **Origin pin** — the outbound URL is always built from the parsed `LITBOX_API_URL` origin (`${base.origin}/api/v1/...`) and re-asserted (`url.origin === base.origin && pathname.startsWith('/api/v1/')`).
- **Path allow-list** — only a fixed set of v1 resource prefixes is relayed (open-relay defense). Allowed first segments: `files`, `folders`, `shares`, `tags`, `tasks`, `comments`, `search`, `trash`, `workspaces`, `organizations`, `users`, `auth`, `classification-categories`, `file-app-links`, `audit-logs`. Anything else → `400`.
- **Path-safety checks** — before building the URL, the decoded path is rejected if it contains `..`, backslashes, NUL, control characters, or `//` (path-traversal / protocol-relative defense). The path must match `^/v1/([a-zA-Z0-9._\-/]+)$`.
- **Method allow-list** — `GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS`; anything else → `405`.
- **Credential attached last** — the injected `Bearer` is added only *after* origin-pin + path allow-list + method allow-list all pass. Fail closed.
- **`redirect: 'manual'`** — redirects are never followed, so the injected credential can never be carried off the pinned origin by an upstream redirect.
- **No credential leakage to logs** — the Authorization value is never logged.

> `ignoreSsrfValidation: true` is passed on the forward fetch, which is safe specifically *because* the target origin is pinned to the parsed `LITBOX_API_URL` (not user input).

---

## 3. Auth / security model

### 3.1 OIDC login captures the LitBox credential

"Sign in with OmnisAI" is a CentralizedAuth OIDC (PKCE/S256) login, owned server-side in **`app/omnisai-oauth/server/index.ts`**:

- `GET /_omnisai/authorize` mints PKCE state+verifier and redirects to CentralizedAuth.
- `GET /_omnisai/callback` verifies state, exchanges `code + verifier` for tokens, resolves identity from the `id_token` claims (falling back to `userinfo`), and stashes the profile under a one-time, server-only `credentialToken`.

At the callback, the OIDC tokens are captured into that stashed profile:
```ts
litboxSessionToken: tokens.access_token,
litboxRefreshToken: tokens.refresh_token,
litboxExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
```
`CredentialTokens` is one-time and server-only, so these raw tokens never reach the browser. **LitBox accepts the CentralizedAuth session/access token as its bearer**, so `access_token` is exactly the credential the proxy will later forward.

### 3.2 Stored on a TOP-LEVEL `omnisaiLitbox` field (the `getFullUserData` leak)

**`app/omnisai-oauth/server/loginHandler.ts`** redeems the one-time `credentialToken`, find-or-creates the MatterChat user (linking OIDC `sub` → `services.omnisai.id` == CasePro `users.id`), and persists the LitBox credential:
```ts
...(profile.litboxSessionToken ? { 'omnisaiLitbox.sessionToken': profile.litboxSessionToken } : {}),
...(profile.litboxRefreshToken ? { 'omnisaiLitbox.refreshToken': profile.litboxRefreshToken } : {}),
...(profile.litboxExpiresAt ? { 'omnisaiLitbox.expiresAt': profile.litboxExpiresAt } : {}),
```

**Why a top-level `omnisaiLitbox` field and NOT under `services.*`:** Rocket.Chat's `getFullUserData` projects the **entire `services` object** back to the user themselves — it's a *blacklist*, not an allowlist. Storing the token under `services.omnisai.*` (or anywhere in `services`) would leak it to the browser. `omnisaiLitbox` is a top-level field that is **not** in `getDefaultUserFields`, so no publication or REST endpoint projects it. The token therefore stays server-only.

(Encrypt-at-rest for this field, and refresh-on-expiry of the LitBox token, are noted in-code as follow-ups.)

### 3.3 Forwarded by the proxy (the confused-deputy / audience-binding fix)

The proxy reads `user.litbox?.sessionToken` (the stored `omnisaiLitbox.sessionToken`) and forwards it as the `Authorization: Bearer` to LitBox — only after all gates pass.

The key design point: MatterChat forwards the **user's own OIDC access token** to LitBox; LitBox accepts that token because it is **audience-bound** via `OIDC_TRUSTED_CLIENT_IDS`. LitBox trusts access tokens minted by CentralizedAuth for the trusted client IDs. This is the **confused-deputy fix**: MatterChat is not minting its own service credential and acting on the user's behalf with ambient authority — it relays the user's own audience-bound token, so LitBox authorizes the request as that user with exactly that user's scope. Combined with the proxy hardening (Authorization-only, origin/path/method allow-lists, `redirect: manual`), MatterChat cannot be turned into an open relay or be tricked into forwarding the credential anywhere but the pinned LitBox origin.

### 3.4 End-to-end token path (summary)

```
Sign in with OmnisAI (OIDC PKCE)
  → /_omnisai/callback captures access_token (LitBox-acceptable)
  → loginHandler persists it at user.omnisaiLitbox.sessionToken   [server-only, NOT services.*]
  → MatterChat session established (Meteor.loginToken in browser)

User opens "Files"
  → LitboxFilesView reads Meteor.loginToken
  → LitboxEmbed mounts litbox-file-browser with apiBaseUrl '/_litbox/v1', authToken = MatterChat token
  → component calls /_litbox/v1/* (same origin)
  → /_litbox proxy: validate MatterChat token → load omnisaiLitbox.sessionToken
                    → gate (origin/path/method) → inject Bearer <litboxToken>
                    → forward to ${LITBOX_API_URL}/api/v1/* (redirect: manual)
  → LitBox authorizes via OIDC audience-binding (OIDC_TRUSTED_CLIENT_IDS)
  → response relayed back to the embedded browser
```

---

## 4. Known limitations

- **Local dev:** MatterChat logs in via a **mock OIDC** locally, whose tokens the real staging LitBox / CentralizedAuth will reject. Files therefore only load against a real deploy (alpha). The proxy itself returns `503` unless `LITBOX_API_URL` is set.
- **Token refresh:** the proxy does not yet refresh an expired LitBox token; an expired credential surfaces as LitBox's unauthenticated state. Refresh-on-expiry is a follow-up.
- **Encrypt-at-rest:** the stored `omnisaiLitbox` credential is server-only but not yet encrypted at rest (follow-up).

## 5. Files

- `apps/meteor/app/omnisai-oauth/server/index.ts` — OIDC login routes; captures the LitBox credential at callback.
- `apps/meteor/app/omnisai-oauth/server/loginHandler.ts` — persists the credential on the top-level `omnisaiLitbox` user field.
- `apps/meteor/app/omnisai-oauth/server/litboxProxy.ts` — the hardened `/_litbox` server-side proxy.
- `apps/meteor/client/views/litbox/LitboxFilesView.tsx` — the "Files" screen (lazy mount).
- `apps/meteor/client/views/litbox/LitboxEmbed.tsx` — embeds `@omnisaiorg/litbox-file-browser` against the proxy.
