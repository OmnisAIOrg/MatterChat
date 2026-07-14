# Runbook — Deploy MatterChat onto the Alpha environment (preview links)

Goal: MatterChat gets per-PR preview URLs like `https://pr-<N>-matterchat.alpha.stg-omnisai.io`.

**Status:** the onboarding code is done and correct — `AlphaEnvironment` **PR #13** (orchestrator config +
Meteor compose template + product description + history) and the MatterChat repo's `alpha-preview.yml` +
`apps/meteor/.docker/Dockerfile.alpha` (already on `develop`). What remains is **merge + on-box deploy +
validate** — operations on the shared Alpha EC2 box. This runbook is those steps.

Prereqs: VPN up (box `34.215.9.240`); SSH key `~/alpha-environment-key.pem` (the part not on this machine yet).

---

## 0. Merge PR #13 (AlphaEnvironment → main)
Protected branch (`enforce_admins` + 1 review). Pick one:
- **Cleanest:** get 1 review approval on PR #13, then `gh pr merge 13 -R OmnisAIOrg/AlphaEnvironment --merge --delete-branch`.
- Or the founder-authorized `enforce_admins` toggle merge (off → `--admin` merge → on), or merge in the GitHub UI.

It changes 4 files (all additive — does not touch other products):
`orchestrator/config.py` (new `MatterChat` REPOS_CONFIG entry), `templates/matterchat-fullstack-compose.yml.j2`,
`product-descriptions/matterchat.md`, `history/matterchat/2026-06-17.md`.

## 1. Deploy the merged change onto the box
The box runs from `/data/alpha-test/`; **changes are NOT auto-pulled** — scp the 3 functional files and restart
the orchestrator.
```bash
ssh -i ~/alpha-environment-key.pem ec2-user@34.215.9.240
cd /data/alpha-test
# pull main (if the box deploys via git) OR scp the three files from the merged repo:
#   orchestrator/config.py
#   templates/matterchat-fullstack-compose.yml.j2
#   product-descriptions/matterchat.md
docker restart orchestrator           # reload REPOS_CONFIG (it's an additive entry; low blast radius)
docker logs orchestrator --tail 20    # confirm clean startup, no config import error
# sanity: the 6 core services are up
docker ps --format '{{.Names}}' | grep -E '^(traefik|webhook-handler|orchestrator|secrets-server|claude-agents|notifications)$' | wc -l   # -> 6
```
> Secrets: the Meteor template sets `MONGO_URL`/`MONGO_OPLOG_URL` (its own replica-set mongo) + `ROOT_URL` itself,
> so a *basic* preview needs no secrets-server entry. To exercise **Sign in with OmnisAI** in the preview, add the
> OIDC env to the matterchat secrets (or the template): `OMNISAI_OIDC_ENABLED=true`,
> `OMNISAI_OIDC_ISSUER=https://auth-app.stg-omnisai.io`, a DCR `OMNISAI_OIDC_CLIENT_ID` whose registered
> redirect_uri is `https://pr-<N>-matterchat.alpha.stg-omnisai.io/_omnisai/callback`, scope
> `openid profile email offline_access`. (Optional for first validation — MatterChat runs standalone without it.)

## 2. Trigger a preview
A `feature/*` PR head fires the webhook (base `develop` is fine — only the head gate applies). Use an existing
one (PR #2 `feature/matterchat-omnisai-oidc` or PR #3 `feature/matterchat-channel-matter-link`):
```bash
# push an empty commit OR re-open/sync the PR to fire pull_request.synchronize:
git commit --allow-empty -m "ci: trigger alpha preview" && git push
```
Webhook → orchestrator `POST /environments` → clone MatterChat@PR-branch → render the matterchat template →
`docker-compose up -d --build` (builds from source via `Dockerfile.alpha`).

## 3. Validate (the heavy part)
```bash
# on the box:
docker logs orchestrator -f            # watch CREATE_START -> building -> CREATE_SUCCESS (or BUILD_ERROR)
docker ps | grep pr-<N>-matterchat     # backend + its dedicated -mongodb container
docker logs pr-<N>-matterchat-mongodb  # expect rs.initiate() success (replSet rs0)
docker logs pr-<N>-matterchat-backend  # expect "SERVER RUNNING" banner
curl -s -o /dev/null -w "%{http_code}" https://pr-<N>-matterchat.alpha.stg-omnisai.io/api/info   # -> 200
```
Open `https://pr-<N>-matterchat.alpha.stg-omnisai.io` → setup wizard once → Boards in the left rail.

## Watch-fors (MatterChat is the first Meteor app on Alpha)
- **Heavy/slow first build.** `meteor build --server-only` is CPU+RAM heavy. If the build OOMs/times out, bump
  the build container memory or pre-warm; this is the flagged "on-box validation" risk.
- **Port = 3000.** Template sets `backend_port: 3000` (RC serves client+server+/api on one port). Wrong port =
  502 — the #1 alpha failure.
- **Replica set must initiate.** If the app logs `MongoError`/oplog errors, the `-mongodb` healthcheck
  `rs.initiate()` didn't run — check that container.
- **Disk.** Meteor images are large; check `df -h /data` (disk-full = total alpha outage).
- **No DB clone** (new fork, no staging data) — empty app on first boot is expected.

## After it works
- Merging PR #2/#3 → `develop` is "make it live" for MatterChat (its own deploy, separate from alpha).
- Teardown is automatic when the PR closes/merges (orchestrator `docker-compose down -v` + reconciler).
