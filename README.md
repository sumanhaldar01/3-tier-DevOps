# 3-Tier DevOps Hub — Full Setup, Deployment & Troubleshooting Guide

A DevOps/MLOps knowledge-base app (Node.js + Express backend, HTML frontend, MongoDB) — containerized, deployed to AWS EKS via GitOps (ArgoCD), with a full CI/CD pipeline (GitHub Actions + Trivy security scanning).

This README documents everything needed to run this project from scratch, **plus every real error hit during deployment and the exact fix** — so you don't have to rediscover them the hard way.

## Architecture

```
Developer → git push
    │
    ▼
GitHub Actions (CI)
  test → lint → docker build → trivy scan → docker push → update k8s manifest → argocd sync
    │
    ▼
ArgoCD (GitOps, running inside EKS)
  watches Git repo → applies manifests → keeps cluster in sync with Git
    │
    ▼
EKS Cluster
  ├── frontend pods  (LoadBalancer)
  ├── backend pods   (LoadBalancer)
  └── mongodb pod    (EBS-backed PersistentVolume)
```
## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | Plain HTML + `serve` |
| Backend | Node.js + Express + Mongoose |
| Database | MongoDB |
| Containers | Docker (multistage builds, `node:26-alpine3.22`) |
| Local dev | Docker Compose |
| Orchestration | Kubernetes (AWS EKS) |
| GitOps | ArgoCD |
| CI/CD | GitHub Actions |
| Security scanning | Trivy |
| Cloud | AWS (EKS, EC2, EBS, ELB, IAM) |

## Prerequisites — Local Machine (Linux)

```bash
# Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
sudo apt install -y docker-compose-plugin

# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# eksctl
curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz"
tar -xzf eksctl_Linux_amd64.tar.gz && sudo mv eksctl /usr/local/bin/

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/

# ArgoCD CLI
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd && sudo mv argocd /usr/local/bin/

# Helm (optional, for Prometheus/Grafana)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```
## Local Development

```bash
git clone <your-repo-url>
cd 3-tier-devops

docker compose up --build
# frontend: http://localhost:8080
# backend:  http://localhost:3000
```
`docker-compose.yml` runs all 3 services (frontend, backend, mongodb) on one Docker network. Services reach each other by container name (`mongodb`, `backend`) — Docker's internal DNS handles resolution.

## AWS Setup

### 1. IAM Policy for `eksctl`

**Do NOT use `AdministratorAccess`, and do NOT rely only on `AmazonEKSClusterPolicy`/`AmazonEKSWorkerNodePolicy`** — those are meant for the cluster's own service role, not the human running `eksctl`. They don't include `eks:CreateCluster`, which is what you actually need.

Create a custom policy (`eksctl-addon-policy.json`) with exactly what `eksctl` needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "EKSFullAccess", "Effect": "Allow", "Action": "eks:*", "Resource": "*" },
    { "Sid": "AutoScalingForManagedNodeGroups", "Effect": "Allow", "Action": [
        "autoscaling:CreateAutoScalingGroup", "autoscaling:DeleteAutoScalingGroup",
        "autoscaling:UpdateAutoScalingGroup", "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:DescribeScalingActivities", "autoscaling:CreateLaunchConfiguration",
        "autoscaling:DeleteLaunchConfiguration", "autoscaling:DescribeLaunchConfigurations",
        "autoscaling:CreateOrUpdateTags", "autoscaling:DeleteTags"
      ], "Resource": "*" },
    { "Sid": "SSMReadOnlyForAMILookup", "Effect": "Allow", "Action": "ssm:GetParameter", "Resource": "*" }
  ]
}
```

Attach this **alongside** the standard AWS managed policies: `AmazonEC2FullAccess`, `IAMFullAccess`, `AWSCloudFormationFullAccess`, `AmazonVPCFullAccess`.

```bash
aws configure
aws sts get-caller-identity   # confirm identity resolves correctly
```

### 2. EKS Cluster + OIDC + EBS CSI Driver — one file, one command

```yaml
# eks-cluster.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: devops-hub-cluster
  region: eu-north-1        # match your aws configure region
  version: "1.29"

iam:
  withOIDC: true             # replaces separate "associate-iam-oidc-provider" command

managedNodeGroups:
  - name: devops-hub-nodes
    instanceType: t3.medium
    desiredCapacity: 2
    minSize: 1
    maxSize: 3
    privateNetworking: true

addons:
  - name: aws-ebs-csi-driver
    wellKnownPolicies:
      ebsCSIController: true # auto IAM role (IRSA) + policy + addon install, all in one
```

```bash
eksctl create cluster -f eks-cluster.yaml
# takes 15-20 min — creates cluster + nodes + OIDC + EBS driver in one shot

kubectl get nodes
```

### 3. StorageClass for MongoDB — REQUIRED, EKS doesn't ship one usable by default

```yaml
# k8s-manifests/storageclass.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3
provisioner: ebs.csi.aws.com      # must be the CSI provisioner, NOT the legacy "kubernetes.io/aws-ebs"
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: gp3
```
```bash
kubectl apply -f k8s-manifests/storageclass.yaml
```
Reference it in MongoDB's PVC: `storageClassName: ebs-gp3`.
---
## ArgoCD Setup

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

kubectl patch svc argocd-server -n argocd -p '{"spec": {"type": "LoadBalancer"}}'

ARGOCD_SERVER=$(kubectl get svc argocd-server -n argocd -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)

argocd login $ARGOCD_SERVER --username admin --password $ARGOCD_PASSWORD --insecure
```
### Enable token generation — the non-obvious fix

Error: `account 'admin' does not have apiKey capability`

**Wrong instinct:** patching `argocd-rbac-cm` (that ConfigMap controls *permissions/roles* — what an account is allowed to do — not *capabilities* — what auth methods an account can use).

**Correct fix — patch `argocd-cm` with the exact right key:**
```bash
kubectl -n argocd patch configmap argocd-cm \
  --patch '{"data":{"accounts.admin":"apiKey, login"}}'
kubectl -n argocd rollout restart deployment argocd-server
```
`accounts.admin.apiKey: "true"` (the "obvious" guess) does **nothing** — ArgoCD doesn't read that key format at all.

```bash
argocd account generate-token --account admin
# copy this — it's your ARGOCD_TOKEN for GitHub Actions
```
### ArgoCD Application

```yaml
# argocd-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: devops-hub
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/yourusername/3-tier-DevOps
    targetRevision: main       # must match your ACTUAL default branch — see gotcha below
    path: k8s-manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```
```bash
kubectl apply -f argocd-app.yaml
```
---
## GitHub Secrets Required

| Secret | Value |
|---|---|
| `DOCKER_USERNAME` | your DockerHub username |
| `DOCKER_PASSWORD` | DockerHub Access Token — **must be "Read & Write" scope**, not "Read-only" |
| `ARGOCD_SERVER` | ArgoCD LoadBalancer hostname (no `https://`, no trailing slash) |
| `ARGOCD_TOKEN` | output of `argocd account generate-token` |

---
## CI/CD Pipeline Flow

```
test → lint → docker-backend + docker-frontend (parallel) → update-manifests → argocd-sync
```
Each docker job: build locally → Trivy scan → push only if scan passes → tags use `sha-<short-sha>` format via `docker/metadata-action`.

**Critical: every tag reference across the pipeline must use the identical format.** Multiple bugs today came from one step using `${{ env.SHORT_SHA }}` (bare hash) while another used the actual pushed tag `sha-${{ env.SHORT_SHA }}`. Keep these in sync everywhere: Trivy `image-ref`, the `sed` manifest update, and the `docker/metadata-action` tag output.

`update-manifests` job needs explicit write permission:
```yaml
permissions:
  contents: write
```
Without this, `git push` from inside the workflow fails with `403: Permission denied to github-actions[bot]` — `GITHUB_TOKEN` is read-only by default.

**ArgoCD auth in CI — skip `login`, use the env var directly:**
```yaml
env:
  ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_TOKEN }}
run: |
  argocd app sync devops-hub --server $ARGOCD_SERVER --insecure --grpc-web --force
  argocd app wait devops-hub --health --sync --insecure --grpc-web --timeout 180
```
`argocd login --auth-token` is unreliable in CI — it can fall through to an interactive username prompt with no TTY, hanging until timeout. Setting `ARGOCD_AUTH_TOKEN` as an env var and skipping `login` entirely is the reliable pattern.

---
## Full Troubleshooting Log — Every Error Hit & The Real Fix

### 1. `eks:CreateCluster` — not authorized
**Cause:** `AmazonEKSClusterPolicy` is for the cluster's service role, not the eksctl user.
**Fix:** custom policy with `eks:*` + autoscaling + ssm (see IAM section above).

### 2. `argocd: command not found`
**Cause:** CLI download step was skipped/failed silently.
**Fix:**
```bash
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd && sudo mv argocd /usr/local/bin/argocd
file argocd   # confirm it's a real ELF binary, not an HTML error page
```
### 3. `applicationsets.argoproj.io` CRD — "Too long" / controller CrashLoopBackOff
**Cause:** known kubectl annotation-size limit on large CRDs.
**Impact:** cosmetic only — doesn't affect `Application` resources (what this project uses).
**Fix (optional):**
```bash
kubectl apply --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/crds/applicationset-crd.yaml
```

### 4. `account 'admin' does not have apiKey capability`
See "ArgoCD Setup" section above — patch `argocd-cm`, not `argocd-rbac-cm`.

### 5. `unable to resolve 'main' to a commit SHA`
**Cause:** ArgoCD `targetRevision` said `main`, but the actual repo's default branch was `master`.
**Fix:** rename the branch to match (`git branch -m master main && git push -u origin main`), or update `targetRevision` to match reality. **Always verify actual branch name — don't assume.**

### 6. `ImagePullBackOff` — first deploy
**Cause:** manifests still had placeholder `yourdockerhubuser/backend:latest` — nothing with that name/tag was ever built.
**Fix:** manual bootstrap build + push once, correct usernames/tags, commit to Git.

### 7. MongoDB PVC stuck `Pending` — StorageClass not found
**Cause:** EKS has no usable default StorageClass out of the box.
**Fix:** create one explicitly, pointing at `ebs.csi.aws.com` (the CSI provisioner) — **not** the legacy in-tree `kubernetes.io/aws-ebs`, which is deprecated/non-functional on modern Kubernetes versions.

### 8. PVC storageClassName change rejected — "spec is immutable"
**Cause:** `storageClassName` cannot be changed on an existing PVC via `kubectl apply`.
**Fix:** must delete the **Deployment first** (so nothing references the PVC), then delete the PVC, then recreate — deleting the PVC alone while a pod still references it just hangs forever (blocked by the `pvc-protection` finalizer).
```bash
kubectl delete deployment mongodb -n devops-hub
kubectl delete pvc mongodb-pvc -n devops-hub
kubectl apply -f k8s-manifests/
```

### 9. ArgoCD `selfHeal` reverting manual `kubectl` changes
**Cause:** with `selfHeal: true`, ArgoCD treats Git as the only valid state — any live cluster edit not backed by a Git commit gets silently reverted within seconds.
**Fix:** always edit the YAML → commit → push → let ArgoCD sync. Never patch the live cluster directly and expect it to stick.

### 10. MongoDB `Authentication failed`
**Cause:** ConfigMap had `MONGO_URI: "...:$(MONGO_PASSWORD)@..."` — **ConfigMaps do not do variable substitution.** The literal 18-character string `$(MONGO_PASSWORD)` was being used as the actual password.
**Fix:** build the URI from real Secret references inside the container's `env:` block (where `$(VAR)` sibling-reference expansion genuinely works):
```yaml
env:
  - name: MONGO_USERNAME
    valueFrom: { secretKeyRef: { name: mongodb-secret, key: mongo-username } }
  - name: MONGO_PASSWORD
    valueFrom: { secretKeyRef: { name: mongodb-secret, key: mongo-password } }
  - name: MONGO_URI
    value: "mongodb://$(MONGO_USERNAME):$(MONGO_PASSWORD)@mongodb-service:27017/myapp?authSource=admin"
```

### 11. Trivy `FATAL ... No such image` / `manifest unknown`
**Cause:** `image-ref` in the Trivy step used the bare short SHA, but the actual built/pushed tag (via `docker/metadata-action`, `type=sha,format=short`) was `sha-<hash>`. Mismatched tag format between build and scan steps.
**Fix:** make every tag reference consistent — `sha-${{ env.SHORT_SHA }}` everywhere, including the `sed` manifest-update command.

### 12. DockerHub `401 Unauthorized: access token has insufficient scopes`
**Cause:** the Access Token behind `DOCKER_PASSWORD` was created as "Read-only."
**Fix:** regenerate as "Read & Write," update the GitHub secret.

### 13. Trivy false-positive CVEs: `tar`, `picomatch`, `sigstore`
**Cause:** these packages don't exist in the project's own `package.json` — confirmed via `npm ls <package>` returning empty. They're bundled **inside npm itself**, which ships preinstalled in the base `node:alpine` image.
**Diagnosis:**
```bash
docker run --rm --entrypoint sh <image> -c \
  "find / -name package.json 2>/dev/null | xargs grep -l '\"tar\"' 2>/dev/null"
# → /usr/local/lib/node_modules/npm/node_modules/tar/package.json
```
**Fix:** strip npm from the production image entirely — it's never called at runtime (`CMD ["node", "src/index.js"]`, not `npm start`):
```dockerfile
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
```
(Must run as root, before `USER node`.)

### 14. `git push` from pipeline → `403 Permission denied to github-actions[bot]`
**Cause:** `GITHUB_TOKEN` is read-only by default.
**Fix:** add `permissions: { contents: write }` to the workflow (and/or enable "Read and write permissions" under repo Settings → Actions → General).

### 15. `argocd account generate-token` inside pipeline → `"EOF"` + hung `Username:` prompt
**Cause:** `argocd login --auth-token <token>` is an unreliable combination — falls through to interactive auth with no TTY available in CI.
**Fix:** skip `argocd login` entirely. Set `ARGOCD_AUTH_TOKEN` as an environment variable and call `argocd app sync` / `argocd app wait` directly — the CLI reads that env var automatically on every command.

### 16. New pods stuck `ImagePullBackOff` — `manifest unknown` for a tag that DOES exist on DockerHub
**Cause:** same root issue as #11, but in the `update-manifests` job's `sed` command this time — it wrote the bare SHA into the manifest, missing the `sha-` prefix the actual image was tagged with.
**Fix:** add `sha-` prefix in the `sed` replacement string too, matching what's actually on DockerHub.

### 17. Frontend shows "backend offline"
**Cause:** hardcoded `http://localhost:3000` in frontend JS — works in local Docker Compose, meaningless in a browser hitting a cloud-hosted frontend (localhost = the user's own machine).
**Fix:** point at the real backend LoadBalancer hostname, **including the port** (`:3000` — LoadBalancer doesn't default to it).

### 18. Fix appears to not deploy — browser still shows old behavior
**Diagnosis order:**
```bash
argocd app get devops-hub                                    # confirm Synced + Healthy
kubectl exec deployment/frontend -- grep "http://" src/index.html   # confirm pod has NEW code
```
If pod confirms new code but browser still misbehaves → **browser cache**, not deployment. Test in Incognito to isolate.

### 19. LoadBalancer URL that "used to work" now unreachable, but old bookmark still resolves
**Cause:** flipping a Service's `type` back and forth (ClusterIP ↔ LoadBalancer) — often via ArgoCD `selfHeal` reverting an un-committed manual patch — tears down the old AWS ELB and provisions a brand new one each time. Old ELB can remain orphaned (not cleanly deleted), still routing to current pods via a shared NodePort, and silently costing money.
**Fix:** always re-fetch the current hostname, never trust a previously bookmarked one:
```bash
kubectl get svc <service-name> -n <namespace> -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```
**Cleanup orphaned ELBs:**
```bash
aws elb describe-load-balancers --region <region> --query "LoadBalancerDescriptions[*].{Name:LoadBalancerName,DNS:DNSName}" --output table
aws elb delete-load-balancer --load-balancer-name <orphaned-name> --region <region>
```
---
## Debug Commands Cheat Sheet

```bash
# ── Pod status & logs ──
kubectl get pods -n devops-hub
kubectl describe pod <pod-name> -n devops-hub          # check Events: section at the bottom
kubectl logs <pod-name> -n devops-hub                   # current logs
kubectl logs <pod-name> -n devops-hub --previous         # logs from BEFORE last crash/restart
kubectl logs <pod-name> -n devops-hub -f                 # stream/follow live

# ── Storage ──
kubectl get pvc -n devops-hub
kubectl describe pvc <pvc-name> -n devops-hub            # Events: section shows exact provisioning error
kubectl get storageclass

# ── Services / networking ──
kubectl get svc -n devops-hub
kubectl get svc <svc-name> -n devops-hub -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
kubectl exec -it <pod-name> -n devops-hub -- sh           # shell into a pod

# ── Cluster-wide event timeline (often the fastest way to see what actually happened) ──
kubectl get events -n devops-hub --sort-by=.metadata.creationTimestamp | tail -30

# ── Secrets / Config (decode, don't guess) ──
kubectl get secret <name> -n devops-hub -o jsonpath='{.data.<key>}' | base64 -d; echo
kubectl get configmap <name> -n devops-hub -o yaml

# ── ArgoCD ──
argocd app get devops-hub                  # Sync Status, Health Status, resource tree
argocd app get devops-hub --hard-refresh   # bypass cache, force re-read from Git
argocd app sync devops-hub --insecure --grpc-web
argocd app manifests devops-hub            # see exactly what ArgoCD WILL apply
argocd app terminate-op devops-hub         # unstick a hung sync operation
argocd account list                        # confirm capabilities (apiKey, login)
argocd repo list                           # confirm Git repo connectivity

# ── EKS / AWS ──
aws sts get-caller-identity
aws eks describe-addon --cluster-name devops-hub-cluster --addon-name aws-ebs-csi-driver --query "addon.status"
aws elb describe-load-balancers --region <region> --output table
kubectl get nodes
kubectl top nodes                           # resource usage, catches capacity issues

# ── Docker / Trivy locally, before pushing to CI ──
docker build -t test-image ./backend
trivy image test-image --severity HIGH,CRITICAL
docker run --rm --entrypoint sh test-image -c "find / -name package.json 2>/dev/null"
```
---

## Key Lessons

1. **Read the actual error message text** — it almost always states exactly what's wrong (`"storageclass ... not found"` means literally that).
2. **GitOps means Git is the only source of truth** — manual `kubectl` edits without a matching commit get silently undone by `selfHeal`.
3. **ConfigMaps don't expand variables** — `$(VAR)` only works inside a container's own `env:` block, never inside `data:` values.
4. **PVC `storageClassName` is immutable** — plan storage classes correctly the first time, or budget for a delete/recreate cycle.
5. **Keep image tag formats consistent across every pipeline step** — build, scan, and manifest-update must all reference the exact same tag string.
6. **Containers should invoke runtimes directly** (`node file.js`), not through `npm start` — better signal handling (PID 1 problem) and lets you safely strip npm from production images.
7. **Default tokens/permissions are usually more restrictive than expected** — `GITHUB_TOKEN` (read-only), DockerHub tokens (scope-specific), ArgoCD admin (login-only) all needed explicit elevation.
8. **LoadBalancer hostnames are not stable across Service recreation** — always re-fetch, never hardcode long-term, and clean up orphaned ELBs to avoid silent cost.

---

## Cleanup — stop all AWS billing

```bash
helm uninstall monitoring -n monitoring 2>/dev/null
kubectl delete -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl delete -f k8s-manifests/
eksctl delete cluster --name devops-hub-cluster --region <your-region>

# verify nothing orphaned remains
aws elb describe-load-balancers --region <your-region> --output table
# AWS Console → EC2 → Volumes → delete any orphaned EBS volumes manually
```
