# MatterChat — Staging Deploy Runbook

How MatterChat (Rocket.Chat / Meteor fork) gets from a commit to a live staging
site, what the running system looks like, and the gotchas we hit building it.

---

## (a) Overview

A push to the **`staging` branch** auto-deploys MatterChat to staging. (The
repo's default/working branch is `develop`; the deploy fires **only** on
`staging`, and on manual `workflow_dispatch`.)

- **Workflow:** `.github/workflows/matterchat-staging-deploy.yaml`
- **Cluster:** EKS `stg-omnisai-cluster` in **us-west-2**
- **Namespace:** `staging`
- **Public URL:** https://matterchat.stg-omnisai.io
- **ECR repo:** `matterchat`

Pipeline (single `build-and-deploy` job):

1. **Build** the heavy Meteor server bundle from source via
   `apps/meteor/.docker/Dockerfile.alpha` (multi-stage; `meteor build
   --server-only`). Runs on a large `blacksmith-8vcpu-ubuntu-2204` runner —
   `ubuntu-latest` is too small (~20–35 min, ~6 GB).
2. **Push** to ECR, tagged `staging-<sha8>` and `staging-latest`. Buildx
   registry cache (`:cache`) speeds re-builds.
3. **Apply** the k8s manifests (Mongo StatefulSet + app Deployment/Service/Ingress).
4. **Rollout**: wait for the Mongo StatefulSet, `kubectl set image` the app
   Deployment to the freshly built `staging-<sha8>`, then wait for the app
   rollout (600s timeout — Meteor boot + migrations are slow).

A `concurrency` group (`matterchat-staging-deploy`, `cancel-in-progress: false`)
prevents two deploys racing on the same cluster resources.

---

## (b) Architecture

```
                      ALB  (group: staging-backend-shared, order 870)
          internet ──►  wildcard *.stg-omnisai.io cert (HTTPS 443, →443 redirect)
                              │  host: matterchat.stg-omnisai.io
                              ▼
               Service matterchat (ClusterIP :80 → :3000)
                              │
                              ▼
        ┌──────────────────────────────────────────┐
        │ Deployment matterchat (replicas: 1)        │
        │   single Meteor container, port 3000       │
        │   strategy: Recreate                       │
        └──────────────────────────────────────────┘
                              │  MONGO_URL / MONGO_OPLOG_URL
                              ▼
        Service matterchat-mongo (headless, :27017, publishNotReadyAddresses)
                              │
                              ▼
        StatefulSet matterchat-mongo (replicas: 1, mongo:8.0)
          single-node replica set "rs0" → gives Meteor its oplog
          10Gi PVC (volumeClaimTemplate "data")
```

- **App** — one Meteor container on **port 3000**, `replicas: 1`,
  `strategy: Recreate` (Meteor/DDP sessions are sticky; avoid two versions
  racing the same Mongo during a roll). Probes hit `/api/info`. Boot is slow,
  so readiness `initialDelaySeconds: 90` and liveness `180s` / `failureThreshold: 8`
  (first cold boot also runs Rocket.Chat migrations against an empty DB).
- **Mongo** — in-cluster **single-node replica set `rs0`** (`mongo:8.0`,
  StatefulSet, 10Gi PVC). The replica set is required so the `local` database
  (and thus the **oplog**) exists — Rocket.Chat tails the oplog for realtime.
  A `postStart` lifecycle hook runs `rs.initiate()` idempotently (initiates only
  when `rs.status()` throws code 94 NotYetInitialized; no-op otherwise, safe
  across restarts). Readiness gates on the member being PRIMARY/SECONDARY so the
  app never connects before `rs0` is usable.
- **Ingress** — ALB, `internet-facing`, `target-type: ip`. Shares the ALB
  `group.name: staging-backend-shared` with the other tenants at
  **`group.order: 870`** (unique). Wildcard ACM cert
  `arn:aws:acm:us-west-2:921840973142:certificate/88281aef-...`. Healthcheck
  `/api/info`, success codes `200,201,204,302`. `lb_cookie` stickiness is on so
  DDP websocket clients stay pinned to a pod (matters once replicas > 1).

**Service/URL contract (must stay in sync across all three files):**

| Thing            | Value                                                        |
|------------------|-------------------------------------------------------------|
| Mongo Service    | `matterchat-mongo:27017`                                     |
| `MONGO_URL`      | `mongodb://matterchat-mongo:27017/matterchat?replicaSet=rs0` |
| `MONGO_OPLOG_URL`| `mongodb://matterchat-mongo:27017/local?replicaSet=rs0`      |
| `rs.initiate` host | `matterchat-mongo:27017` (Service DNS, **not** pod hostname) |

> The `rs.initiate` member host must be the stable Service DNS name. If it's the
> pod hostname instead, the Meteor driver follows the rs config's advertised
> host and can't reach it.

---

## (c) Environment variables

Set on the app Deployment (`kubernetes/staging/matterchat-deployment-staging.yaml`):

| Var                          | Value                                                        | Purpose |
|------------------------------|-------------------------------------------------------------|---------|
| `ROOT_URL`                   | `https://matterchat.stg-omnisai.io`                         | Public base URL (Meteor) |
| `PORT`                       | `3000`                                                       | App port |
| `NODE_ENV`                   | `production`                                                 | |
| `MONGO_URL`                  | `mongodb://matterchat-mongo:27017/matterchat?replicaSet=rs0` | App DB |
| `MONGO_OPLOG_URL`            | `mongodb://matterchat-mongo:27017/local?replicaSet=rs0`      | Oplog tail (realtime) |
| `OVERWRITE_SETTING_Iframe_Restrict_Access` | `false`                                       | Allow iframe embedding |
| `OMNISAI_OIDC_ENABLED`       | `true`                                                       | Enable CentralizedAuth SSO |
| `OMNISAI_OIDC_ISSUER`        | `https://auth-app.stg-omnisai.io`                           | OIDC issuer |
| `OMNISAI_OIDC_CLIENT_ID`     | `EEHKZTxmyKVvUXThDFuHSTAxQCgxePis`                          | OIDC client id |
| `LITBOX_API_URL`             | `https://litbox-app.stg-omnisai.io`                         | LitBox file storage integration |

Build-time secret (CI, **not** in manifests): **`NPM_TOKEN`** — passed as a
Docker build-arg for the `@omnisaiorg` GitHub Packages scope. AWS creds
(`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) are GitHub Actions secrets.

---

## (d) Gotchas we hit and fixed

Each of these was a real failure during bring-up. Documented so the next person
(or the next product) doesn't re-derive them.

### 1. Dockerfile builder was missing Deno
The `meteor build` stage failed because Deno wasn't on PATH. Rocket.Chat's
`@rocket.chat/apps` package runs a `build:deno-cache` step during `yarn build`,
and `meteor build` then can't find `packages/livechat/dist` (and others) if that
prebuild didn't run. **Fix:** copy a Deno binary into the builder stage.

### 2. Two Deno versions — 2.3.1 (build) vs 1.37.1 (runtime)
The Apps-Engine **runtime** bakes Deno **1.37.1**, but the build-time
`build:deno-cache` script requires Deno **2.3.1**. They are not interchangeable.
**Fix:** the Dockerfile defines both as separate stages and each stage copies the
one it needs:
```dockerfile
ARG DENO_VERSION="1.37.1"        # runtime
ARG DENO_BUILD_VERSION="2.3.1"   # build
FROM denoland/deno:bin-${DENO_VERSION}       AS deno
FROM denoland/deno:bin-${DENO_BUILD_VERSION} AS deno_build
# builder: COPY --from=deno_build /deno /usr/local/bin/deno
# runtime: COPY --from=deno       /deno /bin/deno
```

### 3. `.dockerignore` must NOT exclude `.git`
The Rocket.Chat `meteor build` runs `git log` to embed version/commit info. With
`.git` excluded from the build context it fails with `Command failed: git log`.
**Fix:** `.dockerignore` deliberately keeps `.git`. (The CI checkout is shallow,
so `.git` stays small.) Don't "tidy up" by adding `.git` to `.dockerignore`.

### 4. StatefulSet immutable fields require delete + recreate
A StatefulSet's `serviceName`, `selector`, `volumeClaimTemplates`, and
`podManagementPolicy` are immutable — `kubectl apply` errors if they changed
versus an existing object (e.g. from an earlier partial setup). **Fix:** the
deploy step falls back to delete + recreate:
```bash
kubectl apply -f kubernetes/staging/matterchat-mongo.yaml || {
  kubectl delete statefulset matterchat-mongo -n staging --ignore-not-found --wait=true
  kubectl apply -f kubernetes/staging/matterchat-mongo.yaml
}
```
Deleting a StatefulSet does **not** delete its PVCs, so Mongo data is preserved
and re-adopted by the new object.

### 5. `NPM_TOKEN` must be ENV-promoted for the `@omnisaiorg` scope
The build pulls private packages (e.g. `@omnisaiorg/litbox-file-browser`) from
GitHub Packages. This is a **Yarn 4** repo: `.yarnrc.yml` routes the
`@omnisaiorg` scope to `npm.pkg.github.com` with `npmAuthToken "${NPM_TOKEN-}"`.
Yarn 4 reads `.yarnrc.yml`, **not** `.npmrc` — the old `.npmrc` line was both
wrong-registry and ignored. **Fix:** promote the build-arg to an **env var** in
the builder stage so Yarn picks it up:
```dockerfile
ARG NPM_TOKEN
ENV NPM_TOKEN=${NPM_TOKEN} ...
```
CI passes it via `build-args: NPM_TOKEN=${{ secrets.NPM_TOKEN }}`. A 401/E404 on
`@omnisaiorg` packages during build means this token is missing or expired.

### 6. ALB `group.order` must be unique
All staging tenants share one ALB via `group.name: staging-backend-shared`. If
two ingresses claim the same `group.order`, the AWS Load Balancer Controller
**fails to reconcile the whole group**, breaking *every* tenant on that ALB —
not just MatterChat. **Fix:** MatterChat takes **`870`**, which was free. Known
occupied orders in this group:

| order | tenant |
|-------|--------|
| 100   | auth-app |
| 800   | crm-app |
| 850   | casepro-mcp-v2 |
| 860   | carepro / matterchat-mcp-v2 |
| 870   | **matterchat** (this app) |

Before changing it, confirm the new order is unused across the group.

### 7. Mongo headless Service needs `publishNotReadyAddresses`
Chicken-and-egg on first boot: the pod stays **NotReady** until `rs0` has a
PRIMARY, but the `postStart` hook can only produce a PRIMARY by running
`rs.initiate()` — which needs `matterchat-mongo:27017` to resolve while the pod
is still NotReady. A normal headless Service won't publish a NotReady pod's
address, so DNS fails and initiate hangs forever. **Fix:**
`publishNotReadyAddresses: true` on the Service so the address resolves during
`rs.initiate()`.

---

## (e) How to deploy & troubleshoot

### Deploy
- **Automatic:** push/merge to the **`staging`** branch. The workflow runs end to
  end and rolls the app to `staging-<sha8>`.
- **Manual:** GitHub Actions → *MatterChat — Staging Deploy* → **Run workflow**
  (`workflow_dispatch`).

### Watch a deploy
- **CI logs:** GitHub Actions → the run. Slowest/most-failure-prone steps:
  *Build and push image* (Meteor build) and *Wait for app rollout*.
- **Rollouts (kubectl):**
  ```bash
  aws eks update-kubeconfig --region us-west-2 --name stg-omnisai-cluster
  kubectl -n staging rollout status statefulset/matterchat-mongo --timeout=180s
  kubectl -n staging rollout status deployment/matterchat --timeout=600s
  kubectl -n staging get pods -l app=matterchat
  ```

### Troubleshoot
- **App crash-loops on first deploy** — *expected* until `rs0` is initiated and
  reachable. Confirm Mongo is up before chasing the app:
  ```bash
  kubectl -n staging logs statefulset/matterchat-mongo -c mongo | grep rs-init
  kubectl -n staging exec -it matterchat-mongo-0 -- mongosh --quiet --eval "rs.status().ok"
  ```
- **App logs:**
  ```bash
  kubectl -n staging logs deploy/matterchat --tail=200 -f
  ```
- **Build fails on `@omnisaiorg` packages (401/E404)** — `NPM_TOKEN` secret
  missing/expired (gotcha #5).
- **Build fails `Command failed: git log`** — `.git` got excluded from the build
  context (gotcha #3).
- **Build fails finding `packages/.../dist` / Deno errors** — Deno missing or
  wrong version in the builder (gotchas #1, #2).
- **`apply` errors on the StatefulSet (immutable field)** — let the workflow's
  delete+recreate fallback run, or do it by hand (gotcha #4); PVCs persist.
- **502 / site down across multiple staging apps** — suspect an ALB group
  reconcile failure; check `group.order` collisions (gotcha #6):
  ```bash
  kubectl -n staging describe ingress matterchat
  kubectl -n kube-system logs deploy/aws-load-balancer-controller | tail -50
  ```
- **Realtime/oplog not working** — verify `MONGO_OPLOG_URL` points at `/local`
  and `rs0` is healthy (`rs.status()`).

---

## File map

| File | Role |
|------|------|
| `.github/workflows/matterchat-staging-deploy.yaml` | The deploy pipeline (push to `staging`) |
| `apps/meteor/.docker/Dockerfile.alpha` | From-source multi-stage Meteor build |
| `.dockerignore` | Lean build context (keeps `.git`) |
| `kubernetes/staging/matterchat-mongo.yaml` | Mongo headless Service + StatefulSet (`rs0`) |
| `kubernetes/staging/matterchat-deployment-staging.yaml` | App Deployment + Service + ALB Ingress |
