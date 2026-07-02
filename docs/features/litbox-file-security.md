# LitBox File Access: Security Hardening

> Status: **live** (both changes merged to staging, 2026-07-01)

## Trust-page blurb

Your firm's documents live in LitBox; MatterChat's Files integration is built so that the connection itself can't become the weak link:

- **Credentials are encrypted at rest.** The tokens MatterChat holds to reach LitBox on your behalf are stored encrypted with authenticated, industry-standard encryption (AES-256-GCM) and are only decrypted server-side at the moment of use — they are never sent to the browser.
- **Sessions expire and are enforced.** File requests are only honored for a valid, unexpired MatterChat session; expired sessions are rejected and the user must sign in again. Behind the scenes, expired LitBox access is refreshed through the OmnisAI identity service over a pinned, non-redirectable channel — and if that refresh can't be done safely, access simply fails closed.
- **All file traffic flows through MatterChat's own server** (a same-origin proxy), so LitBox credentials never appear in client-side code, and spoofable request headers are stripped before anything is forwarded.

## Admin setup

- Set `LITBOX_TOKEN_ENC_KEY` in the server environment to enable credential encryption at rest (ops-managed secret; without it the integration still works, but stored credentials are not encrypted — set it in any production deployment).
- Session lifetime follows the standard `Accounts_LoginExpiration` setting (default 90 days).

## What users notice

Almost nothing — which is the point. If a session has expired, the Files area asks for a fresh sign-in instead of silently serving files.
