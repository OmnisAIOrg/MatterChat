# Boards Forms → CasePro intake routing

Public board intake forms (the shareable `/form/:slug` links) can now feed the firm's
lead pipeline instead of only creating a card. Each form picks one of three routings
in the form editor's **Send to intake** section:

| Routing | What a public submission does |
| --- | --- |
| **None — card only** (default) | Exactly what forms always did: a card in the target list. Byte-identical legacy behavior. |
| **Create board lead** | Card **plus** a lead on the Leads board, built from the mapped answers. The lead goes through the normal leads service — phone/email dedupe, ref number, lead card, speed-to-lead SLA task, and the `CasePro_Enabled`-gated CasePro write-through. The submission card is linked to the lead (`link: {kind:'lead'}`). |
| **Send directly to CasePro** | Card **plus** a server-side POST of the mapped answers to CasePro's public intake capture endpoint (`{base}/api/v1/intake-questionnaires/capture?org=&source=`). No board lead. Works even when the full CasePro board sync is off. |

## Field mapping

The editor maps form fields to the intake contact block (the same shape the leads
service pushes to CasePro): full name, first name, last name, email, phone, case type,
incident date. Mapping is validated on save — a mapped field must exist on the form,
**Create board lead** needs at least one mapped contact field, and **Send directly to
CasePro** needs the per-form CasePro org id + source token. The mapped case type is
treated as a practice-area *name* (free text/select answer), not a CasePro case-type id.

## Admin setup (firm admin checklist)

1. **casepro-direct only:** Admin → Settings → CasePro → set
   `CasePro_Intake_Capture_Base` to the firm's CasePro CRM base URL (https required),
   e.g. `https://crm.stg-omnisai.io`. This is separate from `CasePro_Base_URL`
   (the MCP connector base) and independent of `CasePro_Enabled`.
2. Open the board → **Forms** → create/edit a form.
3. Pick the routing under **Send to intake** and map the contact fields.
4. **casepro-direct only:** paste the CasePro org id and the marketing source token
   (from CasePro's intake sources) into the form.
5. Copy the public link and publish it.

## Security posture

- The public surface is unchanged: `boards.forms.public.get` still returns ONLY
  title/description/fields — routing config, org id and source token are **never**
  exposed on the public payload, and the public submitter always receives the same
  `{ok:true}` regardless of intake-delivery outcome.
- The outbound capture POST is https-only, host-pinned to the configured base
  (per-form input only ever lands in URL-encoded query params), DNS-pinned with
  SSRF validation ON (allow-list = the configured host only), never follows
  redirects, and times out after 3s.
- Delivery is at-least-once-attempted and fire-and-forget: every attempt — success
  or failure — is recorded on the board's activity feed as `form.intake.routed` /
  `form.intake.failed` (the form's audit trail). The source token is never written
  into audit entries or logs.

## Implementation map

- Types: `packages/core-typings/src/IBoardForm.ts` (`intakeRouting`, `intakeMapping`,
  `caseproOrgId`, `caseproSourceToken`), `IBoardActivity.ts` (new audit verbs).
- REST schemas: `packages/rest-typings/src/v1/boards-forms.ts` (create/update;
  remember the dist rebuild).
- Server: `apps/meteor/server/lib/boards/forms/service.ts` (validation + submit
  routing), `apps/meteor/server/lib/boards/forms/intakeRouting.ts` (lead routing +
  capture POST), `apps/meteor/server/settings/boards-casepro.ts` (new setting).
- UI: `apps/meteor/client/views/boards/forms/FormsManager.tsx` ("Send to intake").
- Harness: `scripts/boards-api-test.mjs` ("forms intake routing" block; the
  casepro-direct cases need an admin token and never make live CasePro calls).
