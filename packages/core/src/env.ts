export type AgentMode = "kagent" | "off";

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export function hubConfig() {
  const env = process.env;
  return {
    hubUrl: (env.HUB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    orgSlug: env.HUB_ORG_SLUG ?? "acme",
    orgName: env.HUB_ORG_NAME ?? "Acme Engineering",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    agentMode: (env.HUB_AGENT_MODE === "kagent" ? "kagent" : "off") as AgentMode,
    kagent: {
      url: (env.KAGENT_URL ?? "http://kagent-controller.kagent:8083").replace(/\/$/, ""),
      namespace: env.KAGENT_NAMESPACE ?? "kagent",
      apiKeySecret: env.KAGENT_API_KEY_SECRET ?? "kagent-anthropic",
      apiKeySecretKey: env.KAGENT_API_KEY_SECRET_KEY ?? "ANTHROPIC_API_KEY",
      defaultModel: env.KAGENT_DEFAULT_MODEL ?? "claude-sonnet-4-5",
      invokeTimeoutMs: int(env.KAGENT_INVOKE_TIMEOUT_SECONDS, 300) * 1000,
      kubeApply: bool(env.HUB_KUBE_APPLY),
    },
    requestTimeoutMinutes: int(env.HUB_REQUEST_TIMEOUT_MINUTES, 30),
    github: {
      appId: env.GITHUB_APP_ID ?? "",
      privateKey: (env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "",
    },
    slackWebhookUrl: env.SLACK_WEBHOOK_URL ?? "",
    smtpUrl: env.SMTP_URL ?? "",
    smtpFrom: env.SMTP_FROM ?? "Agent Liaison Hub <hub@example.com>",
  };
}

export type HubConfig = ReturnType<typeof hubConfig>;

export function githubConfigured(cfg: HubConfig = hubConfig()): boolean {
  return Boolean(cfg.github.appId && cfg.github.privateKey);
}
