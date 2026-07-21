# MatterChat — Known Issues & Follow-ups

_Last updated: 2026-07-19 (end of wave 3). This tracks shipped-but-unresolved problems and
deferred work so nothing is lost. Fix carefully — several of these are architectural, not one-line bugs._

---

## 🔴 P0 / high-impact — Slack connector reliability

### 1. Slack **browse view** can't reliably show messages (architectural ceiling)
- **Symptom:** In the browse view (clicking a Slack workspace/DM in the rail), messages you SEND
  don't appear, and messages sent FROM Slack (inbound) also don't reliably appear — even hours/days later.
- **Root cause (verified end-to-end 7/19):** The browse view works by re-reading Slack's
  `conversations.history` API on every load. For a **custom (non-Marketplace-approved) Slack app**
  like ours, Slack's 2025 policy restricts `conversations.history` — it does **not** return the app's
  own sent messages (proven: `chat.postMessage` returns a real `ts`, but a same-channel history read
  seconds AND days later never contains it), and appears to return a stale/limited window for inbound too.
- **This is NOT a bug we can patch** — the whole browse-lane design depends on an API Slack has
  restricted for our app tier.
- **What we DID ship (mitigation, outbound only):** MatterChat now stores every message it sends
  (`external_sent_messages` collection + localStorage) and merges them into the browse view, so
  **your own sent messages stay visible** regardless of the API. Inbound is NOT mitigated.
- **Real fix options (decide later):**
  1. **Get the Slack app Marketplace-approved** (restores full `conversations.history`), OR
  2. **Stop using the browse lane for Slack; lean on the BRIDGE** (below — real-time Events API,
     doesn't depend on `conversations.history`), OR
  3. Re-architect browse to be Events-API-driven with a persistent local message store (like the bridge).

### 2. ✅ RESOLVED 2026-07-21 — bridge inbound was dying on TWO stacked silent errors
- **Was:** "bridged Slack rooms degraded / never receive the other side" (below, kept for history).
- **Root causes (both live-reproduced with a signed-event E2E; each error was warn-logged only, invisible in the UI):**
  1. `sendMessage`'s `validateMessage` requires the `message-impersonate` permission for ANY message with an `alias`. Bridge inbound from the OTHER party always sets `alias` and was sent AS the human connection owner → `'Not enough permission'` → dropped. The owner's echoes carry no alias — outbound looked fine, so the bug read as "flaky inbound" for days.
  2. Once past (1): `'Custom fields not enabled'` — validateMessage rejects `message.customFields` when the workspace `Message_CustomFields` setting is off (default). The bridge's `connectorBridge` stamp rode inside sendMessage; the outbound leg never hit this because it stamps AFTER save via `Messages.updateOne`.
- **Fixes:** aliased inbound is now authored by the dedicated `connector.bridge` BOT (role `bot` holds `message-impersonate` — stock-RC bridge pattern; `bridge/bridgeBot.ts`), and the stamp moved to post-save `Messages.updateOne`, mirroring outbound.
- **Lesson that outlives the fix:** when a pipeline "mostly works but eats specific items", grep the server log for the item BEFORE theorizing — both killers were sitting in plain `SystemLogger.warn` lines the whole time. And any bridge write path must be exercised by an E2E that asserts the message IN THE ROOM, not just an accepted webhook.

#### (original report, 2026-07-19)
##### was: The **bridge** is in a worse state than before wave 3
- **Symptom (founder-reported 7/19):** bridged Slack rooms degraded vs. prior.
- **NOTE:** wave 3 did NOT touch the bridge or the Slack inbound read (verified — empty git history
  for `app/connectors/server/bridge/` and `SlackProvider.syncMessages` across wave 3). So this is
  **not a wave-3 regression in that code.**
- **Most likely cause:** the earlier **reactions/edits/deletes port** (PR #75) heavily rewrote
  `bridge/bridgeCore.ts` (+ Teams webhook + Slack event processing). That is the biggest recent
  bridge change and is live in prod.
- **Next step:** diagnose the specific failure (messages not arriving / duplicates / errors / broken
  rooms). If the port regressed it, **revert PR #75's bridge changes** to restore known-good, then
  re-apply reactions/edits/deletes carefully with live verification.
- **Also required for real-time inbound (pre-existing):** `SLACK_SIGNING_SECRET` deployed +
  the Slack app subscribed to the correct **user** events (`message.channels/groups/im/mpim`,
  `reaction_added/removed`) + `reactions:read/write` scopes, then reconnect the workspace.

---

## 🔵 CasePro → MatterChat webhook: NEVER SHIPPED (not a config fix)

_Investigated 2026-07-19. Recorded because it looks wired but isn't, and was twice
mis-diagnosed as "the domain move orphaned the webhook URL"._

**Both halves of this integration are inert. There is no URL to repoint.**

- **CasePro's sender was never deployed.** Neither `origin/staging-backend` (what runs) nor
  `origin/main` contains a single `matterchat` reference in `src`. The sender — a
  `webhook-subscriptions` module with a per-subscription `target_url` DB column — exists only
  on **local, unpushed branches** (`feature/matterchat-webhook-action` + siblings). Nothing has
  ever POSTed to MatterChat from CasePro in any deployed environment.
- **MatterChat's receiver is fail-closed and unarmed.** `CASEPRO_WEBHOOK_SECRET` is NOT set in
  the production manifest. By design that means every delivery is answered 202 with zero
  processing — so even a correct sender would be silently dropped.
- **It was built staging-only.** The ingress exists solely as
  `kubernetes/staging/casepro-webhooks-public-ingress-staging.yaml` (`webhooks-crm.stg-omnisai.io`)
  with **no production counterpart**, and neither `.env.production` nor `.env.staging` carries any
  webhook/MatterChat config. Tests hardcode `matterchat.stg-omnisai.io` — a host from two domains ago.

**To actually ship it** (a build, not a config tweak):
1. Push + merge the `webhook-subscriptions` module to `staging-backend`; deploy.
2. Build the production side: prod ingress (if CasePro needs to receive), prod env/secret.
3. Set `CASEPRO_WEBHOOK_SECRET` in MatterChat's prod manifest (requires a promote) and the same
   shared secret on the CasePro side.
4. Create a subscription row with `target_url = https://app.matterchat.com/_casepro/webhook`
   (runtime DB value — changeable later without a redeploy).

**Priority: LOW.** This is real-time case-update notifications posting into matter channels — a
nice-to-have layered on the matters/leads sync, which works via **outbound pull** and is entirely
independent of this (and of MatterChat's domain).

⚠️ **Do NOT diagnose CasePro sync problems as "the webhook broke."** The outbound pull sync uses a
static API key against CasePro's own base URL and is domain-independent. The CasePro board failures
of 2026-07-19 were a **frontend crash on legacy card shapes** (see migration v339), not transport.

---

## 🟡 Founder-side config (unblocks features already built)
- **Teams:** paste Client ID + Client Secret (Azure app reg → Certificates & secrets) in Admin → Teams.
- **Google Chat:** paste OAuth Client ID + Secret (Google Cloud Console) in Admin → GoogleChat.
- **Slack reactions:** add `reaction_added`/`reaction_removed` user events + `reactions:read/write`
  scopes to the Slack app, then reconnect the workspace.

---

## 🟢 Product direction / deferred
- **Files tab → cloud storage:** replace the redundant LitBox "Files" rail entry with
  Dropbox/Box/Google Drive/OneDrive sync connectors (founder decision 7/19). Wave-4 feature.
  **LitBox prod-trust work is PAUSED** because of this pivot.
- **Cross-device sent-message store:** DONE (server-side `external_sent_messages`, this release).
- **Mobile PWA screens** shipped as static mockups (hardcoded demo data) — wire to real data.
- **Agent sync-notify webhook** (`/internal/webhooks/agents/sync-notify`) is unauthenticated —
  currently a no-op TODO stub; add HMAC before implementing the real handler.
- **Wave-3 feature specs** (11 features) live in `docs/design/WAVE3-FEATURE-SPECS.md`.
