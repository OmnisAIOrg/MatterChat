# Chi Assistant — Feature Inventory, Architecture & Roadmap

> The complete reference for Chi, MatterChat's AI assistant orb ("the Enso popout").
> Branch: `feat/chi-orb-nest-redesign` → PR #160. Last updated: 2026-07-23.
> In-product mirror: the orb's **Settings → What's new** panel shows this list with live status.

Chi spans three repos:

| Repo | Role |
|---|---|
| `OmnisAIOrg/MatterChat` | The web app — orb FE (`apps/meteor/public/omnis-widgets/`, `client/omnis/widgets/`) + server brain (`server/lib/chi/`) + REST (`app/api/server/v1/chi.ts`) |
| `OmnisAIOrg/MatterChat-Desktop` | Electron wrapper — native always-on-top Chi window, global shortcuts, mic (TCC) grants |
| `OmnisAIOrg/matterchat-mcp-v2` | Chi's Boards/chat MCP tool server (the template all product connectors follow) |

---

## 1 · Features — BUILT and working

### The orb (Nest edition)
- Machined stainless dial: brushed conic ring, knurl + spun-metal textures, dual light sweeps
- 5 preset ring finishes + **full 2D color editor** (hue bar + shade pad, live tinting, persisted)
- 4 themes (dark / light / warm / legal), per-user, persisted
- Clean face: top arc = [window-frame] [settings ⚙] [×]; outside ring minimize; grip tab drag
- 3D drum scrolling with synthesized detent ticks; free-scroll (no CSS snap); reduced-motion safe
- Minimized ensō launcher: presence glow (amber when unseen), unseen badge, hover-peek ghost card
- Sounds engine (detent tick, arrival chime, send pluck, record chirps) — one master toggle
- Size scaling 70–150%, drag anywhere, pop-out (web Document-PiP / desktop native window)

### Conversation & actions
- `POST /v1/chi.ask` — caller-scoped tool loop (navigate/search/read/post/tasks/settings…), confirm/park for destructive actions, one-click Confirm/Cancel chips, full audit trail
- Action chips incl. realtime `suggest_actions`; drop-anything-on-Chi → a Chi turn
- ⌘⇧C summon (in-page + desktop OS-global)

### Notifications in Chi
- Route-to-Chi toggle: events that would be OS banners become **cards in the orb** (source-colored accent, avatar, badge) — OS banners suppressed while routed, badge counts and mobile push untouched, safe fallback if the orb is absent
- Reply from the card (typed or dictated) → posts to the real room as the member; ack/failure cards
- Banner mode when not routed; focus timer (15/25/45m) queues notifications silently → **catch-up digest** ("While you were away… Rundown / Show them")
- Desktop popout receives cards via consume-once localStorage relay

### Voice (untouched plumbing, new surfaces)
- Realtime voice (OpenAI Realtime over WebRTC, desktop Chi window) — unchanged engine
- **Live captions** during realtime, fed from the session's own transcript events
- Web Speech dictation in the input pill and reply bar

### Flow — dictation that speeds up writing (VoiceInk-class, clean-room)
- ⚡ button or **⌘⇧F quick command** (in-page + desktop OS-global): press to talk, press to deliver
- Speech models: Built-in browser · **Workspace (server-managed key — the secure lane)** · OpenAI · Groq · local Whisper server (OpenAI-compatible URL)
- Pipeline: transcript → **Dictionary** word replacements → optional **AI polish** (same Chi brain, vocabulary preserved) → Composer / Ask Chi / Clipboard
- **Dictionary** (replacements + vocabulary), **Modes** (default Dictation editor), **History** (searchable, words-dictated counter, tap to reuse), **Audio** (mic picker, record chirps)
- 5-minute clip cap; recording start/stop chirps

### Settings system (in the orb)
Main ▸ Language models ▸ Transcription ▸ Dictionary ▸ Modes ▸ History ▸ Audio ▸ Capabilities ▸ Connections ▸ **What's new** — all interactions update in place (no re-render flicker).

### Language models (BYO-LLM)
- Cloud: Anthropic, OpenAI, Gemini, xAI, Groq, Cerebras, OpenRouter, DeepSeek
- Local ($0, private): Ollama, LM Studio, llama.cpp, custom OpenAI-compatible — **no API key required server-side**
- Admin (workspace) provider/key/model in Admin → Settings → Chi Assistant; **per-user model override** via `chi.prefs`

### Product connectors (MCP)
- `server/lib/chi/admin/mcp.ts`: JSON-RPC client for the `*-mcp-v2` template; tools join Chi's loop namespaced `mcp_<server>_<tool>`; write-looking tools confirm-gate; 5-min list cache; dead server = zero tools, never a broken turn
- Admin registry: `Chi_MCP_Enabled` + `Chi_MCP_Servers` (JSON); per-user connector toggles (server-stored)
- **Signed member assertions** on every call (see Security)

### Security model
- **No key sharing, by construction**: workspace LLM/STT keys live in admin settings (`secret: true`) only; Flow's secure lane `POST /v1/chi.transcribe` relays audio server-side (15 MB cap, 20/min limit, never stored); browsers never receive provider keys
- **Verifiable identity to connectors**: HMAC-signed 5-minute assertions (`Chi_MCP_Signing_Secret`), OAuth-shaped claims (`sub`/`iss`/`iat`/`exp`) — the foundation for the CentralizedAuth OAuth bridge
- Everything runs with the member's own permissions; audit channel logs every tool execution; cross-window relays are consume-once

### REST surface
`chi.ask` · `chi.realtime-session` · `chi.transcription-config` · `chi.transcribe` · `chi.prefs` (GET/POST)

### Tests
Mocha/chai unit specs: providers (presets incl. locals), MCP (registry parsing, namespacing, confirm gates, assertion sign/verify/tamper), plus the pre-existing chi client/context/service specs. Chi's client+server surface typechecks clean.

---

## 2 · Admin setup runbook

1. **Enable Chi**: Admin → Settings → Chi Assistant → on; pick provider + key (or a local provider — no key needed).
2. **Realtime voice**: enable + OpenAI key (or reuse the main key when provider = OpenAI).
3. **Flow transcription (secure lane)**: set `Chi_STT_Provider` (openai/groq/custom) + key or base URL. Members then get "Workspace · server-managed key".
4. **Connectors**: set `Chi_MCP_Signing_Secret`, enable `Chi_MCP_Enabled`, paste the server registry JSON (casepro/casenotes/carepro/matterchat `*-mcp-v2` URLs + keys). Set the same signing secret on each connector server once verification lands there.
5. **k8s note**: local-provider URLs (`localhost:11434` etc.) resolve on the workspace host — use a sidecar or override the Base URL.

---

## 3 · Still to be done (the honest list)

### Blockers before production
> Deploy model: MatterChat has NO per-PR previews — merging PR #160 into `staging` auto-builds
> and restarts the staging pod (ArgoCD owns the manifests; see matterchat-staging-deploy.yaml).
> QA happens ON STAGING, then production is promoted separately.
- [ ] **Merge #160 → staging, then the QA pass on staging** (notifications web+desktop, reply round-trip, Flow→composer selector against the real DOM, captions in a live call, Workspace transcription with a real key)
- [ ] **Fork-wide CI debt** (boards API types, Bridge CSS lint, ABAC/Virtru specs — none of it Chi) — cleanup branch so PRs run green
- [ ] **Desktop release tag** so users receive ⌘⇧C/⌘⇧F via auto-update

### Security completion
- [ ] **Connector-side assertion verification** — add the HMAC verify middleware to casepro-mcp-v2 / CaseNotes-MCP / carepro-mcp-v2 / matterchat-mcp-v2 (~20 lines each, contract in `mcp.ts`)
- [ ] **Full OAuth bridge**: CentralizedAuth subject → minted per-user token replacing the HMAC assertion (claims shape already matches)
- [ ] Data-egress policy toggles (allow cloud STT / local-only mode) + retention statement for legal clients
- [ ] Org-held keys for the remaining browser-side STT providers (proxy pattern exists — extend `chi.transcribe`)

### Feature build-out (the SOON roster in Settings)
- [ ] **On-device STT downloads** — whisper/Parakeet runtime in MatterChat-Desktop + IPC (the Model Catalog's Download buttons)
- [ ] Non-OpenAI-compatible STT adapters: Deepgram, ElevenLabs, Soniox, Speechmatics, AssemblyAI, Mistral, xAI, Cartesia
- [ ] Product MCP servers that don't exist yet: DepoLink, OmnisProof, MedChron, AutoDoc, LitDraft, LitBox (clone the matterchat-mcp-v2 template)
- [ ] Admin UI for the MCP registry (replace the JSON textarea); "+ Add" flows in Connections
- [ ] Capabilities backlog — each SOON switch: computer control (open apps, click/type, read screen, screenshots, clipboard, browser), files & documents (PDF/OCR/draft/sheets/LitBox), communications (email draft/digest, calendar, calls, SMS), intelligence (memory, preferences, daily briefing, proactive, wake word, vision, watch-screen), automations (routines, watchers, workflows, agent teams)
- [ ] Email connectors (Outlook — omnis-email-assistant path exists — and Gmail)
- [ ] Modes: per-app profiles, custom shortcuts, Auto Send wiring
- [ ] Per-user model roster (admin enables N providers w/ keys; users pick among them — today: model override within the single workspace provider)
- [ ] Decide whether routed-to-Chi should also quiet mobile push (currently untouched by design)

### Quality & ops
- [ ] Playwright E2E for the orb (mount, settings, notification flow, Flow with mocked recognizer)
- [ ] Metrics: turn latency, tool/MCP/STT failure rates (logs only today)
- [ ] Accessibility pass: ARIA on cards/toggles, keyboard traversal, contrast audit
- [ ] Cost controls: per-workspace token/STT spend caps
- [ ] Non-English i18n for the new labels
