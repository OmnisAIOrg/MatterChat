# MatterChat ↔ Slack: multi-org / "work in another company's Slack" — design note

Status: design proposal (no per-user model built yet)
Date: 2026-06-25
Scope: founder decision doc. The **workspace-level** slice (hop into the firm's ONE connected
Slack from the org-switcher) is built; this doc is about the **per-user** version.

---

## 1. Founder goal

> "I'm in MatterChat for my firm. I'm *also* a member of another company's Slack (a co-counsel firm,
> a vendor, a client's workspace). I want to read and post in *that* Slack's channels from inside
> MatterChat — without leaving the app — the way Slack's own client lets me sit in several Slack
> workspaces and click between them."

So the target is: **one MatterChat user, several Slack workspaces they personally belong to, switched
from the org-switcher rail** — each tile is a *different external Slack*, and selecting it shows that
Slack's channels and lets the user act as *themselves* in it.

That is meaningfully different from what ships today (below).

---

## 2. What ships today (and why it is NOT the goal)

The org-switcher rail now does a real thing:

- The rail shows the native MatterChat workspace plus a **single Slack tile**, gated on
  `SlackBridge_Enabled`.
- Selecting the Slack tile sets `selectedOrgId = 'slack'` in `OrgSwitcherContext`; `useRoomList`
  then filters the sidebar to rooms carrying Slack `importIds` (the **bridged** channels), and a
  "Slack workspace" banner with a **Back to MatterChat** control frames the view.
- "Add a workspace" deep-links admins to **Admin → SlackBridge** ("Connect a Slack"); non-admins get
  a message. It is a no-op when SlackBridge is disabled (the tile never appears).

Files: `client/views/root/MainLayout/{OrgSwitcherRail,OrgSwitcherContext,OrgSwitcherProvider,useOrgSwitcher}`,
`client/sidebar/sections/SlackWorkspaceBanner.tsx`, `client/sidebar/hooks/useRoomList.ts`.

**Why this isn't the founder goal:** it surfaces the firm's *own*, *single*, *admin-connected*
SlackBridge — one Slack workspace, mirrored into shared MatterChat rooms via a **bot**. It is not
"another company's Slack that I personally am in," and it is not per-user.

---

## 3. Why RC SlackBridge is workspace-level (the core constraint)

RC's SlackBridge (`apps/meteor/app/slackbridge/`) is a single server-side singleton
(`SlackBridgeClass`) configured entirely from **admin server settings**
(`server/settings/slackbridge.ts`):

- Credentials are **admin-entered tokens** — legacy `SlackBridge_APIToken`, or modern
  `SlackBridge_BotToken` / `SlackBridge_AppToken` / `SlackBridge_SigningSecret`. They are tokens for
  **one Slack app installed in one Slack workspace by that workspace's admin**.
- The bridge runs **once per MatterChat instance**, on the server, and **mirrors** Slack ↔ Rocket:
  Slack messages become MatterChat messages in a shared room (tagged with `importIds`), posted by a
  bot/alias — *not* by the individual MatterChat user authenticating as themselves to Slack.
- It is **bidirectional sync**, not a live per-user session. Everyone in the MatterChat room sees the
  same mirrored channel; there is no notion of "this user's Slack identity."

Consequences for the goal:

1. **Identity is wrong for the goal.** Posts go out as the bridge bot, not as the user. You can't
   "be yourself" in the other company's Slack through it.
2. **One workspace per instance (practically).** The token lists *can* hold multiple bot tokens, but
   they're all **admin-owned** and **shared**, not "my personal other-company Slacks."
3. **Admin-gated, shared.** A regular user cannot connect their own external Slack; only an admin
   editing privileged settings can, and the result is shared firm-wide.

So SlackBridge is the right primitive for "**mirror our firm's Slack into MatterChat**," and the
wrong primitive for "**let me personally hop into another company's Slack**." The built slice rides
SlackBridge precisely because it's the firm's own bridged Slack.

---

## 4. Per-user options

### Option A — Per-user Slack OAuth + per-user channel bridge ("bring your own Slack")

Each user runs **Slack OAuth** (Sign in with Slack) against a MatterChat-owned Slack app, granting a
**user token** (`xoxp-…`) per external workspace. MatterChat stores these per-user and uses **the
user's own token** to list channels and read/post — so the user acts as *themselves* in that Slack.
The org-switcher gets one tile per connected external Slack.

- **Identity:** correct — real user, real Slack identity. This is the only option that truly meets
  the goal.
- **How channels appear:** either (a) **on-demand fetch** of the user's Slack channels/messages via
  Web API + Socket Mode/Events on the user token (a live per-user view, not a mirror), or (b) a
  **per-user lightweight bridge** that syncs *that user's* selected channels into private MatterChat
  rooms only they see. (a) is cleaner and avoids polluting shared rooms.
- **Cost:** Slack **user tokens** require the workspace to *allow* the MatterChat Slack app
  (admin/app-approval in *each* external workspace), and Slack's per-token rate limits apply per user.
- **Effort:** **Large.** New Slack app (distributable), OAuth flow + token store (encrypted,
  per-user), a per-user Slack client layer, message read/post adapters mapping Slack ↔ MatterChat
  message shapes, channel pickers, presence/unread, file handling, and the org-switcher wiring to
  drive a per-user view instead of `importIds`. Essentially a second, user-scoped bridge engine.
- **Risk:** token security (a leaked `xoxp` token = full account access to that Slack), Slack app
  approval friction in each external org, ToS/rate-limit exposure, ongoing Slack API churn.

### Option B — Multiple bridge instances (one SlackBridge per external workspace)

Lean on the existing token-list support: register **multiple bot/app tokens**, one per external
Slack, each mirroring into a distinct set of shared MatterChat rooms; the org-switcher shows a tile
per bridged workspace (generalizing today's single Slack tile to N).

- **Identity:** still **bot/alias**, still **admin-connected**, still **shared firm-wide**. Does NOT
  meet the "be yourself in another company's Slack" goal — it's "mirror several Slacks for the whole
  firm."
- **Effort:** **Small–Medium.** Mostly: model "which rooms belong to which bridge" (today
  `selectedOrgId === 'slack'` is a single bucket → make it keyed per workspace), list N tiles, and
  admin UX for N connections. Reuses the whole existing bridge.
- **Use case it *does* fit:** a firm that wants several partner/vendor Slacks mirrored in one place.
  Worth doing regardless as an incremental win — but it is a different product than the founder goal.

### Option C — Embedded Slack (iframe / external link / Slack deep links)

Don't bridge at all; **embed or hand off to Slack's own client** — an in-app panel that opens the
other company's Slack (web client in an iframe where allowed, or a "Open in Slack" deep link per
workspace), with MatterChat just managing the list of "my other Slacks."

- **Identity:** correct (it's literally Slack), zero message-sync code.
- **Reality:** Slack's web app **blocks iframing** (CSP/frame-ancestors), so a true embed is not
  reliable; realistically this degrades to **deep links / "open Slack"** buttons — i.e., MatterChat
  becomes a launcher, not a place you actually work. Poor fit for "work in another company's Slack
  *from MatterChat*."
- **Effort:** **Tiny** for deep-link launcher; **N/A** for real embed (blocked by Slack).

---

## 5. Recommendation

**Two-track:**

1. **Now / cheap:** Ship **Option B (multi-instance, generalize the existing tile to N bridged
   Slacks)** *if and when* a firm asks to mirror more than one external Slack. It is a small,
   low-risk extension of what's built and reuses SlackBridge. It does **not** claim to be the
   personal-multi-Slack experience — sell it as "mirror your partner firms' Slacks."

2. **The real goal:** Build **Option A (per-user Slack OAuth + per-user view)** when the
   personal-multi-Slack experience becomes a priority. It is the only option that actually lets a
   user *be themselves* in another company's Slack. Treat it as its own initiative (own Slack app,
   encrypted per-user token store, a user-scoped Slack client layer), with the org-switcher rail
   already in place as the entry point.

Avoid Option C as the primary answer — Slack's iframe blocking makes it a launcher, not a workspace.

**Sequencing:** the org-switcher rail + `OrgSwitcherContext` + `useRoomList` filter are deliberately
the seam both options plug into. Option B keys the filter per-bridge; Option A swaps the
`importIds` filter for a per-user external view. Either way the shell is done.

---

## 6. Effort summary

| Option | Meets founder goal? | Identity | Effort | Main risk |
| --- | --- | --- | --- | --- |
| A — per-user OAuth + bridge | **Yes** | Real user | **Large** | Token security, Slack app approval per org, rate limits |
| B — multiple bridge instances | No (shared/bot, firm-wide) | Bot/alias | Small–Medium | Just more shared mirroring; not personal |
| C — embedded / deep link | Partially (it's real Slack, but not *in* MatterChat) | Real user | Tiny (launcher) / N/A (true embed blocked) | Slack blocks iframing |

---

## 7. Open decisions for the founder

1. **Is the priority "personal multi-Slack" (Option A) or "firm mirrors several Slacks" (Option B)?**
   They're different products; today's slice is neither — it's "the firm's *one* bridged Slack."
2. **Identity model:** must the user post **as themselves** in the other Slack (→ A only), or is a
   bridged/alias mirror acceptable (→ B)?
3. **Who connects an external Slack** — the individual user (per-user OAuth, A) or an admin
   (settings, B)? This decides where the "Add a workspace" flow goes beyond today's admin deep-link.
4. **External Slack admin approval:** are we OK requiring *each* external workspace's admin to approve
   the MatterChat Slack app (unavoidable for A's user tokens)?
5. **Data boundary:** for A, external-Slack messages live in **per-user private** rooms (not shared
   firm rooms) — confirm that confidentiality model. (Mirrors the firm/Slack data-separation concern
   in the MatterChat-Slack-migration architecture.)
6. **Token storage & security:** per-user `xoxp` tokens are high-value secrets — confirm encrypted-
   at-rest storage and rotation/revocation expectations before building A.
7. **Scope of "channels":** all of the user's channels, only ones they opt-in, or DMs too?
