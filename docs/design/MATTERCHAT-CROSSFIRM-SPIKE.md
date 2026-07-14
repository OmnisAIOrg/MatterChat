# Spike — Cross-firm legal messaging ("premier legal comms platform") — 2026-06-20

Two questions: (1) build our own vs. stay on the RC fork; (2) opposing-counsel / cross-firm messaging.
Grounded in code exploration of the fork's federation + web research (sources in the research brief).
*General information, not legal advice — validate ethics rules with counsel before launch.*

---

## Headline (revises my earlier take)
Earlier I said "federation is the enabler, so stay on RC." **The deeper look found a dealbreaker for the
legal use case: in Rocket.Chat, E2E encryption and federation are mutually exclusive** — a federated room
**cannot** be end-to-end encrypted (RC's own docs). For a legal product, the cross-firm rooms are exactly the
ones carrying privileged content, so losing E2EE there is close to disqualifying. Add that RC federation is
**100% Enterprise-licensed**, **beta (v0.1.x)**, and that **deletion/erasure is unenforceable across
federation** ("gentlemen's agreement," per matrix.org). ⇒ **Do not build cross-firm on RC/Matrix federation.**

## The recommended architecture
**Cross-firm = a permissions + identity problem inside ONE trust domain — not a mesh of federated servers.**
A single OmnisAI-hosted platform where "Firm A" and "Firm B" are tenants, and an opposing-counsel room simply
spans two tenants with controlled membership. This **preserves encryption, audit, retention, and deletion
control**, and is far lighter to operate than every firm running a homeserver.
- Within-firm chat: **keep Rocket.Chat** — it's great and already built; rebuilding it is a multi-year waste.
- Cross-firm: a **purpose-built secure-correspondence layer** (verified directory + controlled rooms + audit),
  NOT RC federation. (RC is single-tenant per instance, so true multi-tenant cross-firm is net-new build either
  way — but a focused cross-firm layer is far smaller than "rebuild Slack.")
- **Encryption vs. producibility tension (important):** pure E2EE (nobody can read) conflicts with
  court-ordered export / legal hold. The legal answer is **encrypted + per-firm key escrow / lawful-access for
  holds** — privacy AND defensible production, not one or the other.

## Build-our-own? — reconciled answer
**No, don't rebuild the chat engine** (RC handles intra-firm chat, mobile/desktop, files, search). **Yes, build
the cross-firm legal-trust layer as a new focused product** — that IS the differentiator. So it's not
"fork vs. rebuild everything"; it's "RC for intra-firm + a purpose-built cross-firm legal network."

## The moat = the legal trust layer (greenfield)
The transport is a commodity. **No vendor markets cross-firm opposing-counsel messaging — the status quo is
email.** The defensible, unbuilt layer:
1. **Verified-attorney identity + directory** (invite by bar #/firm email) — solves the "both sides must already
   be on it" cold-start. (No national API: per-state bar lookups + firm-domain verification + ABA discipline
   cross-check + manual fallback. Real per-state work.)
2. **Rule 4.2-aware invite/consent** — attorney↔attorney routing by default; block/guard messaging a *represented
   party*; per-state-configurable consent (the "reply-all = consent" rule is jurisdictionally split).
3. **Court-grade, tamper-evident audit + defensible export** (content+metadata+participants+timestamps, chain of
   custody) — makes it *safer than email* for litigation.
4. **Legal-hold mode** that suspends auto-delete/disappearing messages the moment a hold attaches (spoliation /
   FRCP 37(e) — *Waymo v. Uber*, *FTC v. Amazon*, SEC off-channel fines). First-class, not an afterthought.
5. **Ethical walls / conflict screening** — technically wall off conflicted lawyers from a matter + prove it.
6. **Metadata scrubbing** on attachments (Rule 4.4 / inadvertent disclosure) + vendor-subpoena notification.

## Wedge / positioning
Not "another secure chat app" → **"email replacement for opposing-counsel correspondence, with court-admissible
audit + verified attorney identity."** Beachhead = **litigation** (clear adverse pairs, frequent correspondence,
high stakes on the record). Analog: **Symphony** did exactly this for finance (1,300+ counterparties, network
effect via a verified directory) — no one has done it for law.

## Top risks
1. RC federation E2EE conflict (→ don't federate; single trust domain). 2. Rule 4.2 liability if the product
makes messaging a represented party easy (→ hard guardrails). 3. Spoliation/retention (→ legal-hold + export
first-class). 4. Verified-identity = real per-state integration (no national API). 5. Two-sided cold-start
(→ frictionless verified invite; litigation pairs). 6. Metadata/social-graph exposure even with E2EE (→ SOC2/
ISO27001, subpoena notice, optional dedicated tenancy). 7. Jurisdictional fragmentation (→ per-state config a
core principle). 8. Standards drift: MLS/MIMI (IETF) is the future cross-provider-interop path but draft-stage —
watch, don't build on it yet.

## Suggested phased path
- **Phase 1 — decide + design:** lock the architecture (single multi-tenant trust domain, encrypted + escrow),
  and the identity/Rule-4.2/audit model. (Design, not code.)
- **Phase 2 — thin vertical slice:** verified-attorney invite → a single cross-firm "matter room" between two
  test firms → tamper-evident audit log + defensible export. Prove the *legal-trust* core, not the chat.
- **Phase 3 — legal-hold + ethical walls + metadata scrub; per-state config.**
- **Phase 4 — directory + network growth (litigation beachhead).**
Intra-firm MatterChat (RC) continues in parallel; the cross-firm layer is the new product.
