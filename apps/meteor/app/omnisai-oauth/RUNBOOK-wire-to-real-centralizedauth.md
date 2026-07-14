# Runbook — Wire "Sign in with OmnisAI" to the **real** CentralizedAuth

This makes the OIDC keystone (and the Slack-member provisioning tool) talk to the live
CentralizedAuth instead of the local mock. It was verified against a mock because the staging
auth server is **internal-only** (private VPC IPs `10.0.x.x`) and unreachable from a laptop.

> Everything below is one-flip ready. Steps 0–5 are the SSO wiring; Step 6 is the provisioning tool.

---

## 0. Prerequisite — network reach to staging auth (NOT possible from a normal laptop)

`auth-app.stg-omnisai.io` resolves to a **private** address (`10.0.223.166`); there is no public
route to it. Pick ONE:

- **(Recommended) Run MatterChat in the Alpha environment** — it lives inside the VPC, so
  `auth-app.stg-omnisai.io` resolves and routes. (Requires MatterChat onboarded to Alpha —
  `AlphaEnvironment` PR #13.) Do Steps 1–5 with `ROOT_URL` = the alpha URL.
- **VPN into the OmnisAI VPC** that routes `10.0.0.0/16`, then run MatterChat locally on `:3100`.
- **SSH tunnel** `auth-app` through a VPC bastion (then point `OMNISAI_OIDC_ISSUER` at the tunnel).

Confirm reach before continuing:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://auth-app.stg-omnisai.io/api/auth/jwks   # expect 200
```

Endpoint base (better-auth `mcp` plugin, mounted under `/api/auth`):
| Purpose | URL |
|---|---|
| discovery | `https://auth-app.stg-omnisai.io/.well-known/oauth-authorization-server` |
| authorize | `https://auth-app.stg-omnisai.io/api/auth/mcp/authorize` |
| token | `https://auth-app.stg-omnisai.io/api/auth/mcp/token` |
| userinfo | `https://auth-app.stg-omnisai.io/api/auth/mcp/get-session` |
| client registration (DCR) | `https://auth-app.stg-omnisai.io/api/auth/mcp/register` |
| JWKS | `https://auth-app.stg-omnisai.io/api/auth/jwks` |

(MatterChat's server builds `${OMNISAI_OIDC_ISSUER}/api/auth/mcp/{authorize,token,get-session}` —
so it just needs the issuer base, below. These paths already match the real ones.)

---

## 1. Register MatterChat as an OIDC client (Dynamic Client Registration)

DCR is open; MatterChat is a **public** client (PKCE, no secret). Register the EXACT redirect_uri(s)
you'll use — they're validated by exact match.

```bash
# redirect_uri = <ROOT_URL>/_omnisai/callback. Register every host you'll run on.
curl -s -X POST https://auth-app.stg-omnisai.io/api/auth/mcp/register \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "MatterChat",
    "redirect_uris": [
      "http://localhost:3100/_omnisai/callback",
      "https://<your-matterchat-alpha-or-staging-host>/_omnisai/callback"
    ],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scope": "openid profile email offline_access casepro:read"
  }'
# -> capture "client_id" from the response (client_secret will be null — that's correct).
```

---

## 2. Configure MatterChat (env)

Set these on the MatterChat server process (replace the client id from Step 1):

```bash
OMNISAI_OIDC_ENABLED=true
OMNISAI_OIDC_ISSUER=https://auth-app.stg-omnisai.io
OMNISAI_OIDC_CLIENT_ID=<client_id from Step 1>
OMNISAI_OIDC_SCOPE="openid profile email offline_access casepro:read"
# ROOT_URL must equal the host whose /_omnisai/callback you registered:
ROOT_URL=http://localhost:3100          # or the alpha/staging URL
```

Also flip the public setting so the login button shows (either is fine):
- env `OVERWRITE_SETTING_OmnisAI_OIDC_Enabled=true`, OR
- Admin → Settings → **OmnisAI** → `OmnisAI_OIDC_Enabled` = on.

> No code change needed — config only. `OMNISAI_OIDC_ISSUER` is the only thing that moves us off
> the mock (`http://127.0.0.1:9100`) onto real auth.

---

## 3. Restart MatterChat (mind the stale-server trap)

```bash
kill -9 $(lsof -nP -iTCP:3100 -sTCP:LISTEN -t)   # free the listener first (RC traps SIGTERM)
node main.js                                       # in /tmp/matterchat-prod/bundle (or your run cmd)
```

Mechanical check (no login needed): the authorize redirect should point at real auth with PKCE:
```bash
curl -s -o /dev/null -w "%{redirect_url}\n" http://localhost:3100/_omnisai/authorize
# -> https://auth-app.stg-omnisai.io/api/auth/mcp/authorize?...&code_challenge=...&code_challenge_method=S256
```

---

## 4. Log in (the human step — only you can do this)

Open MatterChat → **Sign in with OmnisAI** → you're sent to the real auth login
(`auth.stg-omnisai.io/auth/login`) → enter your OmnisAI credentials → approve the consent screen
for MatterChat → you land back logged in.

---

## 5. Verify the real link

After your login, the MatterChat user should carry your **real** CasePro identity:
```bash
mongosh --port 27018 --quiet --eval '
  db.getSiblingDB("matterchat_prod").users.findOne(
    { "services.omnisai.id": { $exists: true } },
    { username:1, emails:1, "services.omnisai":1 })'
# services.omnisai.id  == your CentralizedAuth UUID == your CasePro users.id
# services.omnisai.orgId / role come from the casepro:org_id / casepro:role id_token claims
```
That id is now usable to pull your real CasePro matters (the boards CasePro client, once its own
RestTransport auth is wired, can key off it).

---

## 6. (Separate) Point the provisioning tool at real auth

`~/mc-provision-from-slack.js` calls `POST /organizations/invite-multiple`, which is **admin-gated**
(needs a logged-in org-admin session). Get a session, then:

```bash
# Get an org-admin session token: log into auth.stg-omnisai.io as an org admin, copy the
# `better-auth.session_token` cookie value (browser dev tools), and pass it as AUTH_ADMIN_TOKEN.
AUTH_BASE=https://auth-app.stg-omnisai.io \
ORG_ID=<your real organization uuid> \
ROLE_ID=<the role uuid to assign, e.g. paralegal> \
AUTH_ADMIN_TOKEN=<org-admin session token> \
SLACK_USERS_JSON=/path/to/slack-export/users.json \
node ~/mc-provision-from-slack.js
```
This invites every Slack member into your org → CentralizedAuth fires `user.added_to_org` → CasePro
(+ LitBox) auto-sync them. (Real invite-multiple sends emails + creates pending invites; the
CasePro sync fires on acceptance/approval — the mock fired it immediately to demonstrate the chain.)

---

## Gotchas (already handled in code, listed so nothing surprises you)
- **PKCE S256 is mandatory** on real auth — our handler does it; the stock RC Custom OAuth could not
  (that's why this is a dedicated provider).
- **redirect_uri is exact-match** — register every host (localhost AND the alpha/staging URL).
- **`token_endpoint_auth_method: none`** (public client, no secret) — PKCE is the proof.
- **Consent screen** shows on first login per user (third-party client) — expected.
- **`sub` == CentralizedAuth UUID == CasePro `users.id`** — the whole point; persisted as
  `services.omnisai.id`.
- Keep MatterChat's host in CentralizedAuth `getTrustedOrigins()` if CORS rejects the flow (staging
  `*.stg-omnisai.io` is already matched; a bespoke host may need adding).
