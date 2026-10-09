import { prisma, type LiaisonAgent, type Department } from "@hub/db";
import { agentResourceName } from "@hub/agent-templates";
import { invokeKagentAgent, type AgentInvoker } from "./a2a.js";
import { audit } from "./audit.js";
import { parseCommentCommand } from "./commands.js";
import { hubConfig, type AgentMode } from "./env.js";
import { HubError } from "./errors.js";
import {
  HUB_MARKER,
  agentAnswerBody,
  approvalBody,
  discussionTitle,
  escalationBody,
  humanMessageBody,
  questionBody,
  requestUrl,
  systemBody,
} from "./format.js";
import { discussionsClient, matchCategory, type DiscussionsClient, type RepoRef } from "./github.js";
import { parseHubResult } from "./hub-result.js";
import { notifier, type Notifier } from "./notify.js";
import { decideOutcome } from "./policy.js";
import { responderLogins } from "./projects.js";
import { enqueue } from "./queue.js";
import { redact } from "./redact.js";
import {
  ACTIVE_STATES,
  DONE_STATES,
  addMessage,
  approveRequest,
  closeRequest,
  loadRequest,
  rejectRequest,
  replyToRequest,
  type RequestWithRelations,
} from "./requests.js";

export interface ProcessorDeps {
  invoke: AgentInvoker;
  github: DiscussionsClient | null;
  notify: Notifier;
  agentMode: AgentMode;
}

export function defaultDeps(): ProcessorDeps {
  return { invoke: invokeKagentAgent, github: discussionsClient(), notify: notifier(), agentMode: hubConfig().agentMode };
}

const DEFAULT_LIMITS = { maxHops: 3, maxTokens: 60000, confidenceThreshold: 0.7, autonomy: "READ_ONLY" as const };

type ProjectWithAgents = NonNullable<Awaited<ReturnType<typeof loadProject>>>;

async function loadProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: { agents: { include: { department: true } } },
  });
}

function repoRef(project: { githubOwner: string | null; githubRepo: string | null; githubInstallationId: number | null }): RepoRef | null {
  if (!project.githubOwner || !project.githubRepo) return null;
  return { owner: project.githubOwner, repo: project.githubRepo, installationId: project.githubInstallationId };
}

function agentReady(agent: LiaisonAgent | undefined): boolean {
  return Boolean(agent && agent.enabled && (agent.syncStatus === "SYNCED" || agent.syncStatus === "RENDERED"));
}

async function postComment(deps: ProcessorDeps, r: RequestWithRelations, body: string): Promise<string | null> {
  if (!deps.github || !r.discussionId) return null;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } });
  const ref = repoRef(project);
  if (!ref) return null;
  try {
    const c = await deps.github.addComment(ref, { discussionId: r.discussionId, body: redact(body) });
    return c.id;
  } catch (err) {
    console.warn(`[github] failed to comment on request #${r.number}:`, err);
    await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "SYSTEM" }, action: "github.error", data: { error: String(err) } });
    return null;
  }
}

/** Finds (and caches) the Discussions category for a department, falling back to the project's default category. */
export async function resolveCategory(
  deps: ProcessorDeps,
  project: ProjectWithAgents,
  department: Pick<Department, "id" | "key" | "name"> | null,
): Promise<{ repositoryId: string; categoryId: string } | null> {
  const ref = repoRef(project);
  if (!deps.github || !ref) return null;
  const agent = department ? project.agents.find((a) => a.departmentId === department.id) : undefined;
  if (agent?.discussionCategoryId && project.githubRepositoryId) {
    return { repositoryId: project.githubRepositoryId, categoryId: agent.discussionCategoryId };
  }
  const info = await deps.github.getRepoInfo(ref);
  await prisma.project.update({
    where: { id: project.id },
    data: { githubRepositoryId: info.repositoryId, githubInstallationId: info.installationId },
  });
  const { category, usedFallback } = matchCategory(
    info.categories,
    department ?? { key: "triage", name: project.fallbackCategory },
    project.fallbackCategory,
  );
  if (!category) return null;
  if (agent && !usedFallback) {
    await prisma.liaisonAgent.update({
      where: { id: agent.id },
      data: { discussionCategoryId: category.id, discussionCategoryName: category.name },
    });
  }
  return { repositoryId: info.repositoryId, categoryId: category.id };
}

/** Checks which department categories exist in the project's repository and records the matches. */
export async function syncDiscussionCategories(projectId: string, deps: ProcessorDeps = defaultDeps()) {
  const project = await loadProject(projectId);
  if (!project) throw new HubError(404, "Project not found");
  const ref = repoRef(project);
  if (!deps.github) return { ok: false as const, error: "GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)" };
  if (!ref) return { ok: false as const, error: "Project has no GitHub repository linked" };
  try {
    const info = await deps.github.getRepoInfo(ref);
    await prisma.project.update({
      where: { id: project.id },
      data: { githubRepositoryId: info.repositoryId, githubInstallationId: info.installationId },
    });
    const departments = [];
    for (const agent of project.agents) {
      const { category, usedFallback } = matchCategory(info.categories, agent.department, project.fallbackCategory);
      await prisma.liaisonAgent.update({
        where: { id: agent.id },
        data: {
          discussionCategoryId: usedFallback ? null : (category?.id ?? null),
          discussionCategoryName: usedFallback ? null : (category?.name ?? null),
        },
      });
      departments.push({ key: agent.department.key, name: agent.department.name, category: usedFallback ? null : category?.name ?? null });
    }
    return { ok: true as const, discussionsEnabled: info.discussionsEnabled, categories: info.categories.map((c) => c.name), departments };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function processRequestCreated(requestId: string, deps: ProcessorDeps = defaultDeps()) {
  const r = await loadRequest(requestId);
  const project = await loadProject(r.projectId);
  if (!project) return;
  const ref = repoRef(project);
  if (deps.github && ref && !r.discussionId) {
    try {
      const dept = r.targetDepartment;
      const target = await resolveCategory(deps, project, dept);
      if (target) {
        const d = await deps.github.createDiscussion(ref, {
          ...target,
          title: discussionTitle({ number: r.number, title: r.title, departmentName: dept?.name }),
          body: questionBody({
            askerLogin: r.asker.login,
            askerClient: r.askerClient,
            departmentName: dept?.name,
            question: r.question,
            context: r.context,
            projectSlug: r.project.slug,
            requestId: r.id,
            number: r.number,
          }),
        });
        await prisma.request.update({
          where: { id: r.id },
          data: { discussionId: d.id, discussionNumber: d.number, discussionUrl: d.url },
        });
      }
    } catch (err) {
      console.warn(`[github] could not open a discussion for request #${r.number}:`, err);
      await audit({ orgId: project.orgId, projectId: project.id, requestId: r.id, actor: { type: "SYSTEM" }, action: "github.error", data: { error: String(err) } });
    }
  }
  await enqueue("request.dispatch", { requestId });
}

function buildAgentPrompt(r: RequestWithRelations, extra?: string): string {
  const lines = [
    `Request #${r.number} for project "${r.project.name}" from ${r.asker.login}${r.askerClient ? ` (via ${r.askerClient})` : ""}.`,
    `Title: ${r.title}`,
    "",
    "Question:",
    r.question,
  ];
  if (r.context) lines.push("", "Context from the asker:", r.context);
  const thread = r.messages.filter((m) => m.authorType !== "SYSTEM");
  if (thread.length) {
    lines.push("", "Conversation so far:");
    for (const m of thread) {
      const who = m.authorType === "AGENT" ? `agent ${m.authorAgent ?? ""}`.trim() : (m.authorUser?.login ?? "someone");
      lines.push(`- ${who}: ${m.body}`);
    }
  }
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

export async function escalate(
  requestId: string,
  reason: string,
  deps: ProcessorDeps,
  extra: { draft?: string | null; proposedAction?: string | null } = {},
) {
  const r = await loadRequest(requestId);
  if (DONE_STATES.includes(r.status)) return;
  const deptId = r.resolvedDepartmentId ?? r.targetDepartmentId;
  const { logins, emails } = await responderLogins(r.projectId, deptId);
  await prisma.request.update({
    where: { id: r.id },
    data: { status: "ESCALATED", statusReason: reason, proposedAction: extra.proposedAction ?? r.proposedAction },
  });
  const commentId = await postComment(
    deps,
    r,
    escalationBody({ reason, mentions: logins, draft: extra.draft, proposedAction: extra.proposedAction }),
  );
  await addMessage({ requestId: r.id, authorType: "SYSTEM", body: `Escalated to people: ${reason}`, githubCommentId: commentId });
  await audit({ orgId: r.project.orgId, projectId: r.projectId, requestId: r.id, actor: { type: "SYSTEM" }, action: "request.escalated", data: { reason, mentions: logins } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } });
  await deps.notify({
    subject: `[${r.project.name}] #${r.number} needs ${r.resolvedDepartment?.name ?? r.targetDepartment?.name ?? "an owner"}: ${r.title}`,
    text: `${r.asker.login} asked: ${r.question.slice(0, 500)}\n\nReason: ${reason}`,
    url: requestUrl(r.project.slug, r.id),
    slackWebhookUrl: project.slackWebhookUrl,
    emails,
  });
}

interface AgentChoice {
  agentName: string;
  agent?: LiaisonAgent & { department: Department };
  isRouter: boolean;
}

function chooseAgent(project: ProjectWithAgents, r: RequestWithRelations): AgentChoice | { error: string } {
  const deptId = r.resolvedDepartmentId ?? r.targetDepartmentId;
  if (deptId) {
    const agent = project.agents.find((a) => a.departmentId === deptId);
    if (!agent) return { error: "This team has no liaison agent" };
    if (!agentReady(agent)) {
      return { error: `The ${agent.department.name} agent is ${agent.enabled ? agent.syncStatus.toLowerCase() : "disabled"}` };
    }
    return { agentName: agentResourceName(project.slug, agent.department.key, "read"), agent, isRouter: false };
  }
  const ready = project.agents.filter((a) => agentReady(a));
  if (!project.routerEnabled || !ready.length) return { error: "No team was specified and no router agent is available" };
  return { agentName: agentResourceName(project.slug, "", "router"), isRouter: true };
}

export async function processDispatch(requestId: string, deps: ProcessorDeps = defaultDeps()) {
  const r = await loadRequest(requestId);
  if (!ACTIVE_STATES.includes(r.status)) return;
  if (deps.agentMode === "off") return escalate(r.id, "Agents are turned off for this Hub, so a person will answer", deps);

  const project = await loadProject(r.projectId);
  if (!project) return;
  const choice = chooseAgent(project, r);
  if ("error" in choice) return escalate(r.id, choice.error, deps);

  const limits = choice.agent ?? DEFAULT_LIMITS;
  if (r.hops >= limits.maxHops) return escalate(r.id, `Reached the limit of ${limits.maxHops} agent attempts`, deps);
  if (r.tokensUsed >= limits.maxTokens) return escalate(r.id, `Reached the token budget of ${limits.maxTokens}`, deps);

  await prisma.request.update({ where: { id: r.id }, data: { status: "IN_PROGRESS", hops: { increment: 1 } } });
  const prompt = buildAgentPrompt(r);

  let output;
  try {
    output = await deps.invoke({ agentName: choice.agentName, text: prompt, contextId: r.a2aContextId });
  } catch (err) {
    await audit({ orgId: project.orgId, projectId: project.id, requestId: r.id, actor: { type: "AGENT", agent: choice.agentName }, action: "agent.error", data: { error: String(err) } });
    return escalate(r.id, `The agent could not be reached: ${err instanceof Error ? err.message : String(err)}`, deps);
  }

  const tokens = output.totalTokens ?? Math.ceil((prompt.length + output.text.length) / 4);
  const parsed = parseHubResult(output.text);
  // A paused task (the agent called ask_user) has no structured block; tell people what it wanted to know.
  const result =
    output.state === "input-required" && !parsed.structured
      ? { ...parsed, reason: `The agent needs more information: ${output.text || "no question given"}` }
      : parsed;

  let resolved = choice.agent;
  if (choice.isRouter && result.department) {
    resolved = project.agents.find((a) => a.department.key === result.department);
  }
  await prisma.request.update({
    where: { id: r.id },
    data: {
      tokensUsed: { increment: tokens },
      a2aContextId: output.contextId ?? r.a2aContextId,
      resolvedDepartmentId: resolved?.departmentId ?? r.resolvedDepartmentId,
    },
  });
  await audit({
    orgId: project.orgId,
    projectId: project.id,
    requestId: r.id,
    actor: { type: "AGENT", agent: choice.agentName },
    action: "agent.responded",
    data: { status: result.status, confidence: result.confidence, structured: result.structured, tokens, department: result.department ?? null },
  });

  const policy = resolved ?? DEFAULT_LIMITS;
  const decision = decideOutcome({
    result,
    autonomy: policy.autonomy,
    confidenceThreshold: policy.confidenceThreshold,
  });
  const answerAgent = choice.isRouter && resolved ? agentResourceName(project.slug, resolved.department.key, "read") : choice.agentName;

  if (decision.kind === "answer") {
    const answer = redact(decision.answer);
    const fresh = await loadRequest(r.id);
    const commentId = await postComment(deps, fresh, agentAnswerBody({ agentName: answerAgent, answer, confidence: decision.confidence }));
    await prisma.request.update({
      where: { id: r.id },
      data: {
        status: "ANSWERED",
        statusReason: null,
        answer,
        confidence: decision.confidence,
        answeredByAgent: true,
        answeredById: null,
        answeredAt: new Date(),
      },
    });
    await addMessage({ requestId: r.id, authorType: "AGENT", agent: answerAgent, body: answer, githubCommentId: commentId });
    await audit({ orgId: project.orgId, projectId: project.id, requestId: r.id, actor: { type: "AGENT", agent: answerAgent }, action: "request.answered", data: { confidence: decision.confidence } });
    return;
  }

  if (decision.kind === "approval") {
    const fresh = await loadRequest(r.id);
    const { logins, emails } = await responderLogins(r.projectId, fresh.resolvedDepartmentId, true);
    const proposedAction = redact(decision.proposedAction);
    await prisma.request.update({
      where: { id: r.id },
      data: { status: "AWAITING_APPROVAL", proposedAction, confidence: decision.confidence, statusReason: "Waiting for an approver" },
    });
    const commentId = await postComment(deps, fresh, approvalBody({ mentions: logins, proposedAction, answer: redact(decision.answer) }));
    await addMessage({ requestId: r.id, authorType: "AGENT", agent: answerAgent, body: `Proposed change (needs approval):\n${proposedAction}`, githubCommentId: commentId });
    await audit({ orgId: project.orgId, projectId: project.id, requestId: r.id, actor: { type: "AGENT", agent: answerAgent }, action: "request.approval_requested", data: { approvers: logins } });
    await deps.notify({
      subject: `[${project.name}] #${r.number} needs approval: ${r.title}`,
      text: `Proposed change:\n${proposedAction}`,
      url: requestUrl(project.slug, r.id),
      slackWebhookUrl: project.slackWebhookUrl,
      emails,
    });
    return;
  }

  return escalate(r.id, decision.reason, deps, { draft: decision.draft ? redact(decision.draft) : null, proposedAction: decision.proposedAction });
}

export async function processExecute(requestId: string, deps: ProcessorDeps = defaultDeps()) {
  const r = await loadRequest(requestId);
  if (r.status !== "APPROVED") return;
  const project = await loadProject(r.projectId);
  if (!project) return;
  const agent = project.agents.find((a) => a.departmentId === r.resolvedDepartmentId);
  const approver = r.approvedBy?.login ?? "an approver";

  if (deps.agentMode === "off" || !agent || !agentReady(agent) || agent.autonomy === "READ_ONLY") {
    return escalate(r.id, `Approved by ${approver}; a person needs to carry out the change`, deps, { proposedAction: r.proposedAction });
  }
  const agentName = agentResourceName(project.slug, agent.department.key, agent.autonomy === "APPROVAL_FOR_WRITES" ? "exec" : "read");
  await prisma.request.update({ where: { id: r.id }, data: { status: "IN_PROGRESS", hops: { increment: 1 } } });

  let output;
  try {
    output = await deps.invoke({
      agentName,
      text: buildAgentPrompt(r, `APPROVED CHANGE (approved by ${approver}). Carry out exactly this and report the result:\n${r.proposedAction ?? ""}`),
    });
  } catch (err) {
    await prisma.request.update({ where: { id: r.id }, data: { status: "APPROVED" } });
    return escalate(r.id, `The execution agent failed: ${err instanceof Error ? err.message : String(err)}`, deps, { proposedAction: r.proposedAction });
  }
  const result = parseHubResult(output.text);
  const decision = decideOutcome({ result, autonomy: agent.autonomy, confidenceThreshold: 0, executing: true });
  await audit({ orgId: project.orgId, projectId: project.id, requestId: r.id, actor: { type: "AGENT", agent: agentName }, action: "agent.executed", data: { status: result.status } });

  if (decision.kind === "answer") {
    const answer = redact(decision.answer);
    const commentId = await postComment(deps, r, agentAnswerBody({ agentName, answer }));
    await prisma.request.update({
      where: { id: r.id },
      data: { status: "ANSWERED", answer, answeredByAgent: true, answeredAt: new Date(), statusReason: null },
    });
    await addMessage({ requestId: r.id, authorType: "AGENT", agent: agentName, body: answer, githubCommentId: commentId });
    return;
  }
  await prisma.request.update({ where: { id: r.id }, data: { status: "APPROVED" } });
  return escalate(r.id, decision.kind === "escalate" ? decision.reason : "Execution needs a person", deps, { proposedAction: r.proposedAction });
}

/** Mirrors a message created in the Hub (web or hub-mcp) into the request's Discussion. */
export async function processMessagePost(messageId: string, deps: ProcessorDeps = defaultDeps()) {
  const msg = await prisma.requestMessage.findUnique({ where: { id: messageId }, include: { authorUser: true } });
  if (!msg || msg.githubCommentId) return;
  const r = await loadRequest(msg.requestId);
  const body =
    msg.authorType === "AGENT"
      ? agentAnswerBody({ agentName: msg.authorAgent ?? "agent", answer: msg.body })
      : msg.authorType === "SYSTEM"
        ? systemBody(msg.body)
        : humanMessageBody({ login: msg.authorUser?.login ?? "someone", body: msg.body, via: "Agent Liaison Hub" });
  const commentId = await postComment(deps, r, body);
  if (commentId) await prisma.requestMessage.update({ where: { id: msg.id }, data: { githubCommentId: commentId } });
}

export async function processDiscussionClose(requestId: string, deps: ProcessorDeps = defaultDeps()) {
  const r = await loadRequest(requestId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } });
  const ref = repoRef(project);
  if (!deps.github || !ref || !r.discussionId) return;
  try {
    await deps.github.closeDiscussion(ref, { discussionId: r.discussionId });
  } catch (err) {
    console.warn(`[github] could not close discussion for #${r.number}:`, err);
  }
}

export async function processSweep(deps: ProcessorDeps = defaultDeps()) {
  const stale = await prisma.request.findMany({
    where: { status: { in: ACTIVE_STATES }, expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 100,
  });
  const minutes = hubConfig().requestTimeoutMinutes;
  for (const s of stale) await escalate(s.id, `Not answered by an agent within ${minutes} minutes`, deps);
  return stale.length;
}

interface GithubCommentPayload {
  action?: string;
  discussion?: { node_id?: string };
  comment?: { node_id?: string; body?: string; user?: { login?: string; type?: string } };
  sender?: { login?: string; type?: string };
}

/** Applies GitHub webhook events: human replies and slash commands in a request's Discussion. */
export async function processGithubEvent(event: string, payload: unknown, deps: ProcessorDeps = defaultDeps()) {
  const p = payload as GithubCommentPayload;
  const discussionId = p.discussion?.node_id;
  if (!discussionId) return { handled: false, reason: "no discussion" };
  const request = await prisma.request.findUnique({ where: { discussionId } });
  if (!request) return { handled: false, reason: "discussion is not linked to a request" };

  if (event === "discussion") {
    if ((p.action === "closed" || p.action === "deleted") && !DONE_STATES.includes(request.status)) {
      await prisma.request.update({ where: { id: request.id }, data: { status: "CLOSED", statusReason: `Discussion ${p.action} on GitHub` } });
      return { handled: true, action: "closed" };
    }
    return { handled: false, reason: `ignored discussion.${p.action}` };
  }

  if (event !== "discussion_comment" || p.action !== "created" || !p.comment?.node_id) {
    return { handled: false, reason: `ignored ${event}.${p.action}` };
  }
  const body = p.comment.body ?? "";
  const author = p.comment.user ?? p.sender ?? {};
  if (body.includes(HUB_MARKER) || author.type === "Bot") return { handled: false, reason: "own comment" };
  if (await prisma.requestMessage.findUnique({ where: { githubCommentId: p.comment.node_id } })) {
    return { handled: false, reason: "duplicate" };
  }

  const login = author.login ?? "unknown";
  const user = await prisma.user.findUnique({ where: { login } });
  if (!user) {
    await addMessage({ requestId: request.id, authorType: "HUMAN", agent: `github:${login}`, body, githubCommentId: p.comment.node_id });
    return { handled: true, action: "recorded (not a Hub user)" };
  }

  const opts = { via: "GitHub", githubCommentId: p.comment.node_id };
  const cmd = parseCommentCommand(body);
  try {
    switch (cmd.kind) {
      case "approve":
        await approveRequest(user, request.id, cmd.note, opts);
        return { handled: true, action: "approved" };
      case "reject":
        await rejectRequest(user, request.id, cmd.reason, opts);
        return { handled: true, action: "rejected" };
      case "close":
        await closeRequest(user, request.id, opts);
        return { handled: true, action: "closed" };
      case "reopen":
      case "message":
        await replyToRequest(user, request.id, cmd.kind === "message" ? cmd.body : "Please take another look.", opts);
        return { handled: true, action: "replied" };
    }
  } catch (err) {
    if (err instanceof HubError) {
      await addMessage({ requestId: request.id, authorType: "HUMAN", userId: user.id, body, githubCommentId: p.comment.node_id }).catch(() => undefined);
      const r = await loadRequest(request.id);
      await postComment(deps, r, systemBody(`@${login}: ${err.message}`));
      return { handled: false, reason: err.message };
    }
    throw err;
  }
}
