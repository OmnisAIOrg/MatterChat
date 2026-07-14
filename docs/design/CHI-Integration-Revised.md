# CHI Integration — Revised: CHI already exists, don't rebuild it
> **Correction** to the CHI sections of `Omnis-Boards-Parity-BYO-AI-CHI.md` and `CHI-AI-Sourcing-Decision-Brief.md`. Per the founder: *"Chi is not an MVP — it's already an Omnis AI agentic agent platform."* CHI is the existing OmnisAI **AI‑Agents** product, not something MatterChat builds. Verified against the `ai-agents` Omnis OS skill + `carepro-mcp-v2`.

## What CHI actually is (already built)
CHI = `OmnisAIOrg/AI-Agents-BE` + `AI-Agents-FE` (a.k.a. "Chi", the AI receptionist / agent platform; precursor to **Omnis Voice**). It already provides, in production-track form:
- **Build-your-own AI voice + text agents** (prompt, voice, temperature, tools, RAG knowledge); agent hierarchy (master → sub-agents).
- A **master-agent "Chi" chatbot** — an in-app assistant that creates/manages agents and runs tools from natural language (`MasterAgentOrchestrator`).
- **Pluggable models/providers** — Grok/xAI (default), Google Gemini/ADK/Vertex, Ultravox, Anthropic, OpenRouter, ElevenLabs/MiniMax/Resemble (`app/services/providers/`). *Model sourcing is already a platform concern here.*
- **CentralizedAuth identity** (org_id/user_id), conversations + history, analytics.
- Telephony (Twilio + LiveKit), phone numbers, IVR, call logs/recordings — the voice side.
- **The key integration seam: agents attach tools via MCP servers** — `/api/v1/mcp-servers`, `mcp_users_tools`, plus N8n webhook tools. This is how a product gives Chi the ability to *do* things in that product.

## The established integration pattern (CarePro / CasePro already do this)
Each product exposes a **Chi MCP tool server** that proxies its backend REST API:
- `carepro-mcp-v2` — "Chi tool server (13 scheduling/patient/lien tools) over the CarePro BE."
- `casepro-mcp-v2` — "CasePro MCP Server v2 — LLM-Driven Dynamic Operations."

**Template shape** (from `carepro-mcp-v2`): a small **Node MCP server**, one source / two transports — `stdio` (`npm start`) + **HTTP/JSON-RPC** (`npm run start:http`). Endpoints: `POST /mcp` (`initialize` / `tools/list` / `tools/call` / `ping`) + `GET /health`. Auth: **`X-MCP-API-Key`** shared secret (the product backend presents its `CENTRALIZED_AUTH_API_KEY`); org via **`X-Organization-ID`** per request. Deploy: push to `staging` → GH workflow → ECR → EKS `stg-omnisai-cluster`, shared `staging-backend-shared` ALB, external-dns publishes `<product>-mcp-v2.stg-omnisai.io`. The product's chatbot calls it via an `McpV2Client`.

## What MatterChat builds — a tool server + a surface, NOT an agent
1. **`matterchat-mcp-v2`** — a Boards/chat **MCP tool server** (clone `carepro-mcp-v2` as the template) exposing tools that proxy the MatterChat REST API I've been building:
   - Boards/PM: `listBoards`, `getMyDay`, `createCard`, `updateCard`, `moveCard`, `completeCard`, `setRecurrence`, `listCards`/`searchCards`, `createBoard`/`createList`, `summarizeBoard`.
   - Chat: `listChannels`, `postMessage`, `searchMessages` (RC REST).
   - Auth via the shared internal key; org/user via CentralizedAuth (MatterChat already does OIDC/CentralizedAuth). Deploy as `matterchat-mcp-v2.stg-omnisai.io`. Register it in Chi (`/api/v1/mcp-servers`) and attach to a MatterChat agent.
2. **Surface Chi inside MatterChat** — a "CHI" panel that talks to the **existing** Chi chat (`POST /api/v1/master-chat/master-agents/{id}/chat`, or `/google-adk/chat`, or embed the `AI-Agents-FE` Chatbot), authenticated by the shared CentralizedAuth session. The user gets CHI in MatterChat, powered by the real platform, able to drive Boards via the MCP tools above.

## What this SUPERSEDES from the earlier design
- **DROP** building an in-Meteor agent: `ChiAgentLoop`, `IChiProvider`/adapters, `ProviderFactory`, `ChiSettings`, `apps/meteor/server/lib/ai/*`. Chi already has the agent runtime, the providers, conversations, and model sourcing.
- The `ChiToolCatalog` idea **survives** — but as the `matterchat-mcp-v2` tool definitions (a separate Node repo), not an in-Meteor catalog.
- The **AI‑sourcing decision** (self-host OSS vs commercial API vs subscription/connector) is a **Chi‑platform** decision, made once across all products via Chi's pluggable providers — **not** something MatterChat re-implements. The founder's "no per-token API / use our own LLM" goal is set at the Chi layer.

## Template: `casepro-mcp-v2` (the legal-domain one — preferred over CarePro)
Both repos are cloned at `~/casepro-mcp-v2` and `~/carepro-mcp-v2`. Two patterns:
- **`carepro-mcp-v2`** — 13 **static** tools, each wrapping one REST endpoint via an axios client (`book_appointment` → `POST /appointments/create`). Stdio + HTTP. Deterministic, no LLM in the server.
- **`casepro-mcp-v2`** — 15 **generic "meta-tools"** (`execute_operation`, `query_entities`, `create_entity`, `update_entity`, `upsert_entity`, `find_or_create`, `batch_*`, `list_schema`, `validate_operation`, `execute_workflow`, `aggregate_data`) that work off **schema discovery + an in-server LLM** (`plan-generator` → `plan-validator` → `operation-executor`) — "100+ tools → 15." Talks **directly to PostgreSQL**. Dual auth (`X-MCP-API-Key` + CentralizedAuth Bearer) with Redis cache. **`LLM_MODEL=openai/gpt-oss-120b` via OpenRouter** — i.e. CasePro's MCP already runs on the self-hosted OSS model. Deploy: Docker → ECR → EKS, ingress `casepro-mcp-v2.stg-omnisai.io`, port 3002.

Shared scaffold (copy from casepro): `src/server.ts` (Express + `@modelcontextprotocol/sdk`, `POST /mcp` JSON-RPC `initialize`/`tools/list`/`tools/call`, `GET /health`, `GET /tools`), `src/auth/*` (dual-auth middleware + Redis), `src/config/*`, `Dockerfile`, `kubernetes/staging/deployment.yaml`, `.github/workflows/deploy-staging.yaml`, `tsconfig.json`, `package.json`.

## Recommended approach for `matterchat-mcp-v2`
**Casepro's structure (server / dual-auth / Redis / deploy), but DETERMINISTIC tools over the `boards.*` REST API — no in-server LLM.** Rationale: Chi already *is* the agent/LLM, so the MCP server shouldn't run its own model; it just exposes clean tools Chi calls. Two adaptations from casepro:
1. **REST adapter, not Postgres** — a `MatterChatClient` (axios) hitting the Meteor REST API, replacing `src/db.ts` + DB `schema-discovery`. NOTE: MatterChat's API is RPC-style (`boards.create`, `boards.card.create`, `boards.cards`, `boards.card.update`, `boards.cards.myDay`, `boards.card.recurrence.set`), **not** REST-resource — so tools map 1:1 to those endpoint names (a small map), not generic `/api/v1/${entity}`.
2. **Tool set** (deterministic): `list_boards`, `get_my_day`, `create_board`, `create_list`, `create_card`, `update_card`, `move_card`, `complete_card`, `set_recurrence`, `search_cards`, `summarize_board`; chat: `list_channels`, `post_message`, `search_messages`. (The casepro meta-tool generic layer + in-server LLM can be added later if we want NL-dynamic ops, defaulting to gpt-oss-120b like casepro.)
- **Auth:** reuse casepro's dual-auth (`X-MCP-API-Key` for Chi S2S + CentralizedAuth Bearer for the calling user); per-request user/org → pass the user's RC auth to the `boards.*` calls so tools run under the user's permissions.
- **Effort:** ~80% reuse from casepro, ~20% new (the REST client + the endpoint map). Locally testable against the running instance (`:3100`) with no LLM key.

## Status — `matterchat-mcp-v2` BUILT + verified (2026-06-21)
Built at `~/matterchat-mcp-v2` (git, commit `c4d83fe`). CasePro's plumbing (HTTP JSON-RPC `/mcp`, `X-MCP-API-Key` auth, Dockerfile/k8s/CI) + CarePro's static-tool style (no in-server LLM). **14 tools** over the `boards.*` + RC REST API: `list_boards`, `get_my_day`, `list_board_lists`, `list_cards`, `create_board`, `create_list`, `create_card`, `update_card`, `complete_card`, `move_card`, `set_recurrence`, `list_channels`, `post_message`, `get_channel_messages`. Per-request user identity via `X-Mc-User-Id`/`X-Mc-Auth-Token` (acts as the user, through the REST API — permissions/validation/audit preserved). **Verified end-to-end against live `:3100`**: read (`get_my_day` returned real cards incl. the recurring routine) + write (`create_card`, `post_message`) + the auth/zod gates.

### Remaining (deploy-time — needs MatterChat deployed on OmnisAI infra)
1. Provision `matterchat-mcp-v2-secrets` + deploy to `matterchat-mcp-v2.stg-omnisai.io` (push to `staging`).
2. Register in Chi (`POST /api/v1/mcp-servers`) + attach to a MatterChat agent.
3. Embed a CHI chat panel in MatterChat (call `/api/v1/master-chat/.../chat`; shared CentralizedAuth).
4. Prod auth bridge: CentralizedAuth subject → a Rocket.Chat user token (admin mint) instead of token pass-through.
