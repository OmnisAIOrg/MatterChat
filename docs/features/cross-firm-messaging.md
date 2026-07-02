# Cross-Firm Secure Messaging (for Firm Admins)

> Status: **live** on staging (the `/_crossfirm` proxy, cross-firm panel, export, legal hold, and screening are merged and deployed). Items enforced by the separate CFCS trust service are labeled below; the two-firm demo needs a second firm instance — see "Current limitations".

## What it is

Cross-firm secure messaging lets attorneys at *different* firms communicate about a shared matter inside dedicated, governed **matter rooms** — instead of over open email. It is built as a trust layer with three parts:

1. **MatterChat UI** — a Cross-Firm panel (balance-scale icon in the room toolbar) where you create matter rooms, invite opposing counsel, message, screen members, place holds, and export.
2. **A same-origin security proxy (`/_crossfirm`)** — every cross-firm request leaves the browser to MatterChat's own server, which verifies *who you are* server-side (your OmnisAI-verified identity; the browser can neither see nor forge it), strips any spoofable headers, stamps an unforgeable caller identity and firm identity, and forwards only allow-listed routes to the trust service. Expired sessions are rejected.
3. **The CFCS trust service** — a separate backend (not part of the MatterChat codebase) that hosts the matter rooms and enforces the trust rules between firms.

## Who it's for

Firm admins and the attorneys they authorize to communicate with opposing/co-counsel: settlement discussions, discovery coordination, joint-defense groups.

## What you can do today

- **Create a matter room** scoped to a matter, from the Cross-Firm panel.
- **Invite opposing counsel** — invitations are attorney-to-attorney (the panel warns that rooms are attorney-to-attorney only) and record which party each attorney represents, supporting Rule 4.2 (no-contact rule) compliance workflows. Invitees explicitly accept before joining.
- **Message** within the matter room.
- **Screen members (ethical walls)** — mark a member of your own firm as screened; a `screened` badge shows on the member list.
- **Legal hold** — place or release a hold on a matter room; a `HOLD` badge shows while active.
- **Export the room** — one click downloads the full record with an integrity check: the export reports its message count and whether the tamper-evident audit chain verified.

## Identity: how "verified attorney" works

You sign in to MatterChat with your OmnisAI account (OIDC). The server — never the browser — derives your verified identity and presents it to the trust service on every call. A dedicated endpoint (`/api/v1/cross-firm.identity`) lets the panel display your server-verified identity. Attorney credentialing (bar-status verification) is a function of the OmnisAI identity layer and the CFCS trust service, not of the chat client **(pending verification: bar-lookup verification is designed but its live enforcement lives outside this codebase)**.

## Message protection

- **In transit:** all cross-firm traffic is TLS, browser → MatterChat proxy → trust service (internal network).
- **At rest:** the design places matter-room content encryption in the CFCS trust service under per-matter keys with firm-held escrow — *not* device-held keys, so a firm can always produce its own records **(pending verification: content encryption is implemented in the CFCS service, outside the MatterChat codebase; MatterChat itself does not encrypt or decrypt matter-room content)**.
- **Rule 4.2 enforcement** (blocking contact with represented parties without consent) is enforced by the trust service; MatterChat's UI carries the consent/representation workflow **(pending verification for the server-side enforcement, same reason)**.

## The two-firm demo

The demo scenario shows the full loop between two firms: Firm A's attorney creates a matter room, invites a verified attorney at Firm B with representation declared, Firm B accepts, both sides exchange messages, a hold is placed, and either firm exports the tamper-evident record.

**Current limitation:** staging runs a single firm ("Apex Law LLP"), so the panel, identity, and room creation are demonstrable today, but a *live* two-firm exchange needs a second firm instance (or a strict-mode-compatible seed path). The demo is therefore **in progress**, not click-through-able on staging yet.

## Admin setup

In **Administration → Settings** (OmnisAI section):

| Setting | Purpose |
|---|---|
| `CrossFirm_Enabled` (default off) | Shows/hides the Cross-Firm panel |
| `CrossFirm_CFCS_URL` | Where the trust service lives (overrides the `CFCS_API_URL` environment variable) |
| `CrossFirm_Firm_Name` | Your firm's identity, stamped on every outbound cross-firm call |

OmnisAI sign-in must be configured (identity is derived from it).

## FAQ

**Is this end-to-end encrypted like Signal?**
No, deliberately. The trust model is *firm-key escrow*: your firm can always access and produce its own matter records (a professional-responsibility requirement), which device-held E2E keys would break.

**Can a non-attorney be invited?**
The invite flow is attorney-to-attorney; representation is declared per invite.

**What does the export prove?**
It includes the room's messages plus an integrity result — the export verifies its audit chain and tells you so, giving you a tamper-evident record for production.

**Does opposing counsel see our internal channels?**
No. Cross-firm rooms live in the separate trust service; your MatterChat workspace is never exposed.

## Key files (for developers)

`apps/meteor/client/views/cross-firm/CrossFirmSection.tsx` + `useCrossFirmFetch.ts` (panel + same-origin fetch), `apps/meteor/app/omnisai-oauth/server/crossFirmProxy.ts` (security boundary: identity derivation, header stripping, route allowlist, login-token expiry), `apps/meteor/app/api/server/v1/cross-firm.ts` (identity endpoint), `apps/meteor/server/settings/omnisai.ts` (settings). Design: `docs/design/MATTERCHAT-CROSSFIRM-DESIGN.md`. The CFCS trust service is a separate repo/service.
