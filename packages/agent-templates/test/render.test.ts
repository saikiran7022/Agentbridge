import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { agentResourceName, dnsName, renderProject, toolNamesFor, toYaml, type McpServerInput, type ProjectInput, type TemplateConfig } from "../src/index";

const config: TemplateConfig = {
  namespace: "kagent",
  orgName: "Acme",
  apiKeySecret: "kagent-anthropic",
  apiKeySecretKey: "ANTHROPIC_API_KEY",
  defaultModel: "claude-sonnet-4-5",
};

const k8sMcp: McpServerInput = {
  slug: "k8s",
  name: "Kubernetes",
  description: "Cluster access",
  transport: "STREAMABLE_HTTP",
  url: "http://k8s-mcp.tools:8084/mcp",
  secretName: "{project}-k8s-mcp",
  secretKey: "token",
  authHeader: "Authorization",
  access: "READ_WRITE",
  readTools: ["k8s_get_resources"],
  writeTools: ["k8s_apply_manifest"],
};

const terraform: McpServerInput = {
  slug: "terraform",
  name: "Terraform state",
  description: "",
  transport: "STDIO",
  image: "ghcr.io/acme/tf-mcp:1",
  args: ["--read-only"],
  access: "READ_ONLY",
  readTools: [],
  writeTools: [],
};

const project: ProjectInput = {
  slug: "payments",
  name: "Payments",
  description: "Card payments API",
  routerEnabled: true,
  agents: [
    {
      departmentKey: "infra",
      departmentName: "Infrastructure",
      autonomy: "APPROVAL_FOR_WRITES",
      enabled: true,
      model: "claude-opus-4-1",
      mcpServers: [k8sMcp, terraform],
      skills: [{ slug: "vault", name: "Vault layout", description: "Where secrets live", content: "secret/<project>/<env>/..." }],
    },
    { departmentKey: "security", departmentName: "Security", autonomy: "READ_ONLY", enabled: true, mcpServers: [k8sMcp], skills: [] },
    { departmentKey: "devops", departmentName: "DevOps", autonomy: "AUTONOMOUS", enabled: false, mcpServers: [], skills: [] },
  ],
};

describe("renderProject", () => {
  const manifests = renderProject(project, config);
  const byName = (kind: string, name: string) => manifests.find((m) => m.kind === kind && m.metadata.name === name);

  it("renders model configs, MCP servers, read/exec agents and the router", () => {
    expect(manifests.map((m) => `${m.kind}/${m.metadata.name}`)).toEqual([
      "ModelConfig/hub-model-claude-sonnet-4-5",
      "ModelConfig/hub-model-claude-opus-4-1",
      "RemoteMCPServer/hub-payments-mcp-k8s",
      "MCPServer/hub-payments-mcp-terraform",
      "Agent/hub-payments-infra",
      "Agent/hub-payments-infra-exec",
      "Agent/hub-payments-security",
      "Agent/hub-payments-router",
    ]);
    for (const m of manifests) expect(m.metadata.namespace).toBe("kagent");
  });

  it("gives the read agent only read tools and the executor read + write tools", () => {
    const read = byName("Agent", "hub-payments-infra")!.spec as any;
    const exec = byName("Agent", "hub-payments-infra-exec")!.spec as any;
    expect(read.type).toBe("Declarative");
    expect(read.declarative.modelConfig).toBe("hub-model-claude-opus-4-1");
    expect(read.declarative.tools).toEqual([
      { type: "McpServer", mcpServer: { apiGroup: "kagent.dev", kind: "RemoteMCPServer", name: "hub-payments-mcp-k8s", toolNames: ["k8s_get_resources"] } },
      { type: "McpServer", mcpServer: { apiGroup: "kagent.dev", kind: "MCPServer", name: "hub-payments-mcp-terraform" } },
    ]);
    expect(exec.declarative.tools[0].mcpServer.toolNames).toEqual(["k8s_get_resources", "k8s_apply_manifest"]);
    expect(read.declarative.systemMessage).toContain("Infrastructure liaison agent");
    expect(read.declarative.systemMessage).toContain("### Vault layout");
    expect(read.declarative.systemMessage).toContain("<hub-result>");
    expect(read.declarative.systemMessage).toContain('return "needs_approval"');
    expect(exec.declarative.systemMessage).toContain("Execution mode");
    expect(read.declarative.a2aConfig.skills[0]).toMatchObject({ id: "infra-answer", name: "Ask Infrastructure" });
  });

  it("resolves per-project secrets and stdio servers", () => {
    const remote = byName("RemoteMCPServer", "hub-payments-mcp-k8s")!.spec as any;
    expect(remote.headersFrom).toEqual([{ name: "Authorization", valueFrom: { type: "Secret", name: "payments-k8s-mcp", key: "token" } }]);
    const stdio = byName("MCPServer", "hub-payments-mcp-terraform")!;
    expect(stdio.apiVersion).toBe("kagent.dev/v1alpha1");
    expect((stdio.spec as any).deployment).toMatchObject({ image: "ghcr.io/acme/tf-mcp:1", args: ["--read-only"] });
  });

  it("delegates from the router to enabled read agents only", () => {
    const router = byName("Agent", "hub-payments-router")!.spec as any;
    expect(router.declarative.tools).toEqual([
      { type: "Agent", agent: { name: "hub-payments-infra" } },
      { type: "Agent", agent: { name: "hub-payments-security" } },
    ]);
    expect(manifests.some((m) => m.metadata.name.includes("devops"))).toBe(false);
  });

  it("labels everything for pruning and serialises to YAML", () => {
    for (const m of manifests.filter((x) => x.kind !== "ModelConfig")) {
      expect(m.metadata.labels).toMatchObject({ "app.kubernetes.io/managed-by": "agent-liaison-hub", "hub.dev/project": "payments" });
    }
    const docs = YAML.parseAllDocuments(toYaml(manifests)).map((d) => d.toJSON());
    expect(docs).toHaveLength(manifests.length);
    expect(docs[4].kind).toBe("Agent");
  });
});

describe("helpers", () => {
  it("builds DNS-safe names under 63 characters", () => {
    const long = dnsName("hub", "a-very-long-project-name-that-keeps-going-and-going", "infrastructure", "exec");
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^[a-z0-9-]+$/);
    expect(agentResourceName("Payments_V2", "infra")).toBe("hub-payments-v2-infra");
  });

  it("drops read/write servers without a read allowlist from read-only agents", () => {
    const rw = { ...k8sMcp, readTools: [] };
    expect(toolNamesFor(rw, "READ_ONLY", "read")).toBeNull();
    expect(toolNamesFor(rw, "AUTONOMOUS", "read")).toEqual(["k8s_apply_manifest"]);
    expect(toolNamesFor(terraform, "READ_ONLY", "read")).toBeUndefined();
  });
});
