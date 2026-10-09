# Agent Liaison Hub

A central app where every project's teams (dev, devops, infra, security, ...) each get a **liaison agent** that acts
as the team's point of contact. A developer's Claude Code asks the infra agent "which Vault path holds the staging DB
credentials?" instead of pinging people; the agent answers from the team's MCP servers and skills, or escalates to the
one or two people from that team who are on the project. Every exchange is mirrored to the project repository's
**GitHub Discussions**, so there is a searchable record and humans can step in by commenting.

The Hub also handles onboarding: people and their roles, which MCP servers and skills each team's agent gets, and a
two-command setup that connects anyone's Claude Code (VS Code extension or CLI) to the project.

## How a request flows

```
Claude Code (dev)          Hub (web + worker)                  kagent                 GitHub
  hub MCP: ask(infra) ──▶  Request #12 created ──────────────▶  Discussion "#12 ..." in "Infrastructure"
                           worker: A2A message/send ─────────▶  Agent hub-payments-infra
                                                                 (read-only MCP tools, team skills)
                           <hub-result> answered, 0.9  ◀──────
                           policy: confident + allowed  ─────────────────────────────▶  answer comment
  wait_for(12) ◀────────── ANSWERED
```

- **answered** with confidence above the agent's threshold: posted as the answer.
- **needs_human** (or low confidence, timeout, A2A error, hop/token limit): escalated to the team's people through their
  `inbox`, Slack/email and an @mention in the Discussion. They reply from Claude Code (`reply`), the Hub UI, or a
  Discussion comment.
- **needs_approval**: the agent proposes a change. An approver runs `approve` (Claude Code, UI, or a `/approve` comment),
  then the `-exec` variant of the agent, the only one with write tools, carries it out.
- No team given: the project's router agent picks one.

Autonomy per agent: `ANSWER_ONLY` (never changes anything), `APPROVAL_FOR_WRITES` (default), `AUTONOMOUS`.
Secrets are redacted from everything posted, and every action is in the project's audit log.

## Repository layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js app: UI, REST API (`/api/v1`), hosted MCP (`/api/mcp`), GitHub webhook, CLI download |
| `apps/worker` | BullMQ worker: dispatch to agents, escalation, Discussion sync, kagent reconciler, sweeps |
| `packages/db` | Prisma schema, migrations, seed |
| `packages/core` | Request lifecycle, policy, GitHub, A2A client, queue, notifications |
| `packages/agent-templates` | Renders kagent `Agent` / `RemoteMCPServer` / `MCPServer` / `ModelConfig` manifests |
| `packages/hub-mcp` | The MCP tools Claude Code uses (`ask`, `wait_for`, `inbox`, `reply`, `approve`, ...) |
| `packages/cli` | `hub` CLI: `login`, `init`, `ask`, `inbox`, `mcp` |
| `deploy/helm` | Helm chart (web, worker, migrations, RBAC for kagent resources, optional Postgres/Redis) |
| `docs/kagent.md` | Installing kagent and connecting the Hub to it |

## Run it

### 1. Local development

Requires Node 20+, pnpm, Postgres and Redis (`docker compose up -d postgres redis` works).

```bash
pnpm install
cp .env.example .env          # set HUB_DEV_LOGIN=true to sign in without GitHub
pnpm db:deploy && pnpm db:seed -- --demo
pnpm dev                      # web on :3000, worker on :4000
```

Sign in with any login; the first user becomes org admin. `--demo` creates a `payments` project with `alice-dev`,
`omar-devops`, `ivan-infra` and `sara-sec`. Leave `HUB_AGENT_MODE=off` until kagent is running: requests then go
straight to people, which is useful for trying out the flow.

Tests (need Postgres; they use a `hub_test` database):

```bash
pnpm typecheck && pnpm test
```

### 2. docker-compose

```bash
cp .env.example .env          # HUB_DEV_LOGIN=true for local use
docker compose up --build     # http://localhost:3000
```

To use kagent from your local cluster, port-forward its controller
(`kubectl -n kagent port-forward svc/kagent-controller 8083:8083`) and set `HUB_AGENT_MODE=kagent`. The worker reaches it
at `host.docker.internal:8083`. See [docs/kagent.md](docs/kagent.md) for applying agents from compose.

### 3. Your local Kubernetes (kind, k3d, minikube, Docker Desktop)

1. Install kagent with an Anthropic key ([docs/kagent.md](docs/kagent.md#1-install-kagent)).
2. Build the images and install the chart into the current context:

   ```bash
   DEMO=true ./deploy/local-up.sh
   kubectl -n hub port-forward svc/agent-liaison-hub-web 3000:3000
   ```

   The script builds both images, loads them into kind, k3d or minikube, and installs `deploy/helm/agent-liaison-hub`
   with dev login, the bundled Postgres and Redis, `agents.mode=kagent` and `agents.kubeApply=true`. Use
   `AGENT_MODE=off` if kagent is not installed yet.
3. Open a project's **Agents** tab and click **Sync to kagent**. The worker applies the agents with its ServiceAccount, which can
   only manage `agents`, `remotemcpservers`, `mcpservers` and `modelconfigs` in the kagent namespace:

   ```bash
   kubectl -n kagent get agents.kagent.dev -l app.kubernetes.io/managed-by=agent-liaison-hub
   ```

For a shared install, use the chart directly with real GitHub credentials, an ingress and external databases:

```bash
helm upgrade --install agent-liaison-hub deploy/helm/agent-liaison-hub -n hub --create-namespace \
  --set hubUrl=https://hub.example.com \
  --set ingress.enabled=true --set ingress.host=hub.example.com \
  --set github.appId=123 --set github.clientId=Iv1... --set github.clientSecret=... \
  --set-file github.privateKey=hub.private-key.pem --set github.webhookSecret=... \
  --set postgres.enabled=false --set externalDatabaseUrl=postgresql://... \
  --set redis.enabled=false --set externalRedisUrl=redis://...
```

All options are in [`values.yaml`](deploy/helm/agent-liaison-hub/values.yaml). Migrations and the idempotent seed run as
a Job on every install and upgrade.

## GitHub App

One GitHub App provides both sign-in and Discussions access. Create it under your org's **Settings → Developer settings
→ GitHub Apps**:

| Setting | Value |
| --- | --- |
| Callback URL | `<HUB_URL>/api/auth/callback/github` |
| Webhook URL | `<HUB_URL>/webhooks/github` (secret goes into `GITHUB_WEBHOOK_SECRET`) |
| Repository permissions | Discussions: read & write, Metadata: read |
| Account permissions | Email addresses: read (optional, used for email notifications) |
| Subscribe to events | Discussion, Discussion comment |

Set `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` and
`GITHUB_WEBHOOK_SECRET`, then install the app on the project repositories. In each repository, enable Discussions and
create one category per team (for example "Infrastructure", "Security"), or a single fallback category. GitHub's API
cannot create categories, so the project's **Settings** tab lists which ones it expects and which it found.

Without the GitHub App the Hub still works; requests just live in the Hub only.

## Setting up a project

1. **Admin → Departments**: the teams (dev, devops, infra, security are seeded) and each one's default agent prompt.
2. **Admin → MCP servers**: the catalog of tools agents may use, each split into read tools and write tools. Credential
   Secrets can be per project (`{project}-vault-mcp`).
3. **Admin → Skills**: instructions for agents (runbooks, conventions) and for people's Claude Code (installed by
   `hub init`).
4. **Projects → New**: repository, then the one or two people from each team with their role (owner, approver,
   contributor, viewer), then the agents' MCP servers, skills and autonomy.
5. Everyone opens **Connect Claude Code**:

   ```bash
   curl -fsSL <HUB_URL>/cli/hub.mjs -o ~/.local/bin/hub && chmod +x ~/.local/bin/hub
   hub login --url <HUB_URL>         # browser approval, token saved in ~/.config/agent-liaison-hub
   hub init --project payments       # in the repo: .mcp.json, .claude/skills/*, CLAUDE.md section
   ```

   Then restart Claude Code. The same tools are available without the CLI through the hosted MCP endpoint
   (`claude mcp add --transport http hub <HUB_URL>/api/mcp --header "Authorization: Bearer $HUB_TOKEN"`).

## Configuration

See [`.env.example`](.env.example) for every variable. The important ones:

| Variable | Purpose |
| --- | --- |
| `HUB_URL` | Public URL, used in links, CLI login and Discussion posts |
| `HUB_AGENT_MODE` | `kagent` to dispatch to agents, `off` to route everything to people |
| `KAGENT_URL`, `KAGENT_NAMESPACE` | kagent controller (A2A) and the namespace agents live in |
| `HUB_KUBE_APPLY` | Let the worker apply and prune kagent resources (otherwise download the YAML from the Agents tab) |
| `HUB_REQUEST_TIMEOUT_MINUTES` | Agent requests not answered within this window are escalated |
| `SLACK_WEBHOOK_URL`, `SMTP_URL` | Escalation and approval notifications (projects can override the Slack webhook) |
| `HUB_DEV_LOGIN` | Local only: sign in as any login without GitHub |
