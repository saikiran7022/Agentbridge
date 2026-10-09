import { prisma, type Prisma, type RequestStatus, type User } from "@hub/db";
import { audit } from "./audit.js";
import { hubConfig } from "./env.js";
import { badRequest, forbidden, notFound } from "./errors.js";
import { deriveTitle, requestUrl } from "./format.js";
import { canAnswer, canApprove, ensureDefaultOrg, getProjectMembership } from "./projects.js";
import { enqueue } from "./queue.js";
import { redactSecrets, redact } from "./redact.js";

export const ACTIVE_STATES: RequestStatus[] = ["OPEN", "ROUTING", "IN_PROGRESS"];
export const HUMAN_STATES: RequestStatus[] = ["ESCALATED", "AWAITING_APPROVAL", "APPROVED"];
export const DONE_STATES: RequestStatus[] = ["ANSWERED", "REJECTED", "CLOSED", "FAILED"];

export const requestInclude = {
  project: { select: { id: true, slug: true, name: true, orgId: true } },
  asker: { select: { id: true, login: true, name: true } },
  targetDepartment: { select: { id: true, key: true, name: true } },
  resolvedDepartment: { select: { id: true, key: true, name: true } },
  answeredBy: { select: { login: true } },
  approvedBy: { select: { login: true } },
  messages: {
    orderBy: { createdAt: "asc" },
    include: { authorUser: { select: { login: true } } },
  },
} satisfies Prisma.RequestInclude;

export type RequestWithRelations = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

export interface SourceOptions {
  /** Where the action came from, shown in the thread ("hub-mcp", "web", "GitHub"). */
  via?: string;
  /** Set when the action originated from a GitHub comment so it is not posted back. */
  githubCommentId?: string;
}

export function serializeRequest(r: RequestWithRelations) {
  return {
    id: r.id,
    number: r.number,
    url: requestUrl(r.project.slug, r.id),
    project: r.project.slug,
    title: r.title,
    question: r.question,
    context: r.context,
    status: r.status,
    statusReason: r.statusReason,
    team: r.resolvedDepartment?.key ?? r.targetDepartment?.key ?? null,
    teamName: r.resolvedDepartment?.name ?? r.targetDepartment?.name ?? null,
    askedBy: r.asker.login,
    answer: r.answer,
    answeredBy: r.answeredByAgent ? "agent" : (r.answeredBy?.login ?? null),
    confidence: r.confidence,
    proposedAction: r.proposedAction,
    approvedBy: r.approvedBy?.login ?? null,
    rejectReason: r.rejectReason,
    discussionUrl: r.discussionUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    answeredAt: r.answeredAt?.toISOString() ?? null,
    done: DONE_STATES.includes(r.status),
    messages: r.messages.map((m) => ({
      id: m.id,
      author: m.authorType === "AGENT" ? (m.authorAgent ?? "agent") : (m.authorUser?.login ?? m.authorAgent ?? "system"),
      authorType: m.authorType,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export type SerializedRequest = ReturnType<typeof serializeRequest>;

export async function loadRequest(id: string): Promise<RequestWithRelations> {
  const r = await prisma.request.findUnique({ where: { id }, include: requestInclude });
  if (!r) throw notFound("Request");
  return r;
}

async function findRequest(idOrNumber: string): Promise<RequestWithRelations> {
  if (/^\d+$/.test(idOrNumber)) {
    const r = await prisma.request.findUnique({ where: { number: Number(idOrNumber) }, include: requestInclude });
    if (!r) throw notFound("Request");
    return r;
  }
  return loadRequest(idOrNumber);
}

export async function addMessage(input: {
  requestId: string;
  authorType: "HUMAN" | "AGENT" | "SYSTEM";
  userId?: string | null;
  agent?: string | null;
  body: string;
  githubCommentId?: string | null;
  post?: boolean;
}) {
  const msg = await prisma.requestMessage.create({
    data: {
      requestId: input.requestId,
      authorType: input.authorType,
      authorUserId: input.userId ?? null,
      authorAgent: input.agent ?? null,
      body: redact(input.body),
      githubCommentId: input.githubCommentId ?? null,
    },
  });
  if (input.post && !input.githubCommentId) await enqueue("message.post", { messageId: msg.id });
  return msg;
}

export interface CreateRequestInput {
  user: User;
  projectSlug: string;
  team?: string | null;
  question: string;
  context?: string | null;
  title?: string | null;
  client?: string | null;
}

export async function createRequest(input: CreateRequestInput): Promise<RequestWithRelations> {
  const org = await ensureDefaultOrg();
  const project = await prisma.project.findUnique({ where: { orgId_slug: { orgId: org.id, slug: input.projectSlug } } });
  if (!project || project.archived) throw notFound(`Project "${input.projectSlug}"`);
  const member = await getProjectMembership(project.id, input.user.id);
  if (!member || member.role === "VIEWER") throw forbidden(`You are not a contributor on project "${project.slug}"`);
  if (!input.question?.trim()) throw badRequest("question is required");

  let targetDepartmentId: string | null = null;
  if (input.team) {
    const dept = await prisma.department.findUnique({ where: { orgId_key: { orgId: org.id, key: input.team.toLowerCase() } } });
    if (!dept) throw badRequest(`Unknown team "${input.team}"`);
    const [agents, people] = await Promise.all([
      prisma.liaisonAgent.count({ where: { projectId: project.id, departmentId: dept.id } }),
      prisma.projectMember.count({ where: { projectId: project.id, departmentId: dept.id } }),
    ]);
    if (!agents && !people) throw badRequest(`Project "${project.slug}" has no ${dept.name} team or agent`);
    targetDepartmentId = dept.id;
  }

  const q = redactSecrets(input.question.trim());
  const c = redactSecrets((input.context ?? "").trim());
  const title = redact((input.title?.trim() || deriveTitle(q.text)).slice(0, 200));
  const timeout = hubConfig().requestTimeoutMinutes;

  const created = await prisma.request.create({
    data: {
      projectId: project.id,
      askerId: input.user.id,
      askerClient: input.client?.slice(0, 100) ?? null,
      targetDepartmentId,
      resolvedDepartmentId: targetDepartmentId,
      title,
      question: q.text,
      context: c.text,
      status: targetDepartmentId ? "OPEN" : "ROUTING",
      expiresAt: new Date(Date.now() + timeout * 60_000),
    },
  });
  await audit({
    orgId: project.orgId,
    projectId: project.id,
    requestId: created.id,
    actor: { type: "HUMAN", userId: input.user.id },
    action: "request.created",
    data: { team: input.team ?? null, client: input.client ?? null, redactions: [...q.redactions, ...c.redactions] },
  });
  await enqueue("request.created", { requestId: created.id });
  return loadRequest(created.id);
}

export async function getRequestForUser(user: User, idOrNumber: string): Promise<RequestWithRelations> {
  const r = await findRequest(idOrNumber);
  const member = await getProjectMembership(r.projectId, user.id);
  if (!member) throw forbidden("You are not a member of this project");
  return r;
}

/** Replies from the asker are follow-ups that go back to the agent; replies from the owning team answer it. */
export async function replyToRequest(user: User, idOrNumber: string, body: string, opts: SourceOptions = {}) {
  if (!body?.trim()) throw badRequest("answer is required");
  const r = await findRequest(idOrNumber);
  const member = await getProjectMembership(r.projectId, user.id);
  if (!member) throw forbidden("You are not a member of this project");
  const text = redact(body.trim());
  const isAsker = user.id === r.askerId;
  if (!isAsker && !canAnswer(member, r)) throw forbidden("Only the owning team (or project owners) can answer this request");

  await addMessage({
    requestId: r.id,
    authorType: "HUMAN",
    userId: user.id,
    body: text,
    githubCommentId: opts.githubCommentId,
    post: !opts.githubCommentId,
  });

  if (isAsker) {
    if (!HUMAN_STATES.includes(r.status)) {
      await prisma.request.update({
        where: { id: r.id },
        data: {
          status: r.resolvedDepartmentId ? "OPEN" : "ROUTING",
          statusReason: "Follow-up from asker",
          expiresAt: new Date(Date.now() + hubConfig().requestTimeoutMinutes * 60_000),
        },
      });
      await enqueue("request.dispatch", { requestId: r.id });
    }
    await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "HUMAN", userId: user.id }, action: "request.follow_up", data: { via: opts.via ?? null } });
    return loadRequest(r.id);
  }

  await prisma.request.update({
    where: { id: r.id },
    data: {
      status: "ANSWERED",
      statusReason: null,
      answer: text,
      answeredById: user.id,
      answeredByAgent: false,
      confidence: null,
      answeredAt: new Date(),
      resolvedDepartmentId: r.resolvedDepartmentId ?? member.departmentId,
    },
  });
  await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "HUMAN", userId: user.id }, action: "request.answered", data: { via: opts.via ?? null } });
  return loadRequest(r.id);
}

export async function approveRequest(user: User, idOrNumber: string, note?: string, opts: SourceOptions = {}) {
  const r = await findRequest(idOrNumber);
  if (r.status !== "AWAITING_APPROVAL") throw badRequest(`Request #${r.number} is ${r.status}, not awaiting approval`);
  const member = await getProjectMembership(r.projectId, user.id);
  if (!canApprove(member, r)) throw forbidden("Only approvers from the owning team (or project owners) can approve");
  await prisma.request.update({
    where: { id: r.id },
    data: { status: "APPROVED", approvedById: user.id, statusReason: note ? redact(note) : null },
  });
  await addMessage({
    requestId: r.id,
    authorType: "SYSTEM",
    userId: user.id,
    body: `Approved by ${user.login}${note ? `: ${note}` : ""}`,
    githubCommentId: opts.githubCommentId,
    post: !opts.githubCommentId,
  });
  await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "HUMAN", userId: user.id }, action: "request.approved", data: { via: opts.via ?? null, proposedAction: r.proposedAction } });
  await enqueue("request.execute", { requestId: r.id });
  return loadRequest(r.id);
}

export async function rejectRequest(user: User, idOrNumber: string, reason: string, opts: SourceOptions = {}) {
  const r = await findRequest(idOrNumber);
  if (r.status !== "AWAITING_APPROVAL") throw badRequest(`Request #${r.number} is ${r.status}, not awaiting approval`);
  const member = await getProjectMembership(r.projectId, user.id);
  if (!canApprove(member, r)) throw forbidden("Only approvers from the owning team (or project owners) can reject");
  const why = redact(reason?.trim() || "No reason given");
  await prisma.request.update({ where: { id: r.id }, data: { status: "REJECTED", rejectReason: why, approvedById: user.id } });
  await addMessage({
    requestId: r.id,
    authorType: "SYSTEM",
    userId: user.id,
    body: `Rejected by ${user.login}: ${why}`,
    githubCommentId: opts.githubCommentId,
    post: !opts.githubCommentId,
  });
  await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "HUMAN", userId: user.id }, action: "request.rejected", data: { via: opts.via ?? null, reason: why } });
  return loadRequest(r.id);
}

export async function closeRequest(user: User, idOrNumber: string, opts: SourceOptions = {}) {
  const r = await findRequest(idOrNumber);
  const member = await getProjectMembership(r.projectId, user.id);
  if (user.id !== r.askerId && !canAnswer(member, r)) throw forbidden("Only the asker or the owning team can close this request");
  if (r.status === "CLOSED") return r;
  await prisma.request.update({ where: { id: r.id }, data: { status: "CLOSED" } });
  await addMessage({ requestId: r.id, authorType: "SYSTEM", userId: user.id, body: `Closed by ${user.login}`, githubCommentId: opts.githubCommentId });
  await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "HUMAN", userId: user.id }, action: "request.closed", data: { via: opts.via ?? null } });
  if (!opts.githubCommentId) await enqueue("discussion.close", { requestId: r.id });
  return loadRequest(r.id);
}

/** Requests waiting on this user: escalations for their team and approvals they can give. */
export async function listInbox(user: User) {
  const memberships = await prisma.projectMember.findMany({ where: { userId: user.id } });
  if (!memberships.length) return [];
  const candidates = await prisma.request.findMany({
    where: { projectId: { in: memberships.map((m) => m.projectId) }, status: { in: ["ESCALATED", "AWAITING_APPROVAL"] } },
    include: requestInclude,
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return candidates.filter((r) => {
    const m = memberships.find((x) => x.projectId === r.projectId) ?? null;
    if (r.askerId === user.id) return false;
    return r.status === "AWAITING_APPROVAL" ? canApprove(m, r) : canAnswer(m, r);
  });
}

export async function listRequests(where: Prisma.RequestWhereInput, take = 50) {
  return prisma.request.findMany({ where, include: requestInclude, orderBy: { createdAt: "desc" }, take });
}

/** Long-poll until the request is finished or the timeout passes. */
export async function waitForRequest(user: User, idOrNumber: string, timeoutMs: number, pollMs = 1500) {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 0), 120_000);
  let r = await getRequestForUser(user, idOrNumber);
  const initial = r.status;
  while (!DONE_STATES.includes(r.status) && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, Math.min(pollMs, Math.max(deadline - Date.now(), 0))));
    r = await loadRequest(r.id);
    if (r.status !== initial && HUMAN_STATES.includes(r.status) && r.status !== "APPROVED") break;
  }
  return r;
}
