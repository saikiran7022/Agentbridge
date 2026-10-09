import YAML from "yaml";
import {
  DEFAULT_DEPARTMENT_PROMPTS,
  HUB_RESULT_INSTRUCTIONS,
  SAFETY_RULES,
  autonomyRules,
  type AutonomyLevel,
} from "./prompts.js";

export * from "./prompts.js";

export const MANAGED_BY = "agent-liaison-hub";
export const LABEL_PROJECT = "hub.dev/project";
export const LABEL_DEPARTMENT = "hub.dev/department";
export const LABEL_VARIANT = "hub.dev/variant";

export interface TemplateConfig {
  namespace: string;
  orgName: string;
  apiKeySecret: string;
  apiKeySecretKey: string;
  defaultModel: string;
}

export interface McpServerInput {
  slug: string;
  name: string;
  description: string;
  transport: "STREAMABLE_HTTP" | "SSE" | "STDIO";
  url?: string | null;
  image?: string | null;
  command?: string | null;
  args?: string[];
  secretName?: string | null;
  secretKey?: string | null;
  authHeader?: string;
  access: "READ_ONLY" | "READ_WRITE";
  readTools: string[];
  writeTools: string[];
}

export interface SkillInput {
  slug: string;
  name: string;
  description: string;
  content: string;
}

export interface LiaisonAgentInput {
  departmentKey: string;
  departmentName: string;
  departmentDescription?: string;
  systemPrompt?: string;
  model?: string | null;
  autonomy: AutonomyLevel;
  enabled: boolean;
  mcpServers: McpServerInput[];
  skills: SkillInput[];
}

export interface ProjectInput {
  slug: string;
  name: string;
  description?: string;
  routerEnabled: boolean;
  agents: LiaisonAgentInput[];
}

export interface K8sManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: Record<string, unknown>;
}

export type AgentVariant = "read" | "exec" | "router";

export const MANAGED_KINDS = [
  { apiVersion: "kagent.dev/v1alpha2", kind: "Agent", plural: "agents" },
  { apiVersion: "kagent.dev/v1alpha2", kind: "RemoteMCPServer", plural: "remotemcpservers" },
  { apiVersion: "kagent.dev/v1alpha1", kind: "MCPServer", plural: "mcpservers" },
] as const;

export function dnsName(...parts: string[]): string {
  const raw = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (raw.length <= 63) return raw;
  let hash = 0;
  for (const ch of raw) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const suffix = hash.toString(36).slice(0, 6);
  return `${raw.slice(0, 56).replace(/-$/, "")}-${suffix}`;
}

export function agentResourceName(projectSlug: string, departmentKey: string, variant: AgentVariant = "read"): string {
  if (variant === "router") return dnsName("hub", projectSlug, "router");
  return variant === "exec"
    ? dnsName("hub", projectSlug, departmentKey, "exec")
    : dnsName("hub", projectSlug, departmentKey);
}

export function mcpResourceName(projectSlug: string, mcpSlug: string): string {
  return dnsName("hub", projectSlug, "mcp", mcpSlug);
}

export function modelConfigName(model: string): string {
  return dnsName("hub-model", model);
}

/** Resolves the `{project}` placeholder so each project can point at its own Kubernetes Secret. */
export function projectSecretName(secretName: string, projectSlug: string): string {
  return secretName.replaceAll("{project}", projectSlug);
}

/** Which liaison agent variants exist for an autonomy level. */
export function variantsFor(autonomy: AutonomyLevel): AgentVariant[] {
  return autonomy === "APPROVAL_FOR_WRITES" ? ["read", "exec"] : ["read"];
}

/**
 * Tool names granted to a variant. `undefined` means "all tools of the server";
 * `null` means the server must not be attached at all.
 */
export function toolNamesFor(
  server: McpServerInput,
  autonomy: AutonomyLevel,
  variant: "read" | "exec",
): string[] | undefined | null {
  const canWrite = variant === "exec" || autonomy === "AUTONOMOUS";
  if (canWrite) {
    const tools = [...new Set([...server.readTools, ...server.writeTools])];
    return tools.length ? tools.slice(0, 50) : undefined;
  }
  if (server.readTools.length) return server.readTools.slice(0, 50);
  return server.access === "READ_ONLY" ? undefined : null;
}

function labels(projectSlug: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "app.kubernetes.io/managed-by": MANAGED_BY, [LABEL_PROJECT]: projectSlug, ...extra };
}

export function buildSystemMessage(
  project: ProjectInput,
  agent: LiaisonAgentInput,
  config: TemplateConfig,
  variant: "read" | "exec",
): string {
  const sections = [
    `You are the ${agent.departmentName} liaison agent for the project "${project.name}" at ${config.orgName}. ` +
      `Engineers from other departments (through their Claude Code sessions) ask you instead of messaging the ${agent.departmentName} team directly. ` +
      `You are their point of contact for anything the ${agent.departmentName} team owns.`,
  ];
  if (project.description) sections.push(`Project: ${project.description}`);
  if (agent.departmentDescription) sections.push(`Department: ${agent.departmentDescription}`);
  sections.push(
    agent.systemPrompt?.trim() ||
      DEFAULT_DEPARTMENT_PROMPTS[agent.departmentKey] ||
      `You know everything the ${agent.departmentName} team owns for this project.`,
  );
  sections.push(SAFETY_RULES);
  sections.push(autonomyRules(agent.autonomy, variant));
  if (agent.skills.length) {
    sections.push(
      "## Skills\n" + agent.skills.map((s) => `### ${s.name}\n${s.description}\n\n${s.content.trim()}`).join("\n\n"),
    );
  }
  sections.push(HUB_RESULT_INSTRUCTIONS);
  return sections.join("\n\n");
}

function mcpManifest(project: ProjectInput, server: McpServerInput, config: TemplateConfig): K8sManifest {
  const name = mcpResourceName(project.slug, server.slug);
  const secret = server.secretName ? projectSecretName(server.secretName, project.slug) : null;
  if (server.transport === "STDIO") {
    if (!server.image) throw new Error(`MCP server "${server.slug}" uses STDIO but has no container image`);
    return {
      apiVersion: "kagent.dev/v1alpha1",
      kind: "MCPServer",
      metadata: { name, namespace: config.namespace, labels: labels(project.slug, { "hub.dev/mcp": server.slug }) },
      spec: {
        transportType: "stdio",
        deployment: {
          image: server.image,
          ...(server.command ? { cmd: server.command } : {}),
          ...(server.args?.length ? { args: server.args } : {}),
          port: 3000,
          ...(secret ? { secretRefs: [{ name: secret }] } : {}),
        },
      },
    };
  }
  if (!server.url) throw new Error(`MCP server "${server.slug}" has no URL`);
  return {
    apiVersion: "kagent.dev/v1alpha2",
    kind: "RemoteMCPServer",
    metadata: { name, namespace: config.namespace, labels: labels(project.slug, { "hub.dev/mcp": server.slug }) },
    spec: {
      description: server.description || server.name,
      protocol: server.transport,
      url: server.url,
      timeout: "30s",
      ...(secret
        ? {
            headersFrom: [
              {
                name: server.authHeader || "Authorization",
                valueFrom: { type: "Secret", name: secret, key: server.secretKey || "token" },
              },
            ],
          }
        : {}),
    },
  };
}

function agentManifest(
  project: ProjectInput,
  agent: LiaisonAgentInput,
  config: TemplateConfig,
  variant: "read" | "exec",
): K8sManifest {
  const tools = agent.mcpServers.flatMap((server) => {
    const toolNames = toolNamesFor(server, agent.autonomy, variant);
    if (toolNames === null) return [];
    return [
      {
        type: "McpServer",
        mcpServer: {
          apiGroup: "kagent.dev",
          kind: server.transport === "STDIO" ? "MCPServer" : "RemoteMCPServer",
          name: mcpResourceName(project.slug, server.slug),
          ...(toolNames ? { toolNames } : {}),
        },
      },
    ];
  });
  const model = agent.model || config.defaultModel;
  return {
    apiVersion: "kagent.dev/v1alpha2",
    kind: "Agent",
    metadata: {
      name: agentResourceName(project.slug, agent.departmentKey, variant),
      namespace: config.namespace,
      labels: labels(project.slug, { [LABEL_DEPARTMENT]: agent.departmentKey, [LABEL_VARIANT]: variant }),
    },
    spec: {
      type: "Declarative",
      description:
        variant === "exec"
          ? `${agent.departmentName} executor for ${project.name} (runs approved changes only)`
          : `${agent.departmentName} liaison for ${project.name}: answers questions other teams would ask ${agent.departmentName}.`,
      declarative: {
        modelConfig: modelConfigName(model),
        systemMessage: buildSystemMessage(project, agent, config, variant),
        tools,
        a2aConfig: {
          skills: [
            {
              id: `${agent.departmentKey}-${variant === "exec" ? "execute" : "answer"}`,
              name: variant === "exec" ? `Execute approved ${agent.departmentName} changes` : `Ask ${agent.departmentName}`,
              description:
                variant === "exec"
                  ? `Carries out a change that a ${agent.departmentName} approver has approved.`
                  : `Answers questions about anything the ${agent.departmentName} team owns for ${project.name}.`,
              tags: [project.slug, agent.departmentKey],
            },
          ],
        },
      },
    },
  };
}

function routerManifest(project: ProjectInput, agents: LiaisonAgentInput[], config: TemplateConfig): K8sManifest {
  const roster = agents
    .map((a) => `- ${a.departmentKey}: ${a.departmentName}${a.departmentDescription ? ` (${a.departmentDescription})` : ""}`)
    .join("\n");
  const systemMessage = [
    `You are the router for the project "${project.name}" at ${config.orgName}. Engineers ask you questions without knowing which team owns the answer.`,
    `Department liaison agents available as tools:\n${roster}`,
    "Pick the single best department, delegate the full question to its agent tool, and relay its answer faithfully. If you delegated, copy that agent's status, confidence and answer. If no department fits, return \"needs_human\". Always fill in \"department\" with the key you chose.",
    SAFETY_RULES,
    HUB_RESULT_INSTRUCTIONS,
  ].join("\n\n");
  return {
    apiVersion: "kagent.dev/v1alpha2",
    kind: "Agent",
    metadata: {
      name: agentResourceName(project.slug, "", "router"),
      namespace: config.namespace,
      labels: labels(project.slug, { [LABEL_VARIANT]: "router" }),
    },
    spec: {
      type: "Declarative",
      description: `Routes ${project.name} questions to the right department liaison agent.`,
      declarative: {
        modelConfig: modelConfigName(config.defaultModel),
        systemMessage,
        tools: agents.map((a) => ({
          type: "Agent",
          agent: { name: agentResourceName(project.slug, a.departmentKey, "read") },
        })),
        a2aConfig: {
          skills: [
            {
              id: "route",
              name: `Ask ${project.name}`,
              description: "Routes any question to the department that owns the answer.",
              tags: [project.slug, "router"],
            },
          ],
        },
      },
    },
  };
}

function modelConfigManifest(model: string, config: TemplateConfig): K8sManifest {
  return {
    apiVersion: "kagent.dev/v1alpha2",
    kind: "ModelConfig",
    metadata: {
      name: modelConfigName(model),
      namespace: config.namespace,
      labels: { "app.kubernetes.io/managed-by": MANAGED_BY },
    },
    spec: {
      provider: "Anthropic",
      model,
      apiKeySecret: config.apiKeySecret,
      apiKeySecretKey: config.apiKeySecretKey,
      anthropic: {},
    },
  };
}

/** Renders every kagent resource a project needs. Disabled agents are omitted (and therefore pruned). */
export function renderProject(project: ProjectInput, config: TemplateConfig): K8sManifest[] {
  const enabled = project.agents.filter((a) => a.enabled);
  const manifests: K8sManifest[] = [];

  const models = new Set<string>([config.defaultModel, ...enabled.map((a) => a.model || config.defaultModel)]);
  for (const model of models) manifests.push(modelConfigManifest(model, config));

  const servers = new Map<string, McpServerInput>();
  for (const a of enabled) for (const s of a.mcpServers) servers.set(s.slug, s);
  for (const s of servers.values()) manifests.push(mcpManifest(project, s, config));

  for (const a of enabled) {
    for (const variant of variantsFor(a.autonomy)) {
      manifests.push(agentManifest(project, a, config, variant as "read" | "exec"));
    }
  }

  if (project.routerEnabled && enabled.length) manifests.push(routerManifest(project, enabled, config));
  return manifests;
}

export function toYaml(manifests: K8sManifest[]): string {
  return manifests.map((m) => YAML.stringify(m, { lineWidth: 0 })).join("---\n");
}
