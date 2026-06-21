# Design — Cross-Firm Legal-Trust Layer ("Omnis Counsel") — 2026-06-20

Detailed design for the cross-firm correspondence product: a verified, encrypted, court-grade messaging
network for attorney-to-attorney (incl. opposing-counsel) communication. Built per the cross-firm spike
([MATTERCHAT-CROSSFIRM-SPIKE.md](MATTERCHAT-CROSSFIRM-SPIKE.md)).

> ⚠️ Two parts of this design **require expert sign-off before build**: the **Rule 4.2 / consent model**
> (a legal-ethics advisor) and the **encryption + escrow model** (a security/cryptography review). Everything
> here is a proposed design for them to ratify, not a settled spec. *Not legal advice.*

Working name used below: **CFCS** = Cross-Firm Correspondence Service. (Product name TBD — "Omnis Counsel"?)

---

## 0. The one-paragraph version (plain language)
We build a **new, separate service** — not Rocket.Chat, not federation — that hosts **matter rooms**: secure
conversations tied to a specific legal matter, with members from two or more firms (e.g. you + opposing
counsel). Every member is a **verified attorney**. Every message is **encrypted**, and every action is written
to a **tamper-evident audit trail** you can **export as court-admissible evidence**. The firm holds its own
decryption key (so the *firm*, not us, produces its data under a subpoena/hold). Identity + the attorney
directory live in **CentralizedAuth** (what we already use for login). Lawyers reach it from **MatterChat**.
The moat isn't the messaging — it's this **trust + compliance layer**, which no one has built for law.

---

## 1. Architecture decision (LOCKED by the spike)

**Cross-firm = a permissions+identity problem inside ONE multi-tenant trust domain.** A purpose-built service
(CFCS) owns all cross-firm matter rooms; firms are *tenants* inside it; an opposing-counsel room is a single
room whose membership spans two tenants, with strict access control. NOT Rocket.Chat federation (kills E2EE,
EE-locked, beta, deletion unenforceable). NOT one RC instance bent into multi-tenancy (800h+, leak risk).

```
                      ┌──────────────────────────────────────────┐
   Firm A's MatterChat │            CentralizedAuth                │  Firm B's MatterChat
   (intra-firm chat,   │  identity root · verified-attorney        │  (intra-firm chat,
    Rocket.Chat)       │  profiles · cross-firm DIRECTORY · OIDC   │   Rocket.Chat)
        │              └───────────────┬──────────────────────────┘        │
        │  SSO (OIDC keystone we built)│  SSO                              │
        ▼                              ▼                                    ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                  CFCS — Cross-Firm Correspondence Service                  │
   │  multi-tenant (firm = tenant) · encrypted + per-firm key ESCROW           │
   │  matter rooms (membership spans firms) · Rule 4.2 guardrails ·            │
   │  tamper-evident AUDIT (hash-chained) · defensible EXPORT · legal HOLD ·   │
   │  ethical walls / conflict screening                                       │
   └─────────────────────────────────────────────────────────────────────────┘
        ▲ links matter rooms ↔ CasePro matters (conflict registry, matter meta)
```

**Why a new service (not inside RC):** RC's client/data model fights multi-tenancy + the clean security model
this needs; building CFCS focused is *smaller and safer* than bending RC. RC stays the best-in-class
**intra-firm** chat; CFCS is the **cross-firm** network. They meet at the client (see §2) and at identity (§3).

---

## 2. Client surface — how lawyers reach it (OPEN DECISION, rec below)
The founder's vision is "through MatterChat." Two delivery options:
- **(rec) Standalone-backend-first, MatterChat-integrated:** build CFCS backend + a clean, minimal CFCS web
  client to nail the legal-trust UX/security; then surface cross-firm matter rooms **inside MatterChat's left
  rail** as a "Cross-firm" section (a thin embed/bridge to CFCS) so it's delivered "through MatterChat."
- **MatterChat-embedded-first:** build the cross-firm UI directly into the RC client from day one. Tighter to
  the vision, but fights RC's client complexity + makes the security model harder to get right early.

**Recommendation:** standalone backend + minimal client first (prove the trust core fast, clean security),
MatterChat rail integration as the very next step. End state = "through MatterChat," reached safely.

---

## 3. Component 1 — Verified-attorney identity + directory (extends CentralizedAuth)
CentralizedAuth is already our identity root (better-auth + Postgres, multi-org). Extend it:

**Attorney profile** (new): `bar_admissions[] {state, bar_number, status}`, `firm_id`, `verification_level`,
`discipline_status`, `directory_visibility`. (Note heterogeneity: NY has no public "bar number" → an OCA
registration #; ~6 states have no online lookup.)

**Verification pipeline** (gate cross-firm messaging on `bar-verified`+):
1. **Firm-domain / email** (org signal) — DNS TXT or `@firm.com` OTP. Proves org, not license.
2. **Per-state bar/court lookup** (positive license status) — pluggable **state adapters** (API where it
   exists; scrape where it doesn't; queue for manual where neither). Start with a few launch states.
3. **ABA discipline data-bank cross-check** (negative signal — discipline only, no API → periodic/manual).
4. **Manual review fallback** for no-lookup states + edge cases.
→ yields a **trust level**: `unverified → email-verified → bar-verified → fully-verified`.

**Cross-firm directory:** searchable index of opted-in verified attorneys (name, firm, jurisdictions). Invite
by **bar # / email / directory search**. Privacy controls (discoverable yes/no; firm-level policy). This
directory is the **network-effect engine** (Symphony's 1,300-counterparty directory is the proven analog).

---

## 4. Component 2 — Rule 4.2 + consent / invite model (NEEDS legal-ethics sign-off)
Rule 4.2 forbids a lawyer from communicating with a *represented* party directly — only with their counsel.
The product must make the *right* thing easy and the *wrong* thing hard.

- **Representation tagging:** each matter room records, per side, *which attorney represents which party*, and
  whether a party is represented/unrepresented. Clear UI indicators of who is opposing counsel.
- **Routing rule (default):** **attorney ↔ attorney only.** You can invite/contact opposing *counsel*; you
  **cannot** add or direct-message a *represented opposing party*. (The rule binds the lawyer, not the parties.)
- **Invite/accept = explicit consent** to connect on this matter: A invites B (with matter context) → B
  accepts → room active. Either side may leave/revoke. Default **no implied consent**.
- **Per-state configurable:** the "cc-your-client ⇒ reply-all consent" presumption is **split by state**
  (WA/CA/AK/NJ/PA/SC/NC went the other way) → make it a per-jurisdiction setting, not hard-coded.
- **Guardrails:** warn/block before adding anyone flagged as a represented party; log every consent event.

---

## 5. Component 3 — Tamper-evident audit + defensible export + legal hold (the "safer than email" moat)
- **Audit log:** **append-only, hash-chained** (each event stores `prev_hash` + its own `hash`, optionally
  signed) → tampering is detectable. Captures: room create; membership invite/accept/leave/**screen**; message
  send/edit/delete (deletes = tombstones, content retained unless purged); file up/download; consent events;
  holds attach/release; **exports**.
- **Defensible export:** full matter-room record — messages (content + metadata: sender, firm, timestamps,
  edit history, tombstones), participants + representation, files (with content hashes), and the **audit chain**
  — in standard e-discovery formats (load file / PDF + native + metadata) with a **chain-of-custody
  attestation**. This is the feature that makes it *evidence-grade*, beating email.
- **Legal-hold mode:** attaching a hold (scope = firm / matter / custodian) **immediately suspends** all
  deletion, disappearing-message, and retention-purge for in-scope data; marks it held; logs it. Release
  requires authorization + is logged. (Directly answers FRCP 37(e) spoliation — *Waymo*, *FTC v. Amazon*,
  SEC off-channel fines.) **First-class feature, not an afterthought.**
- **Retention policies:** per-firm / per-matter, configurable; **holds always override** retention.

---

## 6. Component 4 — Encryption + escrow (NEEDS security/crypto review)
**The tension:** pure end-to-end encryption (only endpoints can read) gives max privacy but **breaks**
server-side audit/export/search and legal-hold production. Plaintext gives producibility but weak privacy.

**Proposed middle (defensible for legal):** **encrypted in transit (TLS) + at rest; content encrypted under
per-matter-room keys; those keys wrapped/escrowed under a PER-FIRM key the FIRM controls** (KMS/HSM-backed).
Implications:
- Day-to-day platform access to plaintext is minimized (encrypted at rest, access-controlled, audited).
- **For holds/subpoenas, the FIRM decrypts and produces its own data** — privilege stays with the firm, the
  platform's liability + plaintext exposure shrink, and production is still possible. (This is the "privacy AND
  producibility" resolution.)
- **Metadata** (who-talked-to-whom, when) is visible to the operator even when content is encrypted → minimize
  + protect it; **vendor-subpoena notification** so a firm can move to quash.
- True client-side E2EE can be a **later premium option** for specific high-sensitivity matters, accepting it
  disables server-side export/search for those rooms (the same trade RC federation forces — but here it's an
  opt-in per-matter choice, not a blanket loss).

---

## 7. Component 5 — Ethical walls / conflict screening
- **Matter-level access control:** membership is explicit; only added attorneys see a room + its history.
- **Screening (ethical wall):** a firm can screen specific lawyers/staff off a matter — enforced technically
  (no access, hidden from member lists + search) **and logged with timing** (provable, timely screen).
- **Conflict-check hooks:** adding an attorney triggers a check against the firm's **conflict registry**
  (integration point with **CasePro**/matter system) → flag or block conflicted additions.

---

## 8. Composition with the existing stack
- **CentralizedAuth** — identity root: verified-attorney profiles + directory + SSO (reuse the OIDC keystone we
  already built). One identity spans a lawyer's firm(s) (multi-org already supported).
- **MatterChat (RC)** — stays the intra-firm chat; gains a "Cross-firm" rail section that surfaces CFCS matter
  rooms (the "through MatterChat" delivery). No RC multi-tenancy or federation needed.
- **CasePro** — matters are the organizing unit: a CFCS matter room links to a CasePro matter
  (`linked_casepro_matter_id`); conflict registry + matter metadata flow from CasePro. (Reuses the
  channel↔matter linking concept from PR #3.)
- **Standalone principle preserved:** MatterChat works without CFCS; CFCS enriches it. CasePro/Depo integrations
  are additive.

---

## 9. Data model sketch (CFCS, new multi-tenant store)
- **firm** (tenant): `id, name, domains[], retention_policy, escrow_key_ref`
- **attorney** (→ CentralizedAuth user): `id, ca_user_id, firm_id, bar_admissions[], verification_level,
  discipline_status, directory_visible`
- **matter_room:** `id, title, originating_firm_id, linked_casepro_matter_id?, status, retention_state,
  hold_state, room_key_ref`
- **representation:** `matter_room_id, attorney_id|firm_id, represents_party_label, party_type(repr/unrepr)`
- **membership:** `matter_room_id, attorney_id, role, state(invited/active/left/screened), consent_event_id`
- **message:** `id, matter_room_id, sender_attorney_id, ciphertext, metadata{ts, edits[]}, tombstone?`
- **file:** `id, matter_room_id, content_hash, ciphertext_ref, metadata`
- **audit_event:** `id, scope{firm?/matter?}, actor, type, payload_hash, prev_hash, hash, signature, ts`
- **legal_hold:** `id, scope, reason, attached_by, attached_at, released_at?, active`
- All firm-scoped tables enforce **row-level tenant isolation**.

---

## 10. Phased build plan
- **Phase 1 — design + ratify (this doc + expert sign-off).** Lock §4 (4.2) with counsel, §6 (crypto) with
  security; pick launch jurisdictions + client surface (§2) + open decisions (§11).
- **Phase 2 — thin vertical slice:** verified-attorney invite → ONE cross-firm matter room between two test
  firms → encrypted messages → hash-chained audit log → defensible export. Proves the *trust core*, not chat.
- **Phase 3 — compliance depth:** legal-hold mode, ethical walls + conflict hooks (CasePro), metadata scrub,
  per-state config, per-firm escrow key management.
- **Phase 4 — network + delivery:** directory + invite-by-bar-#, MatterChat rail integration ("through
  MatterChat"), mobile, litigation-beachhead go-to-market.

---

## 11. Open decisions (need founder / counsel)
1. **Client surface** — standalone-first vs. MatterChat-embedded-first (rec: standalone backend + minimal
   client, then MatterChat rail).
2. **Encryption model** — escrowed/firm-held keys for v1 (rec), with opt-in true-E2EE per-matter later?
3. **Verification bar** — gate messaging at `bar-verified`? Which **launch states** (start with high-volume
   litigation states)?
4. **Jurisdiction scope at launch** — per-state config is core; pick the first 2–3 states.
5. **Tenancy/hosting** — multi-tenant SaaS default + optional dedicated tenant for firms that demand it?
6. **Expert engagement** — bring on a **legal-ethics advisor** (4.2/privilege/escrow) and a **security
   reviewer** (crypto/escrow) before build. (Strongly recommended — these are liability-bearing.)

---

## 12. Confidence / honesty
- **High confidence:** the architecture choice (single trust domain, not federation), the moat being the
  trust/compliance layer, the audit/export/hold being the wedge.
- **Needs expert ratification (do not build without):** the Rule 4.2 model (counsel) and the encryption+escrow
  model (security). These are the two highest-liability designs here.
- **Real ongoing work, not a lookup:** per-state attorney verification.
- The market read (greenfield, litigation wedge) is strong but is still a read — your legal-market judgment
  governs.
