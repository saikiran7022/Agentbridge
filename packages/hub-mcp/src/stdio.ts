import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpHubApi, type HubRequest } from "./api.js";
import { createHubMcpServer } from "./server.js";

export interface StdioOptions {
  url: string;
  token: string;
  project?: string | null;
  pollSeconds?: number;
}

/**
 * Runs hub-mcp over stdio. Requests asked in this session are watched in the background and
 * a logging notification is sent when one finishes or needs attention.
 */
export async function runStdio(opts: StdioOptions): Promise<void> {
  const api = new HttpHubApi(opts.url, opts.token);
  const watched = new Map<string, string>();
  const server = createHubMcpServer(api, {
    defaultProject: opts.project,
    clientName: "Claude Code (hub-mcp)",
    onAsked: (r: HubRequest) => watched.set(r.id, r.status),
  });

  const timer = setInterval(async () => {
    for (const [id, last] of watched) {
      try {
        const r = await api.getRequest(id);
        if (r.status === last) continue;
        watched.set(id, r.status);
        if (r.done) watched.delete(id);
        await server.server.sendLoggingMessage({
          level: r.done ? "notice" : "info",
          logger: "agent-liaison-hub",
          data: `Request #${r.number} (${r.teamName ?? "router"}) is now ${r.status}${r.answer ? `: ${r.answer.slice(0, 300)}` : ""}. Use get_answer ${r.number} for details.`,
        });
      } catch {
        // transient; try again next tick
      }
    }
  }, (opts.pollSeconds ?? 20) * 1000);
  timer.unref();

  await server.connect(new StdioServerTransport());
}
