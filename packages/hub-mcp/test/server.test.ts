import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { HubApiError, type HubApi, type HubRequest } from "../src/api";
import { createHubMcpServer } from "../src/server";

function req(over: Partial<HubRequest> = {}): HubRequest {
  return {
    id: "r1",
    number: 7,
    url: "http://hub/projects/payments/requests/r1",
    project: "payments",
    title: "Where is the DB password?",
    question: "Where is the DB password?",
    context: "",
    status: "OPEN",
    statusReason: null,
    team: "infra",
    teamName: "Infrastructure",
    askedBy: "alice",
    answer: null,
    answeredBy: null,
    confidence: null,
    proposedAction: null,
    approvedBy: null,
    rejectReason: null,
    discussionUrl: "https://github.com/acme/payments/discussions/3",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    answeredAt: null,
    done: false,
    messages: [],
    ...over,
  };
}

function fakeApi(calls: string[]): HubApi {
  return {
    me: async () => ({ login: "alice", name: null }),
    listProjects: async () => [
      {
        slug: "payments",
        name: "Payments",
        description: "",
        myRole: "OWNER",
        myTeam: "dev",
        routerEnabled: true,
        teams: [{ key: "infra", name: "Infrastructure", description: "", agent: { enabled: true, autonomy: "READ_ONLY", status: "SYNCED" }, people: [{ login: "ivan", role: "APPROVER" }] }],
      },
    ],
    ask: async (input) => {
      calls.push(`ask:${input.project}:${input.team}:${input.client}`);
      return req();
    },
    getRequest: async (id) => {
      if (id === "404") throw new HubApiError(404, "Request not found");
      return req({ messages: [{ id: "m", author: "ivan", authorType: "HUMAN", body: "hi", createdAt: "" }] });
    },
    waitFor: async (id, t) => {
      calls.push(`wait:${id}:${t}`);
      return req({ status: "ANSWERED", done: true, answer: "secret/payments/db", answeredBy: "agent", confidence: 0.9 });
    },
    myRequests: async () => [req()],
    inbox: async () => [],
    reply: async (id, body) => {
      calls.push(`reply:${id}:${body}`);
      return req({ status: "ANSWERED" });
    },
    approve: async (id) => {
      calls.push(`approve:${id}`);
      return req({ status: "APPROVED" });
    },
    reject: async () => req({ status: "REJECTED", rejectReason: "no" }),
    close: async () => req({ status: "CLOSED", done: true }),
    bootstrap: async () => ({ hubUrl: "http://hub", project: { slug: "payments", name: "Payments" }, skills: [] }),
  };
}

async function connect(api: HubApi, defaultProject?: string) {
  const server = createHubMcpServer(api, { defaultProject, clientName: "test-client" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

describe("hub-mcp server", () => {
  it("exposes the liaison tools", async () => {
    const client = await connect(fakeApi([]));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["approve", "ask", "close", "follow_up", "get_answer", "inbox", "list_projects", "my_requests", "reject", "reply", "wait_for"].sort(),
    );
  });

  it("asks with the default project, waits and formats the answer", async () => {
    const calls: string[] = [];
    const client = await connect(fakeApi(calls), "payments");
    const res = await client.callTool({ name: "ask", arguments: { team: "infra", question: "Where is the DB password?", wait_seconds: 30 } });
    expect(calls).toEqual(["ask:payments:infra:test-client", "wait:r1:30"]);
    const text = textOf(res);
    expect(text).toContain("Request #7 [ANSWERED]");
    expect(text).toContain("Answer from the liaison agent (confidence 90%)");
    expect(text).toContain("secret/payments/db");
    expect(text).toContain("Discussion: https://github.com/acme/payments/discussions/3");
  });

  it("explains a missing project and surfaces Hub errors", async () => {
    const client = await connect(fakeApi([]));
    const noProject = await client.callTool({ name: "ask", arguments: { question: "hello world" } });
    expect(noProject.isError).toBe(true);
    expect(textOf(noProject)).toMatch(/hub init --project/);
    const missing = await client.callTool({ name: "get_answer", arguments: { request: "404" } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("Hub error (404): Request not found");
  });

  it("supports numeric request references and the human-side tools", async () => {
    const calls: string[] = [];
    const client = await connect(fakeApi(calls));
    await client.callTool({ name: "reply", arguments: { request: 7, answer: "It's in Vault" } });
    await client.callTool({ name: "approve", arguments: { request: "7" } });
    expect(calls).toEqual(["reply:7:It's in Vault", "approve:7"]);
    expect(textOf(await client.callTool({ name: "inbox", arguments: {} }))).toBe("Nothing is waiting on you.");
    expect(textOf(await client.callTool({ name: "list_projects", arguments: {} }))).toContain("infra (Infrastructure): agent synced; people: ivan");
    expect(textOf(await client.callTool({ name: "get_answer", arguments: { request: 7 } }))).toContain("- ivan (human): hi");
  });
});
