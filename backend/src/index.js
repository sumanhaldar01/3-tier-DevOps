const MONGO_URI = process.env.MONGO_URI || `mongodb://admin:${process.env.MONGO_PASSWORD}@mongodb-service:27017/myapp?authSource=admin`;
const PORT = process.env.PORT || 3000;

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- Schema ---
// Each "topic" = one DevOps concept card shown in the UI
const TopicSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  category:    { type: String, enum: ['DevOps', 'DevSecOps', 'MLOps', 'Tools'], required: true },
  summary:     { type: String, required: true },  // short — shown on card
  content:     { type: String, required: true },  // long — shown on expand
  tags:        [String],                          // e.g. ["CI/CD", "Docker"]
  createdAt:   { type: Date, default: Date.now }
});

const Topic = mongoose.model('Topic', TopicSchema);

// --- Seed data ---
// Runs ONCE on first startup if DB is empty.
// Fills the app with real DevOps content so it looks good in interviews.
const SEED = [
  {
    title: 'What is DevOps?',
    category: 'DevOps',
    summary: 'DevOps = Dev + Ops teams working as one unit with shared tools, goals, and accountability.',
    content: `DevOps is a culture and set of practices that unifies software Development (Dev) and IT Operations (Ops).

Before DevOps: Dev wrote code → threw it over the wall → Ops deployed it → everyone blamed each other when it broke.

After DevOps:
- Same team owns code from commit to production
- Automation replaces manual handoffs (CI/CD pipelines)
- Monitoring gives feedback loops so you catch issues fast
- "You build it, you run it" — teams own their services end to end

Core pillars: Culture, Automation, Lean, Measurement, Sharing (CALMS).

Key metrics: Deployment frequency, Lead time for changes, MTTR (Mean Time To Recovery), Change failure rate.`,
    tags: ['Culture', 'CALMS', 'DORA Metrics']
  },
  {
    title: 'Core DevOps Tools',
    category: 'Tools',
    summary: 'The DevOps toolchain: Git → CI/CD → Docker → Kubernetes → Prometheus → Grafana.',
    content: `Every DevOps engineer needs to know this toolchain:

SOURCE CONTROL
→ Git + GitHub/GitLab — version everything, including infra config

CI/CD
→ GitHub Actions, Jenkins, GitLab CI — automate build/test/deploy

CONTAINERIZATION
→ Docker — package app + dependencies into portable image
→ Docker Compose — run multi-container apps locally

ORCHESTRATION
→ Kubernetes — run containers at scale, self-healing, rolling updates
→ Helm — package manager for Kubernetes (like apt for k8s)

GITOPS
→ ArgoCD, Flux — Git is source of truth, cluster syncs to it

INFRASTRUCTURE AS CODE
→ Terraform — provision cloud resources with code
→ Ansible — configure servers with code

MONITORING
→ Prometheus — scrapes and stores metrics as time series
→ Grafana — visualizes metrics into dashboards
→ Loki — log aggregation (like Prometheus but for logs)

SECURITY
→ Trivy — scan images for CVEs
→ Vault — secrets management`,
    tags: ['Docker', 'Kubernetes', 'Terraform', 'Prometheus']
  },
  {
    title: 'DevOps → DevSecOps',
    category: 'DevSecOps',
    summary: 'DevSecOps = security baked into every pipeline stage, not bolted on at the end.',
    content: `DevSecOps = Development + Security + Operations.

The old way: security team reviews code before release → bottleneck → devs hate it → security gets skipped.

The DevSecOps way: security checks happen automatically in every pipeline run.

SHIFT LEFT = move security earlier in the lifecycle:

1. CODE stage
   → SAST (Static Analysis): Snyk, SonarQube scan your code for vulnerabilities as you write it

2. BUILD stage  
   → Trivy scans Docker images for CVE vulnerabilities
   → Hadolint lints Dockerfiles for bad practices

3. DEPLOY stage
   → OPA/Kyverno: policy-as-code, block non-compliant k8s manifests
   → Kubernetes RBAC: least-privilege access controls

4. RUNTIME stage
   → Falco: detects suspicious container behavior in real time
   → Network policies: pods can only talk to who they need to

SECRETS MANAGEMENT (critical):
→ Never commit secrets to Git — use HashiCorp Vault or AWS Secrets Manager
→ Kubernetes Secrets (base64 encoded, not encrypted by default — use Sealed Secrets or External Secrets Operator for prod)

CVE = Common Vulnerabilities and Exposures. Public database of known security holes.
Severity: Critical > High > Medium > Low`,
    tags: ['Trivy', 'SAST', 'Shift-Left', 'Secrets', 'CVE']
  },
  {
    title: 'What is MLOps?',
    category: 'MLOps',
    summary: 'MLOps = DevOps practices applied to Machine Learning models. Same problems, different artifacts.',
    content: `MLOps = Machine Learning + Operations.

DevOps manages code. MLOps manages code + data + models + experiments.

Why MLOps is hard:
- Models degrade over time as real-world data drifts from training data (model drift)
- You need to track experiments (which hyperparameters gave best accuracy?)
- Retraining pipelines are complex — new data → retrain → evaluate → promote → deploy
- Models are large binary artifacts (GB) — regular CI/CD doesn't handle this well

MLOps STACK:

EXPERIMENT TRACKING
→ MLflow, Weights & Biases — log metrics, params, model versions per experiment

FEATURE STORE  
→ Feast, Tecton — store/share ML features across teams consistently

PIPELINE ORCHESTRATION
→ Kubeflow, Airflow, Prefect — automate data → train → evaluate → deploy pipelines

MODEL REGISTRY
→ MLflow Registry, SageMaker Model Registry — version and approve models before deployment

MODEL SERVING
→ Seldon, BentoML, Triton — serve model predictions as API endpoints
→ A/B testing: route 10% traffic to new model, 90% to old

MONITORING
→ Evidently AI — detect data drift, model performance degradation
→ Grafana — visualize model latency, prediction distribution

MLOps maturity levels:
Level 0: Manual training, manual deploy
Level 1: Automated training pipelines
Level 2: Full CI/CD for ML — automated retrain + deploy on data drift`,
    tags: ['MLflow', 'Kubeflow', 'Model Drift', 'Feature Store']
  },
  {
    title: 'CI/CD Pipeline Deep Dive',
    category: 'DevOps',
    summary: 'CI = merge code fast and test automatically. CD = deploy that tested code automatically.',
    content: `CI/CD = Continuous Integration + Continuous Delivery/Deployment.

CONTINUOUS INTEGRATION (CI):
→ Developers merge to main branch frequently (multiple times/day)
→ Every merge triggers automated: lint → test → build → scan
→ Goal: catch bugs in minutes, not days
→ Tools: GitHub Actions, GitLab CI, Jenkins, CircleCI

CONTINUOUS DELIVERY (CD):
→ Every passing build is automatically deployable
→ Deployment to prod is one-click (human approves)
→ Tools: ArgoCD, Spinnaker, Flux

CONTINUOUS DEPLOYMENT:
→ Every passing build auto-deploys to prod — no human needed
→ Requires very high test coverage and feature flags

A GOOD PIPELINE:
1. Checkout code
2. Install dependencies
3. Run unit tests          ← fast, catch logic bugs
4. Run integration tests   ← catch service interaction bugs  
5. Build Docker image
6. Scan image (Trivy)      ← catch security bugs
7. Push to registry
8. Update k8s manifest tag ← GitOps trigger
9. ArgoCD detects + deploys
10. Smoke test in prod     ← verify deployment worked

DEPLOYMENT STRATEGIES:
→ Rolling update: replace pods one by one (zero downtime, k8s default)
→ Blue/Green: two identical envs, flip traffic at once (instant rollback)
→ Canary: 5% traffic to new version, watch metrics, then full rollout`,
    tags: ['GitHub Actions', 'CI', 'CD', 'Rolling Update', 'Canary']
  },
  {
    title: 'Kubernetes Fundamentals',
    category: 'Tools',
    summary: 'Kubernetes = self-healing container orchestrator. It keeps your app running even when things break.',
    content: `Kubernetes (k8s) runs and manages containers at scale.

CORE OBJECTS:

Pod — smallest unit. One or more containers sharing network + storage.
     Pods are ephemeral — they die and get replaced. Never rely on pod IP.

Deployment — manages a set of identical pods.
     Set replicas: 3 → k8s ensures 3 pods always running.
     Rolling updates, rollbacks built in.

Service — stable network endpoint for pods.
     ClusterIP: internal only
     NodePort: exposed on node port (dev/testing)
     LoadBalancer: cloud load balancer (prod)

ConfigMap — non-sensitive config as key-value pairs injected as env vars.

Secret — sensitive config (passwords, tokens) base64 encoded.

PersistentVolumeClaim — request for storage that survives pod restarts.
     Databases MUST use PVCs or data is gone on pod restart.

Ingress — HTTP routing rules. One load balancer → many services by path/domain.

HorizontalPodAutoscaler — auto scale pods based on CPU/memory.

KEY COMMANDS:
kubectl get pods                    # list pods
kubectl describe pod <name>         # debug a pod
kubectl logs <pod> -f               # stream logs
kubectl exec -it <pod> -- sh        # shell into pod
kubectl rollout undo deployment/app # rollback deployment`,
    tags: ['Pod', 'Deployment', 'Service', 'Ingress', 'HPA']
  },
  {
    title: 'The Future: Platform Engineering',
    category: 'MLOps',
    summary: 'Platform Engineering = building internal developer platforms so devs self-serve infra without needing DevOps every time.',
    content: `Where DevOps is heading in 2024-2025:

PLATFORM ENGINEERING:
DevOps at scale hits a problem — every team asks the platform team for help.
Platform Engineering solves this by building Internal Developer Platforms (IDPs).
Developers self-serve: spin up environments, deploy apps, get monitoring — without tickets.
Tools: Backstage (Spotify's open-source IDP), Crossplane, Port

AI + DEVOPS (AIOps):
→ GitHub Copilot writes pipeline YAML and Dockerfiles
→ AI detects anomalies in metrics (finds issues before humans notice)
→ Automated root cause analysis from logs
→ Natural language infra: "create a postgres database" → Terraform runs

FINOPS:
→ Cloud costs are now a DevOps concern
→ Right-size resources, kill idle workloads, reserved vs spot instances
→ Tools: Kubecost (k8s cost visibility), Infracost (Terraform cost estimation)

EBPF:
→ New Linux kernel tech — observe everything at kernel level with zero overhead
→ Powers Cilium (networking), Pixie (observability), Falco (security)
→ Will replace sidecar proxy pattern (no more Istio complexity)

WASM (WebAssembly) on server:
→ Lighter than containers, faster cold start, multi-language
→ Possible next step after containers for edge computing

GOLDEN PATH:
Best practice: DevOps team defines "golden paths" (opinionated templates for new services)
New dev clones template → CI/CD, monitoring, security scanning all pre-wired.
Less choice = faster, safer, more consistent.`,
    tags: ['Platform Engineering', 'AIOps', 'FinOps', 'eBPF', 'Backstage']
  }
];

// --- DB Connect + Seed ---
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');

    // Check if DB already has data — if yes, skip seeding
    const count = await Topic.countDocuments();
    if (count === 0) {
      await Topic.insertMany(SEED);
      console.log(`✅ Seeded ${SEED.length} DevOps topics`);
    }

    app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// --- Routes ---

// GET /api/topics — all topics, optional ?category= filter
app.get('/api/topics', async (req, res) => {
  try {
    const filter = req.query.category ? { category: req.query.category } : {};
    const topics = await Topic.find(filter).sort({ createdAt: -1 });
    res.json(topics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/topics/:id — single topic (for expanded view)
app.get('/api/topics/:id', async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id);
    if (!topic) return res.status(404).json({ error: 'Not found' });
    res.json(topic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/topics — add your own note/topic
app.post('/api/topics', async (req, res) => {
  try {
    const { title, category, summary, content, tags } = req.body;
    const topic = new Topic({ title, category, summary, content, tags: tags || [] });
    await topic.save();
    res.status(201).json(topic);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Health check for k8s liveness probe
app.get('/health', (req, res) => res.json({ status: 'ok' }));