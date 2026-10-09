import { NextResponse, type NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { HubError } from "@hub/core";
import { createHubMcpServer } from "@hub/mcp";
import { apiUser } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const dynamic = "force-dynamic";
export const maxDuration = 130;

/** Hosted hub-mcp over stateless Streamable HTTP: `claude mcp add --transport http hub <HUB_URL>/api/mcp`. */
async function handle(req: NextRequest): Promise<Response> {
  let user;
  try {
    user = await apiUser(req);
  } catch (err) {
    const status = err instanceof HubError ? err.status : 401;
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32001, message: err instanceof Error ? err.message : "Unauthorized" }, id: null },
      { status, headers: { "www-authenticate": 'Bearer realm="agent-liaison-hub"' } },
    );
  }
  const server = createHubMcpServer(directHubApi(user), {
    defaultProject: req.headers.get("x-hub-project"),
    clientName: req.headers.get("x-hub-client") ?? "Claude Code",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
