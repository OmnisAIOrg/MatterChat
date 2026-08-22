# ⛔ THIS REPO IS FROZEN — 2026-08-16

**Do not build features here.** MatterChat is being rebuilt as the `chat` module inside **Omnis Voice**.

- **The plan:** `~/omnis-voice/docs/superpowers/specs/2026-08-16-matterchat-chat-module-design.md`
- **Repo it lives in now:** `OmnisAIOrg/omnis-voice` (local: `~/omnis-voice`)

## Why

MatterChat has **no customers yet**. That removes every reason to keep investing in this fork:

- No data to migrate, no users to avoid disrupting, no parity obligation.
- The ceilings here are permanent: realtime fan-out is an in-process `EventEmitter`, and the
  cross-instance implementation was Rocket.Chat enterprise code deleted in the EE strip — so **replicas
  can never exceed 1** without building a broker. Plus 741 unfixable baseline TypeScript errors and a
  Meteor 3.4.1 platform with 63 Meteor packages.
- Omnis Voice already has what this fork can never have: `organizationId` as a first-class column on all
  110 entities — **tenancy by construction**, which is what a legal product actually needs. Plus audit
  log, legal hold and retention policy, which are enterprise-only in Rocket.Chat.

This fork was a prototype and it did its job. What we learned from it is in the new spec.

## What this repo is still for

**Demos only.** Keep it running. Change nothing.

## Explicitly do NOT do these, even though earlier notes ask for them

- The three F9 "Ask Anything" wirings (search tools, settings registration, indexer hook)
- Live-server verification of the crons and Mongo-backed stores
- The cross-instance broker / `IBroker` replacement
- Firm-scoping gaps (`spotlight.searchRooms`, `teams.ts`)
- Anything in `docs/design/MATTERCHAT-PARITY-ATLAS.md` — that document is a **reference for what the fork
  does**, not a plan. The 11-unit parity programme it describes is abandoned.

## State when frozen

- Branch `feature/omnis-widgets`, **11 commits committed locally but never pushed**, on top of `2f4ec3296e`.
- Nine features built and unit-tested (F1–F9), never run against a live server.
- Production is a separate, older image and is unaffected by anything uncommitted here.

## Worth salvaging as ideas, not code

Several fork features were good product thinking and should be considered for the new build once chat
lands: setup concierge with practice-area templates, email-verified domain auto-join, Catch Me Up,
notification triage, self-cancelling reminders, Firm Console, Ask Anything search. Open question 4 in the
new spec tracks this.
