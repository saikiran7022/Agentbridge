import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import { prisma, type User } from "@hub/db";
import type { AgentInvoker } from "../src/a2a";
import type { DiscussionsClient } from "../src/github";
import type { Notification } from "../src/notify";
import {
  processDispatch,
  processExecute,
  processGithubEvent,
  processMessagePost,
  processRequestCreated,
  processSweep,
  type ProcessorDeps,
} from "../src/processors";
import { ensureDefaultOrg } from "../src/projects";
import { setJobSink, type JobName } from "../src/queue";
import { approveRequest, createRequest, listInbox, loadRequest, replyToRequest } from "../src/requests";
import { createApiToken, verifyApiToken } from "../src/tokens";

const dbReady = inject("dbReady");

class FakeGitHub implements DiscussionsClient {
  discussions: { id: string; categoryId: string; title: string; body: string }[] = [];
  comments: { discussionId: string; body: string }[] = [];
  closed: string[] = [];
  async getRepoInfo() {
    return {
      repositoryId: "R_1",
      installationId: 99,
      discussionsEnabled: true,
      categories: [
        { id: "C_general", name: "General", slug: "general" },
        { id: "C_infra", name: "Infrastructure", slug: "infrastructure" },
      ],
    };
  }
  async createDiscussion(_repo: unknown, input: { categoryId: string; title: string; body: string }) {
    const id = `D_${this.discussions.length + 1}`;
    this.discussions.push({ id, ...input });
    return { id, number: this.discussions.length, url: `https://github.com/acme/payments/discussions/${this.discussions.length}` };
  }
  async addComment(_repo: unknown, input: { discussionId: string; body: string }) {
    this.comments.push(input);
    return { id: `DC_${this.comments.length}`, url: "https://github.com/c" };
  }
  async closeDiscussion(_repo: unknown, input: { discussionId: string }) {
    this.closed.push(input.discussionId);
  }
}

function agentReply(block: Record<string, unknown>, prose = "Here is what I found."): string {
  return `${prose}\n<hub-result>${JSON.stringify(block)}</hub-result>`;
}

describe.skipIf(!dbReady)("request lifecycle", () => {
  let jobs: { name: JobName; data: unknown }[];
  let github: FakeGitHub;
  let notifications: Notification[];
  let calls: { agentName: string; text: string }[];
  let nextReply: string | Error;
  let deps: ProcessorDeps;
  let alice: User;
  let ivan: User;
  let sara: User;
  let projectId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AuditEvent","RequestMessage","Request","LiaisonAgentMcp","LiaisonAgentSkill","ProjectSkill","LiaisonAgent","ProjectMember","Project","McpServer","Skill","ApiToken","TeamJoinRequest","TeamMember","OrgMember","Department","User","Organization" CASCADE',
    );
    jobs = [];
    setJobSink(async (name, data) => {
      jobs.push({ name, data });
    });
    github = new FakeGitHub();
    notifications = [];
    calls = [];
    nextReply = agentReply({ status: "answered", confidence: 0.9, answer: "It is in Vault at secret/payments/staging/db" });
    const invoke: AgentInvoker = async ({ agentName, text }) => {
      calls.push({ agentName, text });
      if (nextReply instanceof Error) throw nextReply;
      return { text: nextReply, contextId: "ctx-1", totalTokens: 500 };
    };
    deps = { invoke, github, notify: async (n) => void notifications.push(n), agentMode: "kagent" };

    const org = await ensureDefaultOrg();
    const depts = Object.fromEntries((await prisma.department.findMany({ where: { orgId: org.id } })).map((d) => [d.key, d]));
    alice = await prisma.user.create({ data: { login: "alice", email: "alice@example.com" } });
    ivan = await prisma.user.create({ data: { login: "ivan", email: "ivan@example.com" } });
    sara = await prisma.user.create({ data: { login: "sara" } });
    const project = await prisma.project.create({
      data: {
        orgId: org.id,
        slug: "payments",
        name: "Payments",
        githubOwner: "acme",
        githubRepo: "payments",
        members: {
          create: [
            { userId: alice.id, departmentId: depts.dev.id, role: "OWNER" },
            { userId: ivan.id, departmentId: depts.infra.id, role: "APPROVER" },
            { userId: sara.id, departmentId: depts.security.id, role: "CONTRIBUTOR" },
          ],
        },
        agents: {
          create: [
            { departmentId: depts.infra.id, syncStatus: "SYNCED", autonomy: "APPROVAL_FOR_WRITES" },
            { departmentId: depts.security.id, syncStatus: "SYNCED" },
          ],
        },
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    setJobSink(null);
    await prisma.$disconnect();
  });

  async function ask(question = "Where is the staging DB password stored?", team: string | null = "infra") {
    const r = await createRequest({ user: alice, projectSlug: "payments", team, question, context: "password=hunter2hunter2", client: "Claude Code" });
    await processRequestCreated(r.id, deps);
    return r;
  }

  it("opens a Discussion, lets the agent answer and records everything", async () => {
    const r = await ask();
    expect(r.context).toBe("password=[REDACTED]");
    expect(github.discussions).toHaveLength(1);
    expect(github.discussions[0]).toMatchObject({ categoryId: "C_infra" });
    expect(github.discussions[0].title).toMatch(/^\[Infrastructure\] Where is the staging DB password stored\? \(#\d+\)$/);
    expect(github.discussions[0].body).not.toContain("hunter2");
    expect(jobs.map((j) => j.name)).toEqual(["request.created", "request.dispatch"]);

    await processDispatch(r.id, deps);
    expect(calls[0].agentName).toBe("hub-payments-infra");
    expect(calls[0].text).toContain("Where is the staging DB password stored?");

    const done = await loadRequest(r.id);
    expect(done).toMatchObject({ status: "ANSWERED", answeredByAgent: true, confidence: 0.9, hops: 1, tokensUsed: 500, a2aContextId: "ctx-1" });
    expect(github.comments.at(-1)?.body).toContain("Answer from `hub-payments-infra`");
    const actions = (await prisma.auditEvent.findMany({ where: { requestId: r.id } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["request.created", "agent.responded", "request.answered"]));
  });

  it("escalates low-confidence answers to the owning team and lets a human answer from GitHub", async () => {
    nextReply = agentReply({ status: "answered", confidence: 0.3, answer: "Probably in SSM?" });
    const r = await ask();
    await processDispatch(r.id, deps);

    let current = await loadRequest(r.id);
    expect(current.status).toBe("ESCALATED");
    expect(github.comments.at(-1)?.body).toContain("@ivan");
    expect(github.comments.at(-1)?.body).toContain("Probably in SSM?");
    expect(notifications[0].emails).toEqual(["ivan@example.com"]);
    expect((await listInbox(ivan)).map((x) => x.id)).toEqual([r.id]);
    expect(await listInbox(sara)).toEqual([]);

    const discussionId = github.discussions[0].id;
    expect(await processGithubEvent("discussion_comment", { action: "created", discussion: { node_id: discussionId }, comment: { node_id: "GH1", body: "Vault: secret/payments/staging/db", user: { login: "ivan", type: "User" } } }, deps)).toMatchObject({ handled: true, action: "replied" });
    expect(await processGithubEvent("discussion_comment", { action: "created", discussion: { node_id: discussionId }, comment: { node_id: "GH1", body: "dup", user: { login: "ivan" } } }, deps)).toMatchObject({ reason: "duplicate" });
    expect(await processGithubEvent("discussion_comment", { action: "created", discussion: { node_id: discussionId }, comment: { node_id: "GH2", body: "<!-- agent-liaison-hub --> bot", user: { login: "hub[bot]", type: "Bot" } } }, deps)).toMatchObject({ reason: "own comment" });

    current = await loadRequest(r.id);
    expect(current).toMatchObject({ status: "ANSWERED", answeredByAgent: false, answer: "Vault: secret/payments/staging/db", answeredById: ivan.id });
    expect(jobs.filter((j) => j.name === "message.post")).toHaveLength(0);
  });

  it("rejects answers from people outside the owning team", async () => {
    nextReply = agentReply({ status: "needs_human", confidence: 0, reason: "not in my tools" });
    const r = await ask();
    await processDispatch(r.id, deps);
    await expect(replyToRequest(sara, r.id, "no idea")).rejects.toThrow(/owning team/);
    const res = await processGithubEvent("discussion_comment", { action: "created", discussion: { node_id: github.discussions[0].id }, comment: { node_id: "GH9", body: "/approve", user: { login: "sara" } } }, deps);
    expect(res.handled).toBe(false);
    expect(github.comments.at(-1)?.body).toContain("@sara");
  });

  it("runs the approval flow through the executor agent", async () => {
    nextReply = agentReply({ status: "needs_approval", confidence: 0.85, answer: "Needs a new IAM role", proposed_action: "Create IAM role payments-reader with s3:GetObject on payments-artifacts" });
    const r = await ask("Can the payments service read the artifacts bucket?");
    await processDispatch(r.id, deps);
    let current = await loadRequest(r.id);
    expect(current.status).toBe("AWAITING_APPROVAL");
    expect(current.proposedAction).toContain("payments-reader");
    expect(github.comments.at(-1)?.body).toContain("Approval needed:** @ivan");

    await expect(approveRequest(sara, r.id)).rejects.toThrow(/approvers/);
    await approveRequest(ivan, r.id, "ok");
    expect(jobs.at(-1)).toEqual({ name: "request.execute", data: { requestId: r.id } });
    const approvalMsg = (await prisma.requestMessage.findMany({ where: { requestId: r.id, authorType: "SYSTEM" } })).find((m) => m.body.startsWith("Approved"));
    await processMessagePost(approvalMsg!.id, deps);
    expect(github.comments.at(-1)?.body).toContain("Approved by ivan");

    nextReply = agentReply({ status: "answered", confidence: 1, answer: "Created role payments-reader" });
    await processExecute(r.id, deps);
    expect(calls.at(-1)?.agentName).toBe("hub-payments-infra-exec");
    expect(calls.at(-1)?.text).toContain("APPROVED CHANGE (approved by ivan)");
    current = await loadRequest(r.id);
    expect(current).toMatchObject({ status: "ANSWERED", answer: "Created role payments-reader" });
  });

  it("hands read-only proposals to people", async () => {
    nextReply = agentReply({ status: "needs_approval", confidence: 0.9, proposed_action: "Rotate the API key" });
    const r = await createRequest({ user: alice, projectSlug: "payments", team: "security", question: "Please rotate the payments API key" });
    await processDispatch(r.id, deps);
    const current = await loadRequest(r.id);
    expect(current.status).toBe("ESCALATED");
    expect(current.statusReason).toMatch(/read-only/);
  });

  it("uses the router when no team is given and records the department it picked", async () => {
    nextReply = agentReply({ status: "answered", confidence: 0.95, answer: "Use the payments-ci pipeline", department: "infra" });
    const r = await ask("Which pipeline deploys payments?", null);
    expect(github.discussions[0]).toMatchObject({ categoryId: "C_general" });
    expect(github.discussions[0].title).toMatch(/^\[Triage\]/);
    await processDispatch(r.id, deps);
    expect(calls[0].agentName).toBe("hub-payments-router");
    const current = await loadRequest(r.id);
    expect(current.status).toBe("ANSWERED");
    expect(current.resolvedDepartment?.key).toBe("infra");
  });

  it("enforces hop limits, agent errors, disabled agents and timeouts", async () => {
    const r1 = await ask();
    await prisma.request.update({ where: { id: r1.id }, data: { hops: 3 } });
    await processDispatch(r1.id, deps);
    expect((await loadRequest(r1.id)).statusReason).toMatch(/limit of 3/);

    nextReply = new Error("connect ECONNREFUSED");
    const r2 = await ask();
    await processDispatch(r2.id, deps);
    expect((await loadRequest(r2.id)).statusReason).toMatch(/could not be reached: connect ECONNREFUSED/);

    await prisma.liaisonAgent.updateMany({ where: { projectId }, data: { enabled: false } });
    const r3 = await ask();
    await processDispatch(r3.id, deps);
    expect((await loadRequest(r3.id)).statusReason).toMatch(/disabled/);

    const r4 = await createRequest({ user: alice, projectSlug: "payments", team: "infra", question: "Anything stale?" });
    await prisma.request.update({ where: { id: r4.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await processSweep(deps)).toBe(1);
    expect((await loadRequest(r4.id)).status).toBe("ESCALATED");
  });

  it("sends asker follow-ups back to the agent", async () => {
    const r = await ask();
    await processDispatch(r.id, deps);
    jobs = [];
    await replyToRequest(alice, r.id, "Which key inside that path?");
    expect((await loadRequest(r.id)).status).toBe("OPEN");
    expect(jobs.map((j) => j.name)).toEqual(["message.post", "request.dispatch"]);
    nextReply = agentReply({ status: "answered", confidence: 0.9, answer: "Key: password" });
    await processDispatch(r.id, deps);
    expect(calls.at(-1)?.text).toContain("alice: Which key inside that path?");
    expect((await loadRequest(r.id)).hops).toBe(2);
  });

  it("validates membership and team when asking", async () => {
    const outsider = await prisma.user.create({ data: { login: "mallory" } });
    await expect(createRequest({ user: outsider, projectSlug: "payments", team: "infra", question: "hi there" })).rejects.toThrow(/not a contributor/);
    await expect(createRequest({ user: alice, projectSlug: "payments", team: "data", question: "hi there" })).rejects.toThrow(/Unknown team/);
    await expect(createRequest({ user: alice, projectSlug: "payments", team: "devops", question: "hi there" })).rejects.toThrow(/no DevOps team/);
  });

  it("issues and verifies API tokens", async () => {
    const { token } = await createApiToken(alice.id, "laptop");
    expect(token).toMatch(/^hub_/);
    expect((await verifyApiToken(token))?.id).toBe(alice.id);
    expect(await verifyApiToken("hub_nope")).toBeNull();
  });
});
