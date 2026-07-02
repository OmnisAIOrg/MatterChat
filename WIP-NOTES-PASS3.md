# Integration Pass 3 — WIP notes (cut off by session limit, 2026-07-01)

## State: MERGES DONE + COMMITTED, VERIFICATION NOT STARTED — do NOT push this to `staging` until verified (staging auto-deploys).

Base: staging @ 11e0a45c95 (pass-2 tip, clean/in-sync at start).
This branch (`auto/staging-integration-pass3-wip`) tip = staging + 4 merge commits.

## Merges completed (in order, all committed)
1. `origin/auto/staging-typecheck-debt` (953459f9bf) — merge commit 5ed40c1088.
   - CONFLICT: `apps/meteor/app/api/server/v1/boards.ts` (boards.cards.search route).
     Resolved **--ours (HEAD)**: pass-2's merged pagination version already contained BOTH
     intents — the `this.queryParams as {...}` cast (tsdebt's fix) AND the paging code.
     tsdebt's side was the older pre-pagination body. Zero-runtime-change property preserved.
2. `origin/auto/boards-pagination-2` (85bb605f12) — merge commit 8a78c925e5, clean.
   Touches `packages/rest-typings/src/v1/boards-views.ts` → **rest-typings dist rebuild required**.
3. `origin/auto/legal-hold-admin` (8053e55d0e) — merge commit 6b8125a39d, clean.
   Touches core-typings + rest-typings → **dist rebuilds required**. Has 13 jest tests (2 spec files).
4. `origin/auto/teams-message-bridge` (013361c03a, includes auto/teams-oauth-connect 6da597b52c)
   — merge commit 3329ee097f. Two conflicts, both resolved keeping both intents:
   - `apps/meteor/app/connectors/server/connectionService.ts`: kept HEAD's boot-time
     EXTERNAL_TOKEN_ENC_KEY visibility check (import `isEncryptionConfigured` only — the
     branch refactored `decryptCredentials` usage into `toProviderConnection` from
     `./runtimeConnection`, whose import was added). Merged body already used
     toProviderConnection throughout; `decryptCredentials` import dropped as now-unused here.
   - `apps/meteor/app/connectors/server/providers/TeamsProvider.ts` (~line 481, syncMessages):
     took the branch's `graphFetch<{ value?: GraphChatMessage[]; '@odata.nextLink'?: string }>(next, tokens, {}, onRefreshed)`
     — the explicit generic satisfies HEAD's TS7022 fix (explicit type, no inference cycle)
     while adding the branch's token-refresh hook. Comment updated to say so.
   - Bridge's own lint/tsc was deferred on its branch — **still unverified**.

## NOT done (remains for pass 4 / resumer)
- FIX (pass-2 flagged): `apps/meteor/app/api/server/v1/boards-reports.ts` (2 call sites) and
  `boards-matters.ts` (12 call sites) use `requireUid('...')` (Meteor.userId-based — throws in
  typed REST router). Switch to `const uid = this.userId;` exactly like pass-2's fix in
  `boards-forms.ts` (see its line-60 comment). Note boards-matters.ts lines ~200/219/238 call
  `requireUid()` for effect only (no assignment) — those can just be deleted (authRequired
  covers it). Then remove now-unused `requireUid` imports. Add 1-2 harness smoke cases per
  endpoint family (reports + matters) in `scripts/boards-api-test.mjs`.
- Dist rebuilds: `yarn turbo run build --filter=@rocket.chat/core-typings --filter=@rocket.chat/rest-typings --filter=@rocket.chat/model-typings --filter=@rocket.chat/models`
  (teams bridge touched model-typings/models too: ExternalWorkspaceConnections).
- `tsc --noEmit --skipLibCheck` in apps/meteor — target 0 errors (tsdebt cleared the 32;
  pass-2 left 26 pre-existing which tsdebt's fixes should cover; NEW errors from these merges
  → fix type-level only). Teams bridge is the likeliest source of new ones (never typechecked).
- Jest: legal-hold specs (`apps/meteor/server/lib/rooms/legalHold.spec.ts`,
  `server/lib/auditServerEvents/auditLegalHoldChanges.spec.ts`) via
  `yarn jest --selectProjects server` scoped; plus connector/teams specs if present.
- Runtime verify on :3100 (self-heal wrapper; verify via log file): full boards harness
  `scripts/boards-api-test.mjs` — expect 91 + 19 (pag2) + new smoke cases, clean up leftover
  harness boards first. Legal-hold REST smoke (set hold as admin w/ manage-legal-hold →
  rooms.cleanHistory refuses → clear). Teams bridge boot smoke: no webhook secret set →
  boot log shows fail-closed warning (no subs); `external-workspaces.bridges` answers
  auth-gated envelope.
- Push `staging` ONLY after all of the above; watch "MatterChat — Staging Deploy" workflow
  (ignore Code scanning — pre-existing failure); curl https://matterchat.stg-omnisai.io/
  (~3 min retry through Recreate pod roll).

## Environment notes
- No dev server was started this session; no tokens minted; nothing to clean up.
- Pre-existing mongod on :27018 left alone.
