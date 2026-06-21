# CHI — AI Sourcing Decision Brief
> Engineering + strategy. How the CHI assistant in MatterChat gets its model intelligence, given the founder constraint *(no per-token API charges; leverage what users already pay for; possibly our own OSS LLM)* and law-firm confidentiality. Companion to `Omnis-Boards-Parity-BYO-AI-CHI.md`. Researched against current (2026) provider terms + capabilities.

## 1. The honest finding — "use their subscription, not the API"
A user's Claude/ChatGPT **subscription** compute can only be spent **inside the provider's own app** (claude.ai / Claude Desktop / ChatGPT). The sanctioned way to make their subscription pay is to **flip the architecture**: publish CHI's Boards tools as a remote **MCP connector** (Claude) or an **App in ChatGPT** (OpenAI Apps SDK), so the user runs CHI *from inside their own Claude/ChatGPT* — their plan pays for the thinking; we just answer tool calls. The reverse — capturing a user's login/OAuth token to drive an assistant inside MatterChat's own screen — is **prohibited** (Anthropic explicitly banned it Feb 2026; OpenAI always separated the $20/mo subscription from API access).

**The rule, plainly:** *If CHI lives in MatterChat's UI, someone pays a per-token bill. The only way to make "their subscription" pay is to let CHI's tools be summoned from inside Claude/ChatGPT, where the assistant is theirs, not ours.*

## 2. The three viable models
| | (a) Connect-your-subscription (MCP / ChatGPT App) | (b) BYO API key (firm-owned, commercial) | (c) Self-hosted OSS (gpt-oss-120b / Qwen3 on vLLM) |
|---|---|---|---|
| How | Ship CHI tools as a remote MCP server; user adds it inside their own Claude/ChatGPT; *their* assistant calls our tools | MatterChat holds a firm-tenant commercial API key under a DPA; CHI runs in our UI via the agent loop | Open-weight model behind the firewall on an OpenAI-compatible endpoint; CHI calls it |
| Who pays inference | The user's existing Claude/ChatGPT plan | The firm (per-token on its own key) | The firm's fixed GPU/infra cost (no per-token) |
| Confidentiality | **Weak** — consumer plan trains by default | **Strong** — commercial API, no training, DPA + ZDR, BAA available | **Strongest** — data never leaves the network; air-gappable |
| ToS risk | Sanctioned *as a connector* (not token capture) | None (intended commercial relationship) | None (Apache-2.0 models) |
| UX | **External** (lives in Claude/ChatGPT window) | **Native** in MatterChat | **Native** (same as b; only endpoint differs) |
| Effort | Medium (MCP server + OAuth + OpenAI review) | Low–Med (standard agent loop + key mgmt) | High (GPU ops, vLLM, you own uptime/security) |

**Precedent:** ~95% of comparable tools (Notion, Atlassian Rovo, ClickUp, Harvey, CoCounsel, Spellbook) **bundle their own enterprise API**. BYO-*key* exists only in dev tools (Cursor, Zed, Raycast) and always means an API key. "Connect your *subscription*" has one sanctioned precedent (Zed on OpenAI Codex sign-in); the Anthropic equivalent was banned. Model (a) is real but novel + external; (b) is the industry default.

## 3. Recommendation for a law firm
**Lead with (c) self-hosted OSS as the confidentiality default, and (b) firm-owned ZDR API key as the pragmatic default — never route privileged data through (a).** A two-tier launch:
- **Privileged/client matter work → (c) self-hosted gpt-oss-120b on vLLM** (single 80GB GPU, Apache-2.0). CHI's job is short-horizon tool calls (create/move tasks, summarize a board, plan a day) — exactly where open models are competitive. Data never leaves the perimeter: cleanest privilege story, no ToS exposure, **no per-token bill** (directly satisfies the founder constraint).
- **Firms that won't run GPUs → (b) firm-tenant commercial API key under DPA + Zero Data Retention** (Anthropic Commercial / OpenAI Business). No training by default, signed DPA, BAA where PHI is involved. Satisfies ABA Formal Opinion 512; what every serious legal-AI tool does. Proxy server-side (browser CORS isn't ZDR-eligible).
- **(a) connect-your-subscription → opt-in only, non-privileged personal productivity**, framed honestly (consumer plan, external, not for confidential client data). Its real value is **distribution** — discovery inside the Claude/ChatGPT app directories — not casework.

## 4. Pluggable "CHI intelligence provider" architecture
Key insight: **all three modes share ONE agent loop and ONE tool catalog.** (b) and (c) differ only in endpoint + auth; (a) inverts control (no agent — we expose the same tools to an external assistant). The **tool catalog is the stable core**; the provider is swappable.

```
apps/meteor/server/lib/ai/
├── ChiToolCatalog.ts          # SINGLE source of truth: Boards/task tools (createCard, moveCard,
│                              #   listBoard, summarizeBoard, planDay…) — name, JSON schema, handler
├── ChiAgentLoop.ts            # plan→call tool→observe→repeat; confirm-before-destructive
├── providers/
│   ├── IChiProvider.ts        # complete({system,messages,tools}) -> {text|toolCalls}; healthCheck()
│   ├── OpenAICompatProvider.ts# serves BOTH self-hosted vLLM AND OpenAI (only baseURL+key differ)
│   ├── AnthropicProvider.ts   # Anthropic Messages API (BYO key)
│   └── ProviderFactory.ts     # reads Chi_Provider_Mode -> active provider
├── ChiSettings.ts             # settings keys (below)
└── mcp/ChiMcpServer.ts        # mode (a): wraps ChiToolCatalog as a remote MCP server at
                               #   /api/v1/chi.mcp, OAuth 2.1 back to the RC session (user's ACLs)
```
Settings: `Chi_Provider_Mode` (self_hosted | byo_openai | byo_anthropic | mcp_only), `Chi_SelfHosted_BaseURL/_Token/_Model` (default gpt-oss-120b), `Chi_OpenAI_ApiKey/_Model`, `Chi_Anthropic_ApiKey/_Model`, `Chi_Require_ZDR` (default true — block BYO-key unless ZDR attested), `Chi_Confirm_Destructive` (default true), `Chi_MCP_Enabled` (default false). All keys `public:false` + `secret:true`. **Add a tool once → it works in every mode.**

## 5. How this revises the earlier BYO-AI design (which assumed API keys)
1. **"BYO key" ≠ "BYO subscription."** A Pro/Plus subscription cannot legally power an in-app key field. The key field accepts only a **commercial/enterprise** key; "connect your subscription" is a separate mode (a), an MCP connector, not a key.
2. **A confidentiality gate is mandatory on BYO-key mode** — `Chi_Require_ZDR`, pin to ZDR-eligible models, proxy server-side.
3. **Self-hosted is promoted to first-class + recommended** — `OpenAICompatProvider` serves both OpenAI and local vLLM, so self-hosting is config, not a rewrite.
4. **Architecture reframed around the tool catalog, not the key** — `ChiToolCatalog` is the stable asset; key→agent→model becomes one of three consumers of a shared catalog.

## 6. Open decisions for the founder
- **Single firm-wide model vs per-tenant choice** at onboarding (per-tenant = more work, but security-conscious firms pick air-gapped while solos pick BYO-key).
- **Who operates the self-hosted GPU — us or the firm?** Hosting gpt-oss-120b ourselves (~$2k/mo per H100, multi-tenant) is simplest but makes *us* a data processor (needs our own DPA); firm-on-prem maximizes the privilege story but pushes ops onto them. **Biggest cost/confidentiality fork.**
- **Build the ChatGPT-App / Claude-connector at launch, or defer?** Real engineering + OpenAI identity-verification/review; payoff is *distribution*, not casework. Growth channel or v2?
- **Privileged-data guardrail: hard or soft?** Technically *block* matter-tagged content from BYO-key/MCP (route only to self-hosted) vs rely on policy + informed-consent copy. Hard router = strongest ABA Op. 512 posture but constrains the product.
- **BAA / PHI scope.** Some PI/med-mal matters touch PHI — commit to a BAA-backed tier now (Anthropic HIPAA-ready or self-hosted), or scope PHI out of CHI at launch?
