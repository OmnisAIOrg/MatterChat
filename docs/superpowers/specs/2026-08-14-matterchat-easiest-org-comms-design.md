# MatterChat: the easiest org communication app

**Date:** 2026-08-14
**Status:** Approved for build (all three phases)
**Branch:** `feature/omnis-widgets` → feature branches per phase

## Goal

Make MatterChat the easiest communication app a law firm can adopt. "Easiest"
is decided on three fronts, in priority order:

1. **A new org** goes from signup to a working, populated workspace in minutes.
2. **Everyday staff** never lose track of a matter, and never tune settings.
3. **Admins** run the firm in plain English instead of a settings maze.

The winning angle is **Chi does the work**. Every feature below either removes a
step or hands it to the assistant. Where a competitor adds a settings page, we
add a sentence you can say to Chi.

## Tenancy decision

This spec assumes the **hardened shared workspace**: one deployment per
environment (`app.matterchat.com`, `matterchat.stg-omnisai.io`), many firms
inside it, isolation enforced by firm scoping. Per-org instances remain a future
option; nothing here blocks that migration, because every feature keys off
`firmId` rather than assuming a global workspace.

This choice carries an obligation. The July 2026 audit found firm scoping was
described in-repo as "a privacy measure, not an isolation guarantee". Shipping
onboarding that invites whole firms in means the guarantee has to become real.
Phase 1 therefore treats scoping gaps as acceptance criteria, not follow-ups.

## Architecture

Four extension points already exist in the fork. Everything below uses them;
none of it invents a new pattern.

| Concern | Where it goes | Why |
|---|---|---|
| Org/firm logic | `server/lib/firms/` | Existing home of `createFirm`, `adoptUserIntoFirm`, scoping |
| Identity / SSO | `app/omnisai-oauth/server/` | Existing home of OIDC login, `ensureFirmForOrg` |
| Assistant behavior | `server/lib/chi/admin/` | Existing tool registry, confirm gate, audit log |
| Fork-owned storage | raw `db.collection()` per `server/models/FirmFeed.ts` | Avoids editing upstream model barrels, keeping merge surface small |

Two rules hold across all phases:

**New capability is a Chi tool before it is a screen.** A tool added to the
registry is immediately reachable from the orb, the DM, mobile, and desktop
without touching four clients. Screens are added only where a tool is a poor fit
(a settings surface, a wizard).

**Every mutation is caller-scoped, confirm-gated, and audited.** Chi acts with
the calling user's permissions, never elevated. Destructive or bulk actions pass
the existing confirm gate and land in `#chi-audit`.

### Testing strategy

The fork's CI has long-standing debt (hundreds of pre-existing type errors, a
unit-test runner that short-circuits before `apps/meteor`). Chasing zero is not
achievable and not the bar. The bar is:

- **Typecheck:** error count at or below the measured pre-change baseline, and
  zero errors in files this work touches.
- **Unit tests:** new server logic gets specs that actually run. Because
  `jest.config.ts` uses an explicit `testMatch` allow-list, every new spec path
  must be added to it or it silently never runs.
- **Lint:** clean on touched files; blast radius deliberately contained (do not
  rename shared types to satisfy a rule — it drags unrelated packages into scope).
- **Behavioral:** every endpoint exercised against a running server, and every
  UI control clicked, before a phase is called done.

---

# Phase 1 — the front door

## F1. Chi Setup Concierge

**Problem.** A new firm's admin lands in a Rocket.Chat workspace and must invent
a channel structure, invite people one at a time, and guess at settings. Worse,
the audit found the second firm to ever sign up hits a structural dead-end:
only the first-ever workspace user is auto-promoted to admin, so org #2's owner
can never trigger their own roster mirror.

**Solution.** Replace the bare "create your firm" step with a guided concierge
that collects a little and executes a lot.

Structured cards collect: firm name, practice areas (multi-select from a legal
taxonomy, plus free text), and teammates (paste emails, upload CSV, or — for SSO
users — pull the CasePro roster). Free text collects anything nonstandard: a
"tell Chi what you need" field routes to the assistant, so an unusual request
never dead-ends.

Chi then executes in one transaction-like sequence, narrating each step:
creates the firm, seeds channels from the practice-area template, sets the
firm's default channel, sends invites, and posts a welcome message summarizing
what it built and what to do next.

**Structural fixes folded in as acceptance criteria:**

- Every user created or adopted through any path carries
  `customFields.firmId`. This includes the OIDC auto-provision path, which
  previously created accounts with no firm stamp.
- Firm ownership is per-firm (`customFields.firmRole = 'owner'`), not
  "first user on the workspace". The Nth firm onboards exactly like the first.
- The two org models converge: self-serve `createFirm` and SSO
  `ensureFirmForOrg` both go through the same primitives, so a firm created
  either way is indistinguishable afterwards.
- The CasePro roster pull declares its deployment prerequisites
  (`MATTERCHAT_PROVISION_KEY`, `OMNISAI_OIDC_ISSUER`) and reports a clear error
  when unset, rather than silently doing nothing.

**Channel templates.** A practice area maps to a channel set. Personal injury
seeds `#intake`, `#litigation`, `#medical-records`, `#settlements`. Every firm
also gets `#general` and `#random`. Templates are data, not code, so adding a
practice area is a one-line change.

## F2. Zero-friction join

Three ways into the right firm, none requiring an admin to shepherd them.

**Domain auto-join.** A firm owner claims an email domain. Verification is an
email loop to an address at that domain — no DNS records, because the target
user is an office manager, not a sysadmin. Once verified, anyone signing up with
a matching address is adopted into that firm automatically on first login.
Domains are globally unique; a claim on an already-claimed domain is refused.
Public email providers (gmail.com, outlook.com, …) are permanently blocked from
being claimed, since claiming gmail.com would capture unrelated signups.

**Hardened invite links.** The existing 15-day unlimited-use links gain expiry
choice, a maximum-uses cap, and revocation. Managed in plain language through
Chi ("revoke every invite link we've ever made") as well as in the Firm Console.

**QR handoff.** The concierge's final card and the Firm Console show a QR code
that opens the iOS app pointed at this workspace with the invite pre-applied,
so a phone gets set up without typing a server URL.

## F3. Self-hosted push notifications

**Problem.** The fork is unregistered with Rocket.Chat Cloud and the enterprise
modules were stripped, but `Push_gateway` still defaults to
`https://gateway.rocket.chat`. That gateway would not deliver to our
`com.omnisai.matterchat` bundle id even if we could reach it. Mobile
notifications therefore do not work, which makes "easiest" indefensible on the
surface where most urgency lives.

**Solution.** Send directly. Token-based APNs using a `.p8` key under Apple team
`P8S9U28C8B`, and FCM v1 for Android. Configuration is server settings, with
the key material supplied as a deployment secret rather than pasted into the
admin UI.

Scope note: this is infrastructure, not a Chi feature, but it is Phase 1 because
F1 and F2 deliver people onto a mobile app that would otherwise stay silent.

**Done means:** a message to a user produces a banner on a locked iPhone in
under five seconds, verified on staging.

---

# Phase 2 — everyday staff

## F4. Catch Me Up

A per-channel "what did I miss?" that summarizes unread activity into a few
bullets, each linking to the message it came from, so the summary is a
navigation surface rather than a wall of text. Available from the channel
header, from the orb, and on mobile.

An opt-in morning brief DMs the same treatment across everything unread, once a
day at a chosen local time. Off by default; a daily unsolicited DM is a cost, and
the user should choose to pay it.

Summaries are generated on demand and cached briefly, keyed by channel and read
position. Nothing is precomputed for users who never ask.

## F5. Smart notifications

Chi triages. Genuinely urgent things interrupt immediately; everything else
collects into a digest delivered on a cadence the user picks.

Rules are stated as sentences — "only interrupt me for the Hernandez matter",
"nothing after 7pm unless it's from a partner" — parsed into stored structured
rules. The stored rules are visible and editable as a plain list, because a rule
you cannot see is a rule you cannot trust.

Defaults stay conservative: direct mentions and DMs always interrupt unless
explicitly silenced. A triage system that hides something important once loses
the user permanently, so the failure mode is biased toward interrupting.

## F6. Reminders and follow-ups

"Remind me about this Thursday" on any message or thread. Beyond simple timers,
the useful case is conditional: "nudge me if opposing counsel hasn't replied by
Friday" — a reminder that cancels itself when the condition resolves, so it
stays quiet when the thing you wanted to happen happened.

Reminders are stored per-user, fire through a scheduled job, and are listable
and cancelable through Chi and a compact list surface.

---

# Phase 3 — admins

## F7. Chi Admin Copilot v2

Extends the existing admin tool registry with the operations a firm owner
actually performs: bulk channel membership ("add Jane to every litigation
channel"), activity reporting ("who hasn't logged in this month"), channel
export, deactivation and role changes.

Everything runs with the caller's own permissions, passes the existing confirm
gate before mutating, and is written to the audit log. A firm owner can only
ever act within their own firm; workspace-wide actions remain restricted to
workspace admins.

## F8. Firm Console

One screen a firm owner can understand: firm name and logo, member list with
roles, invite links, claimed domains, notification and channel defaults. It
replaces, for the 95% case, a trip into Rocket.Chat's administration area — an
interface built for server operators that reliably intimidates the office
manager who ends up owning it.

Scoped strictly to the firm. Nothing on this screen can affect another firm or
the workspace.

## F9. Ask Anything search

Semantic search across messages and files with citations: "what did we decide
about the deposition date?" returns an answer plus the messages it came from.

This is the largest single lift in the spec because it needs an embedding index
maintained as messages arrive, and it is sequenced last for that reason. It is
also the feature most likely to justify the whole product, so it is in scope
rather than deferred: search is where people give up on chat apps.

Indexing is firm-scoped at the storage layer, not filtered at query time. A
retrieval system that fetches across firms and filters afterward is one bug away
from a cross-firm leak.

---

## Risks and how each is handled

**Fork merge surface.** Every file changed is a future merge conflict against
upstream Rocket.Chat. Mitigation: new code lives in fork-owned directories;
upstream files get the smallest possible hook (a single import or callback
registration) rather than inline logic.

**Firm isolation is not yet a guarantee.** Onboarding whole firms raises the
stakes on scoping gaps. Mitigation: Phase 1 carries isolation fixes as
acceptance criteria, and F9 indexes per firm rather than filtering per query.

**Chi acting beyond its authority.** Mitigation: caller-scoped permissions,
confirm gate on mutations, audit log — all existing mechanisms, uniformly
applied to new tools.

**LLM cost and latency.** Summarization and triage are per-user, per-day
recurring costs. Mitigation: on-demand generation with short-lived caching, no
precomputation for inactive users, opt-in for anything recurring.

**CI debt hiding real regressions.** Mitigation: measure a baseline before
changing anything, compare against it, and require zero errors in touched files.

## Out of scope

Per-org instances, billing and seat management, federation, voice/video changes,
and Android release engineering (the FCM server path is built; shipping an
Android app is not).
