# FIRM-READINESS RESUME (2026-07-30 — usage-cutoff checkpoint)

If you are picking this up cold (human or Claude session), everything you need is here.

## What this is
Four parallel workstreams (founder-approved, full-auto), targeting DRAFT PRs only:
1. **feat/org-provisioning-fix** — stamp `users.customFields.firmId` from the OmnisAI org id on every OIDC login; per-ORG provisioned marker (unique-index lock) + org-admin trigger (fixes "org #2's roster can never mirror"); idempotent backfill. Org #1 (live Nguyen workspace) must NOT re-provision on deploy.
2. **feat/firm-invite-hardening** — firm invite links get finite maxUses + short expiry via admin settings, enforced at redemption (was 15-day unlimited). This branch is COMPLETE (its last commit is the DECISIONS entry).
3. **feat/room-firm-scoping** — rooms stamped with creator firmId at creation; spotlight/channels.list/directory/teams DISCOVERY scoped per the PR #166 convention (legacy no-firmId rooms stay global, admins exempt, no-op when firms off; membership access untouched).
4. **MatterChat-New feat/path-b-foundations** — Mongo-auth migration artifacts (placeholder-only secrets, 3-host seed list, confirm-gated migration workflow, runbook), Helm chart `kubernetes/charts/matterchat-firm/` + ApplicationSet (must not be ArgoCD-watched), parameterized register-oidc-client, PATH-B-RUNBOOK.md, ORG-PICKER-SCOPE.md.

Base for all app branches: `origin/staging` @ 48936e4fa5 (post pure-MIT #168 + #171).

## State at checkpoint
- Branches pushed to origin: feat/org-provisioning-fix (has WIP), feat/firm-invite-hardening (COMPLETE), feat/room-firm-scoping (may be base-only or WIP), feat/firm-readiness (integration branch), MatterChat-New feat/path-b-foundations (WIP).
- Commits labeled `wip: checkpoint before usage cutoff` are mid-work snapshots — review and CONTINUE from them, do not discard.
- Worktrees on the build Mac: scratchpad `wt-org`, `wt-invite`, `wt-rooms` (shared .git with ~/Downloads/matterchat-build/repo).

## How to resume (Claude session on the build Mac)
Workflow run `wf_2c333484-646`; script:
`~/.claude/projects/-Users-davidnguyen-Downloads/e6fd6607-7fea-4e19-bf6c-2cf0cf26ef7e/workflows/scripts/matterchat-firm-readiness-wf_2c333484-646.js`
Resume: `Workflow({scriptPath: <above>, resumeFromRunId: "wf_2c333484-646"})` — finished agents replay from cache (journal: `.../subagents/workflows/wf_2c333484-646/journal.jsonl`).

## How to resume (anyone else)
Finish each branch per its scope above (scout plans are in the workflow journal), then: merge the three app branches into `feat/firm-readiness`, run the build gate (`yarn build --filter=@rocket.chat/meteor^...` + meteor typecheck, judge by `grep -c "error TS"` == 0), unit suites, boot `bash ~/Downloads/matterchat-build/build-and-run-prod.sh` (:3100), smoke with two firm users, open ONE DRAFT PR to `staging`. Infra branch → DRAFT PR to MatterChat-New `main`. 

## Hard rules
- DRAFT PRs only — the founder personally tests before any merge ("ship it" is the only merge trigger).
- Never dispatch prod workflows; never apply anything to the cluster; MatterChat-New must change NOTHING by merge alone.
- Read repo CLAUDE.md + the 2026-07-30 HANDOFF.md section before coding.
