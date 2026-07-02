# CasePro integration (Omnis Boards ↔ CasePro)

Omnis Boards can mirror a law firm's **CasePro** CRM: matter cards show a live matter
snapshot (client, stage, SOL, medical totals, negotiation posture), and the Leads board
is a synced working view of CasePro intake (`intake_questionnaires`) — capture, drag
between stages, qualify, and convert to a matter, with every change written back to
CasePro as the system of record.

## Honest status: stub vs live

The integration ships with **two transports** and is explicit about which one you are on:

| | Stub (default) | Live (MCP gateway) |
|---|---|---|
| Data | Built-in sample rows (Doe v. Roe, 4 sample leads) | Real CasePro rows via the casepro-mcp-v2 gateway |
| Config needed | None | Gateway URL + org ID + `CASEPRO_MCP_API_KEY` env secret |
| Writes | Kept in memory, discarded on restart | Real `create_entity` / `update_entity` calls — **pilot-scoped**, additionally gated behind `CasePro_Enabled` |
| UI signal | Matter panel shows a "CasePro is in stub mode" callout | Callout disappears once `CasePro_Enabled` is on |

Everything described below is **built and unit-tested against the gateway protocol**
(JSON-RPC `tools/call`, verified live: the deployed gateway answers on `/mcp` and
`/mcp/v2`, 401 without a key). End-to-end verification against real CasePro data still
requires a provisioned MCP key — see "Enablement" below.

## How the live wire works

- **Protocol** — JSON-RPC 2.0 `tools/call` POSTs to `{CasePro_Base_URL}/mcp/v2`, using
  five meta-verbs: `query_entities`, `get_entity`, `list_schema`, `create_entity`,
  `update_entity`. The transport never uses `aggregate_data` (broken GROUP BY upstream);
  money math is summed in MatterChat.
- **Auth (route A — MCP key)** — every call carries `X-MCP-API-Key` (from the
  `CASEPRO_MCP_API_KEY` environment variable **only**; secrets are never stored in
  workspace settings) and `X-Organization-ID` (env `CASEPRO_ORG_ID` or the
  `CasePro_Org_ID` setting). Writes triggered by a user also carry an advisory
  `X-Acting-User` header (writer-identity seam; the gateway's identity remains the
  service key until CasePro stamps per-user attribution).
- **Auth (route B — KeyGate)** — declared as a stub (`CasePro_Auth_Mode` = `keygate`).
  Selecting it deliberately falls back to sample data until the KeyGate handshake lands.
- **Refusal over leakage** — if the live transport is requested but the key (or a valid
  https URL) is missing, MatterChat **refuses to make live calls**: it serves the stub,
  logs a loud startup warning, and reports the reason via `boards.casepro.status`.
  It never sends an unauthenticated request.
- **Strict egress** — https only, no credentials in URLs, SSRF validation ON with an
  allow-list pinned to exactly the configured gateway host, and redirects are never
  followed (a redirect will not re-send the key elsewhere).

## Scheduled sync

A cron (`BoardsCaseProLeadsPull`, every 15 minutes) runs the same idempotent
`pullFromCasePro` engine as the manual **Sync from CasePro** button. It is a no-op
unless `CasePro_Enabled` is on **and** the transport is actually live **and** a leads
board already exists (the cron never creates boards). Matter-side freshness continues
to come from the existing snapshot refresh + daily reconcile sweep.

## Permissions (enforced)

| Permission | Default roles | Gates |
|---|---|---|
| `boards-casepro-view` | admin, partner, attorney, case-manager | `boards.casepro.matterSnapshot` / `listMatters` / `listStages` (the matter panel data) |
| `boards-casepro-sync` | admin, partner | `boards.leads.syncFromCasePro`, `boards.matters.seedFromCasePro` |
| `boards-casepro-write` | admin, partner | `boards.leads.convertToMatter` when CasePro is enabled (creates a real matter upstream) |
| `boards-manage-casepro-settings` | admin, partner | `boards.casepro.status` (the live-wire diagnostics endpoint) + the CasePro admin settings surface |

Existing installs get the widened grants via migration **v338** (`$addToSet` only —
hand-edited grants are never overwritten). Note: matter-panel data now requires
`boards-casepro-view`; plain members without a legal role will no longer see CasePro
snapshot data (by design — it is client PI/financial data).

## Settings (Admin → Settings → CasePro)

- `CasePro_Enabled` — master switch; also the gate for all write-through sync.
- `CasePro_Transport` — `stub` | `rest`.
- `CasePro_Base_URL` — the MCP gateway (e.g. `https://casepro-mcp-v2.stg-omnisai.io`).
- `CasePro_Auth_Mode` — `mcp-key` (live) | `keygate` (declared stub).
- `CasePro_Org_ID` — the `X-Organization-ID` scope (env `CASEPRO_ORG_ID` overrides).
- `CasePro_Web_URL` — the **human** CasePro app URL for "Open in CasePro" links on
  matter cards; when empty the links are hidden (never dead hrefs).

Env overrides (deploy-level): `CASEPRO_TRANSPORT`, `CASEPRO_BASE_URL`,
`CASEPRO_AUTH_MODE`, `CASEPRO_ORG_ID`, and the secret `CASEPRO_MCP_API_KEY` (env only).

## Enablement checklist (staging)

Nothing is enabled by this change. To flip staging live:

1. **CasePro side**: provision an MCP API key in CasePro's auth service (the gateway
   validates `X-MCP-API-Key` against `{AUTH_SERVICE_URL}/api/mcp/keys/validate`; in the
   CarePro deployment this is the `MCP_API_KEY` sealed secret on the gateway).
2. **MatterChat side** (env/manifest):
   - `CASEPRO_TRANSPORT=rest`
   - `CASEPRO_BASE_URL=https://casepro-mcp-v2.stg-omnisai.io`
   - `CASEPRO_MCP_API_KEY=<the provisioned key>` (sealed secret)
   - `CASEPRO_ORG_ID=<the pilot firm's CasePro org uuid>`
   - `OVERWRITE_SETTING_CasePro_Enabled=true`
3. Set `CasePro_Web_URL` in admin settings for deep links.
4. Verify via `GET /api/v1/boards.casepro.status` (requires
   `boards-manage-casepro-settings`): `effective: "rest"`, then open a matter card.

## Needs live verification (first run with a real key)

- Gateway response envelope for `get_entity` not-found and `create_entity` /
  `update_entity` row shapes (parsed defensively: `record` / `created` / `updated`).
- Whether the deployed gateway honors `X-Organization-ID` per request or scopes the
  org from the key's context (the CarePro gateway honors the header; harmless either way).
- `query_entities` behavior at large `limit` values (offset is emulated client-side
  because the gateway paginates by limit only).
