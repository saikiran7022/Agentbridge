import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HubApiError, type HubApi, type HubRequest } from "./api.js";
import { formatProjects, formatRequest, formatRequestList } from "./format.js";

export interface HubMcpOptions {
  /** Project used when a tool call omits `project` (from `hub init`, HUB_PROJECT or the X-Hub-Project header). */
  defaultProject?: string | null;
  /** Shown to other teams as the client the question came from. */
  clientName?: string;
  /** Called with every request this session creates so the stdio server can watch it. */
  onAsked?: (r: HubRequest) => void;
  version?: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await fn());
  } catch (err) {
    const msg = err instanceof HubApiError ? `Hub error (${err.status}): ${err.message}` : err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

const requestRef = z
  .union([z.string(), z.number()])
  .transform(String)
  .describe("Request number (for example 42) or id");

export function createHubMcpServer(api: HubApi, opts: HubMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: "agent-liaison-hub", version: opts.version ?? "0.1.0" },
    {
      capabilities: { logging: {} },
      instructions:
        "Agent Liaison Hub: ask other teams' liaison agents (infra, devops, security, dev...) for information or changes they own, " +
        "and answer requests escalated to you. Prefer asking over guessing about systems outside this repository. Never include secret values.",
    },
  );

  const project = (p?: string | null) => {
    const value = p || opts.defaultProject;
    if (!value) throw new Error("No project given. Pass `project`, or run `hub init --project <slug>` in this repository.");
    return value;
  };

  server.registerTool(
    "list_projects",
    {
      title: "List Hub projects and teams",
      description: "Lists your projects, the teams on each, whether each team has a liaison agent, and who is on each team.",
      annotations: { readOnlyHint: true },
    },
    () => run(async () => formatProjects(await api.listProjects())),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask another team",
      description:
        "Send a question or request to a team's liaison agent (for example team 'infra'). The agent answers from the team's tools and knowledge, " +
        "or escalates to a person. Waits up to wait_seconds for an answer, then returns the current status.",
      inputSchema: {
        team: z.string().optional().describe("Team key such as infra, devops, security, dev. Omit to let the router pick."),
        question: z.string().min(5).describe("Self-contained question or request"),
        context: z.string().optional().describe("Relevant details: file paths, environment, error messages, what you already tried"),
        title: z.string().optional().describe("Short title for the Discussion thread"),
        project: z.string().optional().describe("Project slug; defaults to this repository's project"),
        wait_seconds: z.number().int().min(0).max(120).optional().describe("How long to wait for an answer (default 60)"),
      },
    },
    (args) =>
      run(async () => {
        const created = await api.ask({
          project: project(args.project),
          team: args.team,
          question: args.question,
          context: args.context,
          title: args.title,
          client: opts.clientName ?? "Claude Code",
        });
        opts.onAsked?.(created);
        const wait = args.wait_seconds ?? 60;
        const r = wait > 0 ? await api.waitFor(created.id, wait) : created;
        return formatRequest(r);
      }),
  );

  server.registerTool(
    "get_answer",
    {
      title: "Check a request",
      description: "Returns the current status, answer and thread of a request.",
      inputSchema: { request: requestRef },
      annotations: { readOnlyHint: true },
    },
    (args) => run(async () => formatRequest(await api.getRequest(args.request), { includeThread: true })),
  );

  server.registerTool(
    "wait_for",
    {
      title: "Wait for an answer",
      description: "Waits until the request is answered or needs a person (up to timeout_seconds), then returns its status.",
      inputSchema: { request: requestRef, timeout_seconds: z.number().int().min(1).max(120).optional() },
      annotations: { readOnlyHint: true },
    },
    (args) => run(async () => formatRequest(await api.waitFor(args.request, args.timeout_seconds ?? 90))),
  );

  server.registerTool(
    "follow_up",
    {
      title: "Follow up on your request",
      description: "Adds information or a clarifying question to a request you asked and sends it back to the agent.",
      inputSchema: { request: requestRef, message: z.string().min(1) },
    },
    (args) => run(async () => formatRequest(await api.reply(args.request, args.message))),
  );

  server.registerTool(
    "my_requests",
    {
      title: "My requests",
      description: "Lists requests you asked, newest first.",
      inputSchema: { status: z.string().optional().describe("Filter by status, for example ANSWERED or ESCALATED") },
      annotations: { readOnlyHint: true },
    },
    (args) => run(async () => formatRequestList(await api.myRequests(args.status), "You have no requests.")),
  );

  server.registerTool(
    "inbox",
    {
      title: "Requests waiting on me",
      description: "Lists questions escalated to your team and changes waiting for your approval.",
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const items = await api.inbox();
        if (!items.length) return "Nothing is waiting on you.";
        return items.map((r) => formatRequest(r)).join("\n\n---\n\n");
      }),
  );

  server.registerTool(
    "reply",
    {
      title: "Answer a request for your team",
      description: "Answers a request escalated to your team. The answer is posted to the request's Discussion thread.",
      inputSchema: { request: requestRef, answer: z.string().min(1) },
    },
    (args) => run(async () => formatRequest(await api.reply(args.request, args.answer))),
  );

  server.registerTool(
    "approve",
    {
      title: "Approve a proposed change",
      description: "Approves a change a liaison agent proposed so it can be carried out. Confirm with the user first.",
      inputSchema: { request: requestRef, note: z.string().optional() },
      annotations: { destructiveHint: true },
    },
    (args) => run(async () => formatRequest(await api.approve(args.request, args.note))),
  );

  server.registerTool(
    "reject",
    {
      title: "Reject a proposed change",
      description: "Rejects a change a liaison agent proposed.",
      inputSchema: { request: requestRef, reason: z.string().min(1) },
    },
    (args) => run(async () => formatRequest(await api.reject(args.request, args.reason))),
  );

  server.registerTool(
    "close",
    {
      title: "Close a request",
      description: "Closes a request that no longer needs an answer.",
      inputSchema: { request: requestRef },
    },
    (args) => run(async () => formatRequest(await api.close(args.request))),
  );

  return server;
}
