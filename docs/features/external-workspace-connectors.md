# External Workspace Connectors (Slack & Microsoft Teams)

> Status: **live** for connect + browse + read + send + unread badges (merged to staging). **In progress:** real-time updates and a live message bridge into MatterChat rooms — see "What's not here yet".

## What it is

Connect your own Slack workspace or Microsoft Teams organization to MatterChat and work those conversations without leaving the app. Each connected workspace appears as a tile on the left-hand workspace rail with a live unread badge; clicking it opens a sidebar with that workspace's **Channels**, **Chats** (DMs), and **People**, where you can read message history and send replies *as yourself*.

Connections are **per-user**: you connect *your* Slack/Teams identity, you see exactly what you're allowed to see there, and messages you send are sent as you. Nothing is shared firm-wide, and your credentials are stored encrypted (AES-256-GCM) on the server.

## Who it's for

Attorneys and staff who live in MatterChat but still have co-counsel, clients, or vendors on Slack or Teams — one window instead of three.

## How to use it

**Connect Slack:**
1. Click **+** on the workspace rail and choose **Slack**.
2. Click **Connect Slack** — you're sent to Slack's standard authorization page.
3. Approve. You land back in MatterChat with a Slack tile on the rail.

**Connect Microsoft Teams:**
1. Click **+** on the rail and choose **Teams**.
2. Click **Connect Microsoft Teams** — you sign in with your Microsoft work account (any organization; the app is multi-tenant).
3. Approve the requested permissions. If your Microsoft 365 tenant requires admin consent for the read permissions, MatterChat shows the admin-consent link; once your IT admin grants it, reconnect and you're in.

**Using a connected workspace:**
- Click the workspace tile → sidebar shows **Channels**, **Chats**, and **People** from that workspace.
- Click any channel or chat to read messages (newest first; history pages back up to 250 messages).
- Type in the message box to reply — the message posts to Slack/Teams as you.
- Unread counts appear on the rail tile and in bold in the sidebar (refreshed roughly every 30 seconds). Opening a conversation marks it read (synced back to Slack; best-effort on Teams).
- Disconnect any time from the workspace tile.

## Notifications

You get unread badges on the workspace tile and bolded conversations with counts, polled about every 30 seconds. These are in-app indicators — **not** push notifications, desktop toasts, or sounds. Mention counts are shown in the UI but not yet populated.

## What's not here yet (honest status)

- **Real-time updates** — message lists and badges refresh by polling (~30s), not instantly. Webhook/live subscriptions are the next milestone.
- **Live message bridge** — external conversations are viewed in their own panel; they are **not** synced into MatterChat rooms, and there is no two-way room bridging. A Teams message bridge is in progress (local development only, not on staging).
- Google Chat has the same connector plumbing but is less mature than Slack/Teams.

## Admin setup

Per provider, in **Administration → Settings**:

| Setting | Purpose |
|---|---|
| `Slack_Enabled` (default off) | Master switch for the Slack connector |
| `Slack_OAuth_Client_Id` / `Slack_OAuth_Client_Secret` | Your Slack app's credentials (secret is masked). Redirect URL in your Slack app registration must be `<Site_Url>/_slack/oauth/callback`. |
| `Teams_Enabled` (default off) | Master switch for the Teams connector |
| `Teams_OAuth_Client_Id` / `Teams_OAuth_Tenant_Id` / `Teams_OAuth_Authority` / `Teams_OAuth_Client_Secret` | Your Microsoft Entra app registration (multi-tenant Web app; authority defaults to the multi-tenant `organizations` endpoint). Redirect URL: `<Site_Url>/_teams/oauth/callback`. |

With a connector disabled or its secret empty, that provider no-ops cleanly (no errors, no buttons that half-work).

Requested access is **delegated** (acts as the signed-in user) — Slack user scopes for reading/sending in the user's channels and DMs; Microsoft Graph delegated scopes for teams, channels, chats, and messages.

## FAQ

**Can the firm see my connected Slack/Teams messages?**
No — the connection is yours. Reads and sends use your personal delegated token; other MatterChat users see nothing of it.

**Are my Slack/Teams passwords stored?**
Never. Only OAuth tokens, and those are stored encrypted at rest (AES-256-GCM).

**Why does Teams ask for admin consent?**
Some Microsoft 365 tenants require an IT admin to approve message-reading permissions once for the whole tenant. MatterChat detects this and surfaces the consent link.

**Do messages I send appear in MatterChat channels?**
No — they post directly to Slack/Teams. External conversations stay in their own panel (no room bridging yet).

## Key files (for developers)

`apps/meteor/app/connectors/server/` (ChatProvider contract, connectionService, `providers/slack/`, `providers/teams/`), `apps/meteor/app/api/server/v1/external-workspaces.ts` (REST), `apps/meteor/client/views/root/MainLayout/ExternalSidebar.tsx` + `useExternalUnreadSummary.ts` + `OrgSwitcherRail.tsx` (UI), `apps/meteor/server/settings/slack.ts` / `teams.ts` (settings).
