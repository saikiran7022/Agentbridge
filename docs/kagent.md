# Running liaison agents on kagent

The Hub turns every project's team agents into [kagent](https://kagent.dev) resources and talks to them over A2A.
This guide uses a local cluster (kind, k3d, minikube or Docker Desktop Kubernetes); the same steps work on any cluster.

## 1. Install kagent

```bash
export ANTHROPIC_API_KEY=sk-ant-...

helm install kagent-crds oci://ghcr.io/kagent-dev/kagent/helm/kagent-crds \
  --namespace kagent --create-namespace

helm install kagent oci://ghcr.io/kagent-dev/kagent/helm/kagent \
  --namespace kagent \
  --set providers.default=anthropic \
  --set providers.anthropic.apiKey=$ANTHROPIC_API_KEY
```

The Hub's `ModelConfig`s read the API key from the Secret named by `KAGENT_API_KEY_SECRET` / `KAGENT_API_KEY_SECRET_KEY`
(defaults `kagent-anthropic` / `ANTHROPIC_API_KEY`, which is what the kagent chart creates for the Anthropic provider).
Check with `kubectl -n kagent get secret kagent-anthropic`. If yours differs, create it or change the env vars:

```bash
kubectl -n kagent create secret generic kagent-anthropic --from-literal=ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
```

## 2. Point the Hub at kagent

| Variable | Value |
| --- | --- |
| `HUB_AGENT_MODE` | `kagent` |
| `KAGENT_URL` | kagent controller URL, e.g. `http://kagent-controller.kagent:8083` in-cluster |
| `KAGENT_NAMESPACE` | namespace the agents are created in (`kagent`) |
| `HUB_KUBE_APPLY` | `true` to let the worker apply and prune resources itself |
| `KAGENT_DEFAULT_MODEL` | Anthropic model id used when an agent has no model override |

### Option A: Hub inside the cluster (recommended)

Install the Helm chart in `deploy/helm` (see the README). It creates a ServiceAccount with a Role that can manage
`agents`, `remotemcpservers`, `mcpservers` and `modelconfigs` in the kagent namespace, and sets `KAGENT_URL` to the
in-cluster controller service.

### Option B: Hub on your machine or in docker-compose

```bash
kubectl -n kagent port-forward svc/kagent-controller 8083:8083
```

- Hub running with `pnpm dev`: set `KAGENT_URL=http://localhost:8083`. With `HUB_KUBE_APPLY=true` the worker uses your
  current kubeconfig context.
- Hub running in docker-compose: `KAGENT_URL` defaults to `http://host.docker.internal:8083`. Applying from inside the
  container needs a kubeconfig whose server address is reachable from the container; with kind the simplest path is to keep
  `HUB_KUBE_APPLY=false` and apply manifests yourself (below), or run the worker on the host.

## 3. What gets created

For a project `payments` with an infra agent set to "approval required for changes":

| Resource | Purpose |
| --- | --- |
| `ModelConfig/hub-model-<model>` | One per model in use, Anthropic provider |
| `RemoteMCPServer/hub-payments-mcp-<slug>` | One per remote MCP server attached to any of the project's agents |
| `MCPServer/hub-payments-mcp-<slug>` | One per stdio (container) MCP server, run by kmcp |
| `Agent/hub-payments-infra` | Liaison agent with **read tools only** |
| `Agent/hub-payments-infra-exec` | Executor with read + write tools, only invoked after an approver approves |
| `Agent/hub-payments-router` | Delegates to the liaison agents when a question has no team |

Everything carries `app.kubernetes.io/managed-by=agent-liaison-hub` and `hub.dev/project=<slug>`; resources that are no
longer rendered (disabled agents, removed MCP servers, archived projects) are pruned on the next sync.

Without `HUB_KUBE_APPLY`, open the project's **Agents → View manifests** page (or `GET /api/projects/<slug>/manifests`)
and apply the YAML yourself:

```bash
curl -s -b "<session cookie>" http://localhost:3000/api/projects/payments/manifests | kubectl apply -f -
```

Agents marked `RENDERED` are dispatched to as if they were deployed; if kagent does not have them, requests escalate to
people with the A2A error in the reason.

## 4. MCP credentials per project

An MCP server's **Credential Secret** may contain `{project}`, for example `{project}-vault-mcp`. For project `payments`
the agent then reads its auth header from Secret `payments-vault-mcp` in the kagent namespace, so each project only sees
its own credentials:

```bash
kubectl -n kagent create secret generic payments-vault-mcp --from-literal=token="Bearer <scoped token>"
```

## 5. How the Hub talks to agents

The worker calls `POST {KAGENT_URL}/api/a2a/{namespace}/{agent}/` with JSON-RPC `message/send`. The A2A `contextId` is
stored on the request, so follow-ups continue the same agent session. Each agent is instructed to end its reply with a
`<hub-result>` JSON block (`answered` / `needs_human` / `needs_approval`, confidence, answer, proposed change), which the
Hub turns into an answer, an escalation or an approval request.
