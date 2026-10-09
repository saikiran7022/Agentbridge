import { randomUUID } from "node:crypto";
import { hubConfig } from "./env.js";

export interface InvokeAgentInput {
  agentName: string;
  text: string;
  contextId?: string | null;
  namespace?: string;
}

export interface InvokeAgentOutput {
  text: string;
  contextId?: string;
  taskId?: string;
  state?: string;
  totalTokens?: number;
}

export type AgentInvoker = (input: InvokeAgentInput) => Promise<InvokeAgentOutput>;

interface Part {
  kind?: string;
  type?: string;
  text?: string;
}

interface A2AMessage {
  kind?: string;
  role?: string;
  parts?: Part[];
  contextId?: string;
  metadata?: unknown;
}

interface A2ATask {
  kind?: string;
  id?: string;
  contextId?: string;
  status?: { state?: string; message?: A2AMessage };
  artifacts?: { parts?: Part[] }[];
  history?: A2AMessage[];
  metadata?: unknown;
}

function partsText(parts: Part[] | undefined): string {
  return (parts ?? [])
    .filter((p) => (p.kind ?? p.type) === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function findTokenCount(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== "object" || depth > 6) return undefined;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && /^(total_?token_?count|total_?tokens)$/i.test(key)) return v;
    const nested = findTokenCount(v, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Extracts the agent's final text from an A2A `message/send` result (either a Task or a Message). */
export function extractA2AResult(result: unknown): InvokeAgentOutput {
  const r = (result ?? {}) as A2ATask & A2AMessage;
  if (r.kind === "message" || (r.parts && !r.status)) {
    return { text: partsText(r.parts), contextId: r.contextId, totalTokens: findTokenCount(r.metadata) };
  }
  let text = (r.artifacts ?? []).map((a) => partsText(a.parts)).filter(Boolean).join("\n\n");
  if (!text) text = partsText(r.status?.message?.parts);
  if (!text) {
    const lastAgent = [...(r.history ?? [])].reverse().find((m) => m.role === "agent");
    text = partsText(lastAgent?.parts);
  }
  return {
    text,
    contextId: r.contextId,
    taskId: r.id,
    state: r.status?.state,
    totalTokens: findTokenCount(r.metadata) ?? findTokenCount(r.status?.message?.metadata),
  };
}

export function a2aEndpoint(agentName: string, namespace?: string): string {
  const cfg = hubConfig();
  return `${cfg.kagent.url}/api/a2a/${namespace ?? cfg.kagent.namespace}/${agentName}/`;
}

/** Calls a kagent agent over A2A JSON-RPC (`message/send`, non-streaming). */
export const invokeKagentAgent: AgentInvoker = async ({ agentName, text, contextId, namespace }) => {
  const cfg = hubConfig();
  const res = await fetch(a2aEndpoint(agentName, namespace), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    signal: AbortSignal.timeout(cfg.kagent.invokeTimeoutMs),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: randomUUID(),
          parts: [{ kind: "text", text }],
          ...(contextId ? { contextId } : {}),
        },
        configuration: { blocking: true, acceptedOutputModes: ["text"] },
      },
    }),
  });
  if (!res.ok) throw new Error(`A2A call to ${agentName} failed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (body.error) throw new Error(`A2A error from ${agentName}: ${body.error.message} (${body.error.code})`);
  const out = extractA2AResult(body.result);
  if (out.state === "failed") throw new Error(`Agent ${agentName} task failed: ${out.text || "no details"}`);
  return out;
};
