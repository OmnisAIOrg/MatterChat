# Spike — MatterChat multi-workspace + external Slack (2026-06-20)

**Goal:** a user can (A) **add/switch between multiple MatterChat workspaces** (different companies/orgs),
and (B) **connect external Slack workspaces** (e.g. has Slack at Company A, MatterChat at Company B).

This is a design spike (findings + options + recommendation), not implementation.

---

## The core architectural truth
MatterChat is a **Rocket.Chat fork, and RC is single-workspace per instance** — there is **no org/tenant
dimension** anywhere in the data model (Users, Rooms, Subscriptions, Settings are all instance-global;
confirmed in core-typings). So "multiple workspaces" does **not** mean one instance hosting many isolated
companies. Making one instance multi-tenant = adding `orgId` to every model + filtering every query + blocking
cross-org DMs/search = an **800–1000h core rewrite with real data-leak risk. Do not do this.**

⇒ **"Multiple MatterChat workspaces" = one MatterChat instance per company + a switcher to hop between them.**
(Same model as Slack itself: each workspace is its own backend; the client switches between them.)

---

## (A) Switch between multiple MatterChat workspaces

| Option | Verdict | Effort |
|---|---|---|
| **Per-org instances + switcher** (one MatterChat per company) | ✅ **Recommended** | low–med |
| Teams-as-workspaces (reuse RC Teams inside one instance) | ❌ Not viable — Teams are channel groupings, NOT isolated tenants; DMs/search/users leak across; ~800h to fix | — |
| Matrix federation | ❌ Not a switcher — it bridges instances to the Matrix network (remote rooms), doesn't let a user "switch" workspaces | — |
| One instance, true multi-tenant | ❌ 800–1000h rewrite, data-leak risk | — |

**How the switcher works (Recommended):**
- **Desktop app — already native + free.** The official Rocket.Chat Desktop app has a left-rail **multi-server
  switcher**: add each company's MatterChat URL, jump between them. Zero build. (This is what the founder saw
  when asking about a "desktop app".)
- **Web — needs a small build.** The web client has no switcher. Build an **org-picker** powered by
  CentralizedAuth (which already knows every org a user belongs to — confirmed): on login, if the user is in
  >1 org, show a workspace chooser that routes them to the right MatterChat instance (per-org subdomain).
  ~100–200h of glue (org-list fetch + picker UI + instance routing). No core refactor.

---

## (B) Connect an external Slack workspace

**RC already ships a `SlackBridge`** (`apps/meteor/app/slackbridge/`) that does **bidirectional live sync** with
a **real external Slack workspace** — messages, threads, edits, deletes, reactions, files, channel mapping —
via the modern Slack **Bolt + Socket Mode** API (the legacy RTM path is deprecated by Slack, don't use it).

| Capability | Today (SlackBridge) |
|---|---|
| Connect a real external Slack workspace | ✅ Yes (admin pastes a Slack App's Bot/App tokens + signing secret) |
| Two-way live sync (msgs/reactions/files/threads) | ✅ Yes |
| Multiple Slack workspaces | ⚠️ Partial — supports newline-separated token sets, but no UI and channel-name collisions |
| **Per-user "Connect your Slack" (OAuth, self-service)** | ❌ No — it's **admin-level / instance-wide**, no OAuth flow |

**So:** an admin can connect an external Slack workspace into a MatterChat instance **today**. The gap vs. the
founder's phrasing ("if the *user* has Slack…") is **per-user self-service**: a "Connect Slack" button + Slack
OAuth + per-user token storage + per-workspace channel namespacing. That's a real build (~200–260h).

---

## Recommendation — phased

**Phase 0 — validate with what exists (days, ~0 build).** Use the **Desktop app's multi-server switcher** for
multi-workspace, and **admin SlackBridge** to connect one external Slack workspace to a test MatterChat. Confirms
the whole experience end-to-end before building anything.

**Phase 1 — web workspace switcher (~100–200h).** CentralizedAuth-driven org-picker → routes a multi-org user to
the right per-company MatterChat instance. Makes "multiple MatterChat workspaces" work in the browser, not just
desktop. No core refactor; full data isolation (separate instances).

**Phase 2 — self-service Slack connect (~200–260h).** Add a per-user "Connect Slack" OAuth flow on top of
SlackBridge (per-user tokens, per-workspace channel namespacing, dedup). Only if per-user (vs admin) Slack
connect is required.

**Explicitly NOT recommended:** making one MatterChat instance multi-tenant (Teams-as-workspaces or orgId
everywhere) — 800h+ and data-leak risk for no benefit over per-org instances.

**Ties into work already done:** per-org instances pair naturally with the **OIDC SSO** (CentralizedAuth knows a
user's orgs → can route/switch) and the **Alpha per-PR previews** (each is already its own instance). The
Slack *import* (one-time migration, PR #2) and Slack *bridge* (live connect) are complementary: import to move a
team in, bridge to keep a foot in an external Slack.
