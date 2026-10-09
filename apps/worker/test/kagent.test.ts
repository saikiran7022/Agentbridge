import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ensureDefaultOrg, invokeKagentAgent } from "@hub/core";
import { prisma } from "@hub/db";
import { reconcileProject } from "../src/reconcile";

describe("A2A client against a fake kagent controller", () => {
  let server: Server;
  const seen: { url: string; body: any }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        seen.push({ url: req.url!, body });
        res.setHeader("content-type", "application/json");
        if (req.url!.includes("broken")) {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "agent crashed" } }));
          return;
        }
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              kind: "task",
              id: "task-1",
              contextId: body.params.message.contextId ?? "ctx-new",
              status: { state: "completed" },
              artifacts: [{ parts: [{ kind: "text", text: 'ok\n<hub-result>{"status":"answered","confidence":1,"answer":"ok"}</hub-result>' }] }],
            },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.KAGENT_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.KAGENT_NAMESPACE = "agents";
  });

  afterAll(() => {
    server.close();
    delete process.env.KAGENT_URL;
    delete process.env.KAGENT_NAMESPACE;
  });

  it("sends a JSON-RPC message/send to the agent's A2A endpoint", async () => {
    const out = await invokeKagentAgent({ agentName: "hub-payments-infra", text: "Where is X?", contextId: "ctx-9" });
    expect(seen[0].url).toBe("/api/a2a/agents/hub-payments-infra/");
    expect(seen[0].body).toMatchObject({
      jsonrpc: "2.0",
      method: "message/send",
      params: { message: { role: "user", kind: "message", contextId: "ctx-9", parts: [{ kind: "text", text: "Where is X?" }] } },
    });
    expect(out).toMatchObject({ contextId: "ctx-9", taskId: "task-1", state: "completed" });
    expect(out.text).toContain("<hub-result>");
  });

  it("raises JSON-RPC errors", async () => {
    await expect(invokeKagentAgent({ agentName: "broken", text: "x" })).rejects.toThrow(/agent crashed/);
  });
});

describe.skipIf(!inject("dbReady"))("reconcileProject without cluster access", () => {
  it("renders manifests and marks agents RENDERED (or DISABLED)", async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "LiaisonAgent","ProjectMember","Project","Department","OrgMember","User","Organization" CASCADE');
    const org = await ensureDefaultOrg();
    const infra = await prisma.department.findFirstOrThrow({ where: { orgId: org.id, key: "infra" } });
    const sec = await prisma.department.findFirstOrThrow({ where: { orgId: org.id, key: "security" } });
    const project = await prisma.project.create({
      data: {
        orgId: org.id,
        slug: "rec",
        name: "Reconcile",
        agents: { create: [{ departmentId: infra.id }, { departmentId: sec.id, enabled: false }] },
      },
    });
    const result = await reconcileProject(project.id);
    expect(result).toEqual({ applied: 0, removed: [], mode: "rendered" });
    const agents = await prisma.liaisonAgent.findMany({ where: { projectId: project.id }, include: { department: true } });
    expect(Object.fromEntries(agents.map((a) => [a.department.key, a.syncStatus]))).toEqual({ infra: "RENDERED", security: "DISABLED" });
  });
});
