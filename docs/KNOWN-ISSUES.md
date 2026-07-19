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

### 2. The **bridge** is in a worse state than before wave 3
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
