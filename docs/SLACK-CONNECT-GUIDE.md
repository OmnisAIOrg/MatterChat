# Connecting your Slack workspace to MatterChat — the complete guide

*For workspace admins setting it up once, and for every user connecting their own Slack.
Written plainly on purpose. When in doubt at any step: **DM `@chi.bot` in MatterChat and ask** —
Chi knows this guide, can check your current Slack status (`what's our slack status`), and can
apply the workspace settings for you.*

---

## The mental model (read this first — 60 seconds)

MatterChat shows your Slack in **two different ways**, and knowing which one you're looking at
explains almost every question:

1. **The Slack workspace view (the "browse" lane).** Click your Slack workspace tile on the left
   rail → you see your Slack channels and DMs *inside* MatterChat. You read and send as yourself.
   Messages arrive live, unread pills show on conversations, and DMs raise a sound + notification.
2. **Bridged rooms (the "bridge" lane).** Any Slack conversation can be **bridged** into a real
   MatterChat channel (the `Bridged · Live` pill in the header). The room then behaves like any
   native channel — searchable, taggable, visible to teammates you invite — with messages flowing
   both ways. Messages from the Slack side appear under the **Bridge** bot with the real author's
   name shown.

Both lanes are fed by the same underlying connection: **each user connects their own Slack
account** (their token acts as them), and the workspace has **one Slack app** that delivers events.

---

## Part 1 — One-time workspace setup (admin, ~10 minutes)

### Step 1. Create (or open) the Slack app
Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → *From scratch* →
name it (e.g. "MatterChat") → pick your Slack workspace.

### Step 2. OAuth — redirect URL and scopes
Under **OAuth & Permissions**:

- **Redirect URLs** — add exactly:
  `https://app.matterchat.com/_slack/oauth/callback`
- **User Token Scopes** (these let each user read/send as themselves):
  `channels:read` `channels:history` `groups:read` `groups:history` `im:read` `im:history`
  `im:write` `mpim:read` `mpim:history` `chat:write` `users:read` `team:read`
  — and for reaction sync: `reactions:read` `reactions:write`

### Step 3. Event Subscriptions — this is the step everyone gets wrong
Under **Event Subscriptions** → toggle **On**:

- **Request URL** — exactly: `https://app.matterchat.com/_slack/events`
  It must show **Verified ✓**. (It can only verify AFTER Step 4's signing secret is saved in
  MatterChat — do Step 4 first if it fails.)
- **Subscribe to events on behalf of users** — add ALL FOUR:
  `message.im` · `message.mpim` · `message.channels` · `message.groups`
  (+ `reaction_added` and `reaction_removed` if you want reactions to sync)

> ⚠️ **The #1 mistake:** adding `message.im` under **"Subscribe to bot events"** instead.
> Bot events only fire for conversations the bot itself was invited to — which is never your
> personal DMs. If Slack→MatterChat messages "just don't arrive," this is almost always why.
> The four events MUST be in the **"on behalf of users"** section.

Save. If Slack asks you to **reinstall the app** to the workspace, do it.

### Step 4. Tell MatterChat about the app
From the app's **Basic Information** page you need three values: **Client ID**, **Client Secret**,
and **Signing Secret**. Then either:

- **Ask Chi (easiest):** DM `@chi.bot`:
  *"provision slack: enable it, client id `<id>`, client secret `<secret>`, signing secret `<secret>`"*
  Chi applies them (you'll confirm in-chat) and audits the change. Ask *"what's our slack status"*
  any time to see the state of everything.
- **Or the admin UI:** **Admin → Settings → Slack** → set *Enabled* on, paste the Client ID,
  Client Secret and Signing Secret → Save.

### Step 5. Sanity check
DM `@chi.bot`: *"what's our slack status"*. You want: `Slack_Enabled: true`, client id set,
client secret **set**, signing secret **set**. Then re-verify the Event Subscriptions Request URL
(Step 3) shows **Verified ✓**.

---

## Part 2 — Each user connects their own Slack (~30 seconds per person)

1. In MatterChat, click the **＋** on the left workspace rail → **Connect Slack**
   (or open `https://app.matterchat.com/_slack/oauth/start` while signed in).
2. Slack asks you to authorize — click **Allow**.
3. Your Slack workspace appears as a tile on the rail. Click it: your channels and DMs are there.

**That's it.** Messages you send go out as you; inbound arrives live with unread pills, and DMs
notify with sound + banner (channels stay quiet — pills only, like Slack itself).

> 🔁 **The reconnect rule:** whenever an admin CHANGES the Slack app's scopes or event
> subscriptions, every already-connected user must **disconnect and reconnect** (rail tile →
> Disconnect → Connect Slack again). The new grants only take effect on a fresh authorization.

---

## Part 3 — Bridging a Slack conversation into a real MatterChat room (optional)

Open the conversation in the Slack workspace view → **Bridge** (header button). MatterChat creates
a native channel that mirrors it both ways. Notes:

- Messages FROM Slack appear under the **Bridge** bot, showing the real author's name.
- Your own Slack-side messages appear too (they're your echoes — no duplicates).
- **Unbridge** from the same header any time; the room and its history remain.

---

## Troubleshooting (in order of how often it's the answer)

| Symptom | Cause → fix |
|---|---|
| I can send TO Slack, but Slack replies never arrive | The four `message.*` events are under **bot events** or missing — move/add them under **"on behalf of users"** (Step 3), reinstall, then every user reconnects (Part 2 rule) |
| Request URL won't verify (red ✗) | The **Signing Secret** in MatterChat doesn't match the app's — redo Step 4, then click *Retry* on the URL |
| Events verified but still nothing inbound | Users connected BEFORE the events/scopes were added — disconnect/reconnect (the reconnect rule) |
| Inbound arrives but delayed / only on refresh / no red pills | You're on an old MatterChat build — fixed 2026-07-20 (live push + store-computed unread). Hard-refresh the tab after a deploy |
| Bridged room gets nothing from the other side (workspace view fine) | Fixed 2026-07-21 (`message-impersonate` root cause — see KNOWN-ISSUES history). Update your build |
| "Connect Slack" bounces with an error | `Slack_OAuth_Client_Secret` is empty or the Redirect URL (Step 2) isn't registered exactly |
| No notification sound/banner for a DM | Browser notification permission — padlock icon → Notifications → Allow. Focused-on-that-conversation messages intentionally don't notify |
| Moved/renamed your MatterChat domain? | Re-do the two URLs (Steps 2–3) on the new host — Slack treats redirects as delivery failures and will disable events |

**Still stuck?** DM `@chi.bot`: *"run a slack status check and tell me what's misconfigured"* —
connector state, secrets presence, and connected-user counts are all visible to it (secret values
stay masked).

---

*Teams and Google Chat follow the same two-lane model with their own provider settings — ask Chi
"what's our teams status" / "what's our google status". This guide's Slack specifics (user events,
signing secret) are Slack-only.*
